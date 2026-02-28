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
	BodySize        int                 `json:"body_size"`
	RemoteAddr      string              `json:"remote_addr"`
	Host            string              `json:"host"`
	Timestamp       time.Time           `json:"timestamp"`
	ResponseTimeMs  float64             `json:"response_time_ms"`
	ResponseHeaders map[string]string   `json:"response_headers"`
	StatusCode      int                 `json:"status_code"`
}

// AuthMode defines the authentication mode for an endpoint.
type AuthMode string

const (
	AuthNone     AuthMode = "none"
	AuthPassword AuthMode = "password"
	AuthToken    AuthMode = "token"
	AuthHMAC     AuthMode = "hmac"
)

// AuthLocation defines where the credential is sent.
type AuthLocation string

const (
	LocHeader AuthLocation = "header"
	LocQuery  AuthLocation = "query"
	LocBody   AuthLocation = "body"
)

// EndpointConfig holds per-endpoint configuration (auth, etc.).
type EndpointConfig struct {
	AuthMode     AuthMode     `json:"auth_mode"`
	AuthSecret   string       `json:"auth_secret,omitempty"`   // password, token, or HMAC secret
	AuthLocation AuthLocation `json:"auth_location,omitempty"` // header, query, body
	AuthKey      string       `json:"auth_key,omitempty"`      // the header/query/body field name
}

// Endpoint represents a single webhook URL namespace.
type Endpoint struct {
	ID           string         `json:"id"`
	CreatedAt    time.Time      `json:"created_at"`
	RequestCount int            `json:"request_count,omitempty"`
	Config       EndpointConfig `json:"config"`
}

// EndpointCreated is the response when creating a new endpoint.
type EndpointCreated struct {
	ID        string    `json:"id"`
	URL       string    `json:"url"`
	CreatedAt time.Time `json:"created_at"`
}

// PaginatedRequests wraps a page of requests with pagination metadata.
type PaginatedRequests struct {
	Requests   []WebhookRequest `json:"requests"`
	Page       int              `json:"page"`
	PerPage    int              `json:"per_page"`
	Total      int              `json:"total"`
	TotalPages int              `json:"total_pages"`
}
