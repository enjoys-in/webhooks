package store

import (
	"fmt"
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
	config    model.EndpointConfig
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
		config:    model.EndpointConfig{AuthMode: model.AuthNone},
	}
	m.mu.Lock()
	m.endpoints[id] = ep
	m.mu.Unlock()

	return model.Endpoint{ID: id, CreatedAt: ep.createdAt, Config: ep.config}, nil
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
	cfg := ep.config
	ep.mu.RUnlock()
	return model.Endpoint{ID: ep.id, CreatedAt: ep.createdAt, RequestCount: count, Config: cfg}, true
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

// GetRequestsPaginated returns a page of requests for an endpoint.
func (m *Memory) GetRequestsPaginated(id string, page, perPage int) (model.PaginatedRequests, error) {
	m.mu.RLock()
	ep, ok := m.endpoints[id]
	m.mu.RUnlock()
	if !ok {
		return model.PaginatedRequests{Requests: []model.WebhookRequest{}, Page: page, PerPage: perPage}, nil
	}

	ep.mu.RLock()
	total := len(ep.requests)
	start := (page - 1) * perPage
	if start > total {
		start = total
	}
	end := start + perPage
	if end > total {
		end = total
	}
	slice := make([]model.WebhookRequest, end-start)
	copy(slice, ep.requests[start:end])
	ep.mu.RUnlock()

	totalPages := (total + perPage - 1) / perPage
	if totalPages == 0 {
		totalPages = 1
	}

	return model.PaginatedRequests{
		Requests:   slice,
		Page:       page,
		PerPage:    perPage,
		Total:      total,
		TotalPages: totalPages,
	}, nil
}

// ClearRequests removes all stored requests for an endpoint.
func (m *Memory) ClearRequests(id string) error {
	m.mu.RLock()
	ep, ok := m.endpoints[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("endpoint %s not found", id)
	}
	ep.mu.Lock()
	ep.requests = ep.requests[:0]
	ep.mu.Unlock()
	return nil
}

// UpdateEndpointConfig updates the auth configuration for an endpoint.
func (m *Memory) UpdateEndpointConfig(id string, cfg model.EndpointConfig) error {
	m.mu.RLock()
	ep, ok := m.endpoints[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("endpoint %s not found", id)
	}
	ep.mu.Lock()
	ep.config = cfg
	ep.mu.Unlock()
	return nil
}

// GetEndpointConfig returns the auth configuration for an endpoint.
func (m *Memory) GetEndpointConfig(id string) (model.EndpointConfig, error) {
	m.mu.RLock()
	ep, ok := m.endpoints[id]
	m.mu.RUnlock()
	if !ok {
		return model.EndpointConfig{}, fmt.Errorf("endpoint %s not found", id)
	}
	ep.mu.RLock()
	cfg := ep.config
	ep.mu.RUnlock()
	return cfg, nil
}

// Close is a no-op for the memory store.
func (m *Memory) Close() error { return nil }
