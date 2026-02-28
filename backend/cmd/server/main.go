package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"runtime"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/redis/go-redis/v9"

	"github.com/webhooks/backend/internal/handler"
	"github.com/webhooks/backend/internal/store"
	"github.com/webhooks/backend/internal/ws"
)

func main() {
	// Use all available CPU cores
	runtime.GOMAXPROCS(runtime.NumCPU())

	// ── Postgres ──
	var pg *store.Postgres

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dbHost := os.Getenv("DB_HOST")
		dbPort := os.Getenv("DB_PORT")
		dbUser := os.Getenv("DB_USER")
		dbPass := os.Getenv("DB_PASS")
		dbName := os.Getenv("DB_NAME")
		dbSSL := os.Getenv("DB_SSLMODE")
		if dbSSL == "" {
			dbSSL = "disable"
		}
		if dbHost != "" && dbUser != "" && dbName != "" {
			if dbPort == "" {
				dbPort = "5432"
			}
			dsn = fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=%s",
				dbUser, dbPass, dbHost, dbPort, dbName, dbSSL)
		}
	}

	if dsn == "" {
		log.Fatal("❌ PostgreSQL is required. Set DATABASE_URL or DB_* environment variables.")
	}

	var err error
	pg, err = store.NewPostgres(dsn)
	if err != nil {
		log.Fatalf("❌ postgres: %v", err)
	}
	log.Println("✅ Connected to PostgreSQL")

	// ── Dragonfly / Redis ──
	redisAddr := os.Getenv("REDIS_URL")
	if redisAddr == "" {
		redisAddr = "dragonfly:6379"
	}

	rdb := redis.NewClient(&redis.Options{
		Addr:         redisAddr,
		DB:           0,
		PoolSize:     50,
		MinIdleConns: 10,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
	})

	if _, err := rdb.Ping(context.Background()).Result(); err != nil {
		log.Fatalf("❌ Dragonfly/Redis connection failed: %v", err)
	}
	log.Printf("✅ Connected to Dragonfly at %s", redisAddr)

	// ── Buffered store: Dragonfly buffer → flush to Postgres every 2 min ──
	flushInterval := 2 * time.Minute
	if v := os.Getenv("FLUSH_INTERVAL_SECONDS"); v != "" {
		if secs, err := time.ParseDuration(v + "s"); err == nil {
			flushInterval = secs
		}
	}

	dataStore := store.NewBufferedStore(pg, rdb, flushInterval)
	log.Printf("✅ Buffered store ready (flush every %s)", flushInterval)

	defer dataStore.Close()

	app := fiber.New(fiber.Config{
		Prefork:        false,
		ServerHeader:   "Webhook-Catcher",
		CaseSensitive:  true,
		StrictRouting:  false,
		ReadBufferSize: 8192,
		BodyLimit:      1 * 1024 * 1024, // 1 MB
	})

	// Middleware
	app.Use(recover.New())
	app.Use(logger.New(logger.Config{
		Format:     "${time} | ${status} | ${latency} | ${method} ${path}\n",
		TimeFormat: "15:04:05",
	}))
	app.Use(cors.New(cors.Config{
		AllowOrigins:  "*",
		AllowMethods:  "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
		AllowHeaders:  "*",
		ExposeHeaders: "*",
	}))

	// Dependencies
	hub := ws.NewHub()

	endpointH := &handler.Endpoint{Store: dataStore}
	webhookH := &handler.Webhook{Store: dataStore, Hub: hub}
	wsH := &handler.WS{Store: dataStore, Hub: hub}

	// ---- Routes -----

	// API
	api := app.Group("/api")
	api.Post("/endpoints", endpointH.Create)
	api.Get("/endpoints/:id", endpointH.Get)
	api.Get("/endpoints/:id/requests", endpointH.GetRequests)
	api.Get("/endpoints/:id/requests/page", endpointH.GetRequestsPaginated)
	api.Delete("/endpoints/:id/requests", endpointH.ClearRequests)
	api.Get("/endpoints/:id/config", endpointH.GetConfig)
	api.Put("/endpoints/:id/config", endpointH.UpdateConfig)

	// Webhook capture – accepts ANY method
	app.All("/send/:id", webhookH.Catch)

	// WebSocket
	app.Use("/ws/:id", wsH.Upgrade)
	app.Get("/ws/:id", wsH.Handle())

	// Health
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok"})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("🚀 Webhook server (Fiber) starting on :%s  [cpus=%d]", port, runtime.NumCPU())
	if err := app.Listen(":" + port); err != nil {
		log.Fatal(err)
	}
}
