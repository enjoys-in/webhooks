package ws

import (
	"encoding/json"
	"log"
	"sync"

	"github.com/gofiber/contrib/websocket"
	"github.com/webhooks/backend/internal/model"
)

// Hub manages WebSocket clients grouped by endpoint ID.
type Hub struct {
	// endpointID -> set of connections
	clients map[string]map[*websocket.Conn]bool
	mu      sync.RWMutex
}

// NewHub creates a ready-to-use Hub.
func NewHub() *Hub {
	return &Hub{
		clients: make(map[string]map[*websocket.Conn]bool),
	}
}

// Register adds a connection for the given endpoint.
func (h *Hub) Register(endpointID string, conn *websocket.Conn) {
	h.mu.Lock()
	if h.clients[endpointID] == nil {
		h.clients[endpointID] = make(map[*websocket.Conn]bool)
	}
	h.clients[endpointID][conn] = true
	h.mu.Unlock()
}

// Unregister removes a connection.
func (h *Hub) Unregister(endpointID string, conn *websocket.Conn) {
	h.mu.Lock()
	if conns, ok := h.clients[endpointID]; ok {
		delete(conns, conn)
		if len(conns) == 0 {
			delete(h.clients, endpointID)
		}
	}
	h.mu.Unlock()
}

// Broadcast sends a WebhookRequest to every client listening on that endpoint.
func (h *Hub) Broadcast(endpointID string, req model.WebhookRequest) {
	data, err := json.Marshal(req)
	if err != nil {
		return
	}

	h.mu.RLock()
	conns := h.clients[endpointID]
	h.mu.RUnlock()

	for conn := range conns {
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			log.Printf("ws write error: %v", err)
			conn.Close()
			h.Unregister(endpointID, conn)
		}
	}
}
