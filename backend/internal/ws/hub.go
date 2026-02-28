package ws

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/gofiber/contrib/websocket"
	"github.com/webhooks/backend/internal/model"
)

const (
	// Time allowed to write a message to the peer.
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer.
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait.
	pingPeriod = 30 * time.Second
)

// ConnEntry wraps a WebSocket connection with its own write mutex.
// gorilla/websocket only supports one concurrent writer, so we serialize writes.
type ConnEntry struct {
	Conn *websocket.Conn
	Mu   sync.Mutex
}

// Hub manages WebSocket clients grouped by endpoint ID.
type Hub struct {
	clients map[string]map[*websocket.Conn]*ConnEntry
	mu      sync.RWMutex
}

// NewHub creates a ready-to-use Hub.
func NewHub() *Hub {
	return &Hub{
		clients: make(map[string]map[*websocket.Conn]*ConnEntry),
	}
}

// Register adds a connection for the given endpoint and returns
// the ConnEntry so the caller can share the write mutex for pings.
func (h *Hub) Register(endpointID string, conn *websocket.Conn) *ConnEntry {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.clients[endpointID] == nil {
		h.clients[endpointID] = make(map[*websocket.Conn]*ConnEntry)
	}
	entry := &ConnEntry{Conn: conn}
	h.clients[endpointID][conn] = entry
	log.Printf("ws register: hub=%p endpoint=%s conn=%p total=%d", h, endpointID, conn, len(h.clients[endpointID]))
	return entry
}

// Unregister removes a connection.
func (h *Hub) Unregister(endpointID string, conn *websocket.Conn) {
	h.mu.Lock()
	if conns, ok := h.clients[endpointID]; ok {
		delete(conns, conn)
		remaining := len(conns)
		if remaining == 0 {
			delete(h.clients, endpointID)
		}
		log.Printf("ws unregister: endpoint=%s conn=%p remaining=%d", endpointID, conn, remaining)
	}
	h.mu.Unlock()
}

// ClientCount returns how many WS clients are listening on the endpoint.
func (h *Hub) ClientCount(endpointID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients[endpointID])
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
	// Diagnostic: dump full hub state
	allEndpoints := make([]string, 0, len(h.clients))
	for eid, conns := range h.clients {
		allEndpoints = append(allEndpoints, fmt.Sprintf("%s(%d)", eid[:8], len(conns)))
	}
	log.Printf("ws broadcast: hub=%p endpoint=%s hub_state=%v", h, endpointID, allEndpoints)

	entries := make([]*ConnEntry, 0, len(h.clients[endpointID]))
	for _, entry := range h.clients[endpointID] {
		entries = append(entries, entry)
	}
	h.mu.RUnlock()

	if len(entries) == 0 {
		log.Printf("ws broadcast: 0 clients for endpoint=%s (message dropped)", endpointID)
		return
	}

	sent := 0
	for _, entry := range entries {
		// Per-connection write mutex — prevents concurrent writes to same conn
		entry.Mu.Lock()
		entry.Conn.SetWriteDeadline(time.Now().Add(writeWait))
		err := entry.Conn.WriteMessage(websocket.TextMessage, data)
		entry.Mu.Unlock()

		if err != nil {
			log.Printf("ws write error (endpoint=%s): %v", endpointID, err)
			entry.Conn.Close()
			h.Unregister(endpointID, entry.Conn)
		} else {
			sent++
		}
	}
	log.Printf("ws broadcast: sent to %d/%d clients for endpoint=%s", sent, len(entries), endpointID)
}
