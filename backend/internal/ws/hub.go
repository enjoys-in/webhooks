package ws

import (
	"encoding/json"
	"log"
	"sync"

	"github.com/gofiber/contrib/websocket"
	"github.com/webhooks/backend/internal/model"
)

// connEntry wraps a WebSocket connection with its own write mutex.
// gorilla/websocket only supports one concurrent writer, so we serialize writes.
type connEntry struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

// Hub manages WebSocket clients grouped by endpoint ID.
type Hub struct {
	clients map[string]map[*websocket.Conn]*connEntry
	mu      sync.RWMutex
}

// NewHub creates a ready-to-use Hub.
func NewHub() *Hub {
	return &Hub{
		clients: make(map[string]map[*websocket.Conn]*connEntry),
	}
}

// Register adds a connection for the given endpoint.
func (h *Hub) Register(endpointID string, conn *websocket.Conn) {
	h.mu.Lock()
	if h.clients[endpointID] == nil {
		h.clients[endpointID] = make(map[*websocket.Conn]*connEntry)
	}
	h.clients[endpointID][conn] = &connEntry{conn: conn}
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
		log.Printf("ws marshal error: %v", err)
		return
	}

	// Snapshot entries under read-lock
	h.mu.RLock()
	entries := make([]*connEntry, 0, len(h.clients[endpointID]))
	for _, entry := range h.clients[endpointID] {
		entries = append(entries, entry)
	}
	h.mu.RUnlock()

	for _, entry := range entries {
		// Per-connection write mutex — prevents concurrent writes to same conn
		entry.mu.Lock()
		err := entry.conn.WriteMessage(websocket.TextMessage, data)
		entry.mu.Unlock()

		if err != nil {
			log.Printf("ws write error: %v", err)
			entry.conn.Close()
			h.Unregister(endpointID, entry.conn)
		}
	}
}
