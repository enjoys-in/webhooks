package model

import "time"

// WebhookRequest stores a captured incoming webhook request.
type WebhookRequest struct {
	ID              string              `json:"id"`
	Method          string              `json:"method"`
	Path            string              `json:"path"`
	Headers         map[string][]string `json:"headers"`
	QueryParams     map[string][]string `json:"query_params"`
	Body            string              `json:"body"`
	ContentType     string              `json:"content_type"`
	ContentLength   int                 `json:"content_length"`
	RemoteAddr      string              `json:"remote_addr"`
	Host            string              `json:"host"`
	Timestamp       time.Time           `json:"timestamp"`
	ResponseTimeMs  float64             `json:"response_time_ms"`
	ResponseHeaders map[string]string   `json:"response_headers"`
	StatusCode      int                 `json:"status_code"`
}

// Endpoint represents a single webhook URL namespace.
type Endpoint struct {
	ID           string    `json:"id"`
	CreatedAt    time.Time `json:"created_at"`
	RequestCount int       `json:"request_count,omitempty"`
}

// EndpointCreated is the response when creating a new endpoint.
type EndpointCreated struct {
	ID        string    `json:"id"`
	URL       string    `json:"url"`
	CreatedAt time.Time `json:"created_at"`
}
