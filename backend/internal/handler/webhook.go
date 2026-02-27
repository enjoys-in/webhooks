package handler

import (
	"fmt"
	"log"
	"net/url"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/webhooks/backend/internal/model"
	"github.com/webhooks/backend/internal/store"
	"github.com/webhooks/backend/internal/ws"
)

// Webhook handles incoming webhook capture requests.
type Webhook struct {
	Store store.Store
	Hub   *ws.Hub
}

// Catch  ALL /webhook/:id
func (h *Webhook) Catch(c *fiber.Ctx) error {
	start := time.Now()
	id := c.Params("id")

	if !h.Store.Exists(id) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Endpoint not found"})
	}

	// Collect raw request headers
	headers := make(map[string][]string)
	c.Request().Header.VisitAll(func(key, val []byte) {
		k := string(key)
		headers[k] = append(headers[k], string(val))
	})

	// Parse query params
	queryParams := make(map[string][]string)
	c.Request().URI().QueryArgs().VisitAll(func(key, val []byte) {
		k := string(key)
		queryParams[k] = append(queryParams[k], string(val))
	})

	body := string(c.Body())
	elapsed := time.Since(start)

	responseHeaders := map[string]string{
		"Content-Type":        "application/json",
		"X-Webhook-ID":        id,
		"X-Request-Received":  start.Format(time.RFC3339Nano),
		"X-Response-Time-Ms":  fmt.Sprintf("%.2f", float64(elapsed.Microseconds())/1000),
		"X-Powered-By":        "Webhook Catcher",
		"Cache-Control":       "no-cache, no-store",
	}

	for k, v := range responseHeaders {
		c.Set(k, v)
	}

	rawURL := string(c.Request().RequestURI())
	parsedURL, _ := url.Parse(rawURL)
	path := "/"
	if parsedURL != nil {
		path = parsedURL.Path
	}

	req := model.WebhookRequest{
		ID:              uuid.New().String(),
		Method:          c.Method(),
		Path:            path,
		Headers:         headers,
		QueryParams:     queryParams,
		Body:            body,
		ContentType:     c.Get("Content-Type"),
		ContentLength:   c.Request().Header.ContentLength(),
		RemoteAddr:      c.IP(),
		Host:            c.Hostname(),
		Timestamp:       start,
		ResponseTimeMs:  float64(elapsed.Microseconds()) / 1000,
		ResponseHeaders: responseHeaders,
		StatusCode:      200,
	}

	if err := h.Store.PushRequest(id, req); err != nil {
		log.Printf("push request: %v", err)
	}

	// Broadcast to WebSocket listeners
	go h.Hub.Broadcast(id, req)

	return c.JSON(fiber.Map{
		"success": true,
		"message": "Webhook received",
		"id":      req.ID,
	})
}
