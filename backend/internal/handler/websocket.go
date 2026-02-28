package handler

import (
	"log"
	"time"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/webhooks/backend/internal/store"
	"github.com/webhooks/backend/internal/ws"
)

const (
	// Must match or exceed hub constants
	wsWriteWait  = 10 * time.Second
	wsPongWait   = 60 * time.Second
	wsPingPeriod = 30 * time.Second
)

// WS holds dependencies for WebSocket handlers.
type WS struct {
	Store store.Store
	Hub   *ws.Hub
}

// Upgrade is a middleware that checks the WebSocket upgrade header.
func (h *WS) Upgrade(c *fiber.Ctx) error {
	if websocket.IsWebSocketUpgrade(c) {
		id := c.Params("id")
		if !h.Store.Exists(id) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Endpoint not found"})
		}
		c.Locals("endpointID", id)
		return c.Next()
	}
	return fiber.ErrUpgradeRequired
}

// Handle manages an individual WebSocket connection.
func (h *WS) Handle() fiber.Handler {
	return websocket.New(func(conn *websocket.Conn) {
		endpointID := conn.Locals("endpointID").(string)

		// Register and get the entry so we share its write mutex with the Hub
		entry := h.Hub.Register(endpointID, conn)
		defer func() {
			h.Hub.Unregister(endpointID, conn)
			conn.Close()
		}()

		log.Printf("ws connected: endpoint=%s (clients=%d)", endpointID, h.Hub.ClientCount(endpointID))

		// Configure read deadline + pong handler to keep connection alive.
		// Browser automatically responds to server pings with pongs.
		conn.SetReadDeadline(time.Now().Add(wsPongWait))
		conn.SetPongHandler(func(appData string) error {
			conn.SetReadDeadline(time.Now().Add(wsPongWait))
			return nil
		})

		// Ping goroutine — keeps the connection alive and detects dead clients.
		// Uses the same per-connection mutex as Hub.Broadcast to avoid concurrent writes.
		done := make(chan struct{})
		go func() {
			ticker := time.NewTicker(wsPingPeriod)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					entry.Mu.Lock()
					conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
					err := conn.WriteMessage(websocket.PingMessage, nil)
					entry.Mu.Unlock()
					if err != nil {
						log.Printf("ws ping error (endpoint=%s): %v", endpointID, err)
						return
					}
				case <-done:
					return
				}
			}
		}()

		// Read loop — blocks until the client disconnects or pong timeout fires.
		// Also resets the read deadline on any client message (e.g. keepalive pings)
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				log.Printf("ws read closed (endpoint=%s): %v", endpointID, err)
				break
			}
			// Any message from client keeps the connection alive
			conn.SetReadDeadline(time.Now().Add(wsPongWait))
		}
		close(done) // stop the ping goroutine
	})
}
