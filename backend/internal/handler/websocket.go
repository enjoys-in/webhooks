package handler

import (
	"log"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/webhooks/backend/internal/store"
	"github.com/webhooks/backend/internal/ws"
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

		h.Hub.Register(endpointID, conn)
		defer func() {
			h.Hub.Unregister(endpointID, conn)
			conn.Close()
		}()

		log.Printf("ws connected: endpoint=%s", endpointID)

		// Keep-alive read loop
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				break
			}
		}
	})
}
