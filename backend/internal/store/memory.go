package store

import (
	"sync"
	"time"

	"github.com/webhooks/backend/internal/model"
)

const maxRequests = 500

// endpoint is the internal representation that includes the request slice.
type endpoint struct {
	id        string
	createdAt time.Time
	requests  []model.WebhookRequest
	mu        sync.RWMutex
}

// Memory is a concurrency-safe in-memory store for endpoints & requests.
// It implements the Store interface.
type Memory struct {
	endpoints map[string]*endpoint
	mu        sync.RWMutex
}

// NewMemory returns an initialised memory store.
func NewMemory() *Memory {
	return &Memory{
		endpoints: make(map[string]*endpoint),
	}
}

// CreateEndpoint registers a new endpoint and returns its metadata.
func (m *Memory) CreateEndpoint(id string) (model.Endpoint, error) {
	ep := &endpoint{
		id:        id,
		createdAt: time.Now(),
		requests:  make([]model.WebhookRequest, 0, 64),
	}
	m.mu.Lock()
	m.endpoints[id] = ep
	m.mu.Unlock()

	return model.Endpoint{ID: id, CreatedAt: ep.createdAt}, nil
}

// GetEndpoint returns endpoint metadata if it exists.
func (m *Memory) GetEndpoint(id string) (model.Endpoint, bool) {
	m.mu.RLock()
	ep, ok := m.endpoints[id]
	m.mu.RUnlock()
	if !ok {
		return model.Endpoint{}, false
	}
	ep.mu.RLock()
	count := len(ep.requests)
	ep.mu.RUnlock()
	return model.Endpoint{ID: ep.id, CreatedAt: ep.createdAt, RequestCount: count}, true
}

// Exists checks whether an endpoint is registered.
func (m *Memory) Exists(id string) bool {
	m.mu.RLock()
	_, ok := m.endpoints[id]
	m.mu.RUnlock()
	return ok
}

// PushRequest prepends a request (newest-first) and trims to maxRequests.
func (m *Memory) PushRequest(endpointID string, req model.WebhookRequest) error {
	m.mu.RLock()
	ep, ok := m.endpoints[endpointID]
	m.mu.RUnlock()
	if !ok {
		return nil
	}

	ep.mu.Lock()
	ep.requests = append([]model.WebhookRequest{req}, ep.requests...)
	if len(ep.requests) > maxRequests {
		ep.requests = ep.requests[:maxRequests]
	}
	ep.mu.Unlock()
	return nil
}

// GetRequests returns all stored requests for an endpoint.
func (m *Memory) GetRequests(id string) ([]model.WebhookRequest, error) {
	m.mu.RLock()
	ep, ok := m.endpoints[id]
	m.mu.RUnlock()
	if !ok {
		return nil, nil
	}
	ep.mu.RLock()
	out := make([]model.WebhookRequest, len(ep.requests))
	copy(out, ep.requests)
	ep.mu.RUnlock()
	return out, nil
}

// Close is a no-op for the memory store.
func (m *Memory) Close() error { return nil }
