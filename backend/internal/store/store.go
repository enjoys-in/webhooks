package store

import "github.com/webhooks/backend/internal/model"

// Store defines the contract for endpoint & request persistence.
// Both Memory and Postgres implementations satisfy this interface.
type Store interface {
	CreateEndpoint(id string) (model.Endpoint, error)
	GetEndpoint(id string) (model.Endpoint, bool)
	Exists(id string) bool
	PushRequest(endpointID string, req model.WebhookRequest) error
	GetRequests(endpointID string) ([]model.WebhookRequest, error)
	Close() error
}
