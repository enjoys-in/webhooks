package store

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/webhooks/backend/internal/model"
)

// Postgres implements Store backed by PostgreSQL.
type Postgres struct {
	pool *pgxpool.Pool
}

// NewPostgres connects to PostgreSQL and runs migrations.
func NewPostgres(dsn string) (*Postgres, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("pgx connect: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("pgx ping: %w", err)
	}

	pg := &Postgres{pool: pool}
	if err := pg.migrate(ctx); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}

	return pg, nil
}

// migrate creates tables if they don't exist.
func (p *Postgres) migrate(ctx context.Context) error {
	sql := `
	CREATE TABLE IF NOT EXISTS endpoints (
		id         TEXT PRIMARY KEY,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		auth_mode  TEXT NOT NULL DEFAULT 'none',
		auth_secret TEXT NOT NULL DEFAULT ''
	);

	CREATE TABLE IF NOT EXISTS requests (
		id               TEXT PRIMARY KEY,
		endpoint_id      TEXT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
		method           TEXT NOT NULL,
		path             TEXT NOT NULL,
		headers          JSONB NOT NULL DEFAULT '{}',
		query_params     JSONB NOT NULL DEFAULT '{}',
		body             TEXT NOT NULL DEFAULT '',
		content_type     TEXT NOT NULL DEFAULT '',
		content_length   INT NOT NULL DEFAULT 0,
		body_size        INT NOT NULL DEFAULT 0,
		remote_addr      TEXT NOT NULL DEFAULT '',
		host             TEXT NOT NULL DEFAULT '',
		timestamp        TIMESTAMPTZ NOT NULL,
		response_time_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
		response_headers JSONB NOT NULL DEFAULT '{}',
		status_code      INT NOT NULL DEFAULT 200,
		created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE INDEX IF NOT EXISTS idx_requests_endpoint ON requests(endpoint_id, created_at DESC);
	`
	_, err := p.pool.Exec(ctx, sql)
	if err != nil {
		return err
	}

	// Add columns if missing (idempotent migration for existing DBs)
	migrations := []string{
		`ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS auth_mode TEXT NOT NULL DEFAULT 'none'`,
		`ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS auth_secret TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS auth_location TEXT NOT NULL DEFAULT 'header'`,
		`ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS auth_key TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE requests ADD COLUMN IF NOT EXISTS body_size INT NOT NULL DEFAULT 0`,
	}
	for _, m := range migrations {
		_, _ = p.pool.Exec(ctx, m)
	}

	return nil
}

// CreateEndpoint inserts a new endpoint row.
func (p *Postgres) CreateEndpoint(id string) (model.Endpoint, error) {
	ctx := context.Background()
	now := time.Now()
	_, err := p.pool.Exec(ctx,
		`INSERT INTO endpoints (id, created_at, auth_mode, auth_secret) VALUES ($1, $2, $3, $4)`,
		id, now, string(model.AuthNone), "")
	if err != nil {
		return model.Endpoint{}, fmt.Errorf("insert endpoint: %w", err)
	}
	return model.Endpoint{
		ID:        id,
		CreatedAt: now,
		Config:    model.EndpointConfig{AuthMode: model.AuthNone},
	}, nil
}

// GetEndpoint fetches endpoint metadata.
func (p *Postgres) GetEndpoint(id string) (model.Endpoint, bool) {
	ctx := context.Background()
	var ep model.Endpoint
	var count int
	var authMode, authSecret string
	err := p.pool.QueryRow(ctx,
		`SELECT e.id, e.created_at, e.auth_mode, e.auth_secret, COUNT(r.id)
		 FROM endpoints e
		 LEFT JOIN requests r ON r.endpoint_id = e.id
		 WHERE e.id = $1
		 GROUP BY e.id`, id).Scan(&ep.ID, &ep.CreatedAt, &authMode, &authSecret, &count)
	if err != nil {
		return model.Endpoint{}, false
	}
	ep.RequestCount = count
	ep.Config = model.EndpointConfig{
		AuthMode:   model.AuthMode(authMode),
		AuthSecret: authSecret,
	}
	return ep, true
}

// Exists checks if an endpoint exists.
func (p *Postgres) Exists(id string) bool {
	ctx := context.Background()
	var exists bool
	_ = p.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM endpoints WHERE id = $1)`, id).Scan(&exists)
	return exists
}

// PushRequest inserts a request and trims old ones (keep latest 500).
func (p *Postgres) PushRequest(endpointID string, req model.WebhookRequest) error {
	ctx := context.Background()

	headersJSON, _ := json.Marshal(req.Headers)
	queryJSON, _ := json.Marshal(req.QueryParams)
	respHeadersJSON, _ := json.Marshal(req.ResponseHeaders)

	_, err := p.pool.Exec(ctx,
		`INSERT INTO requests
		 (id, endpoint_id, method, path, headers, query_params, body,
		  content_type, content_length, body_size, remote_addr, host, timestamp,
		  response_time_ms, response_headers, status_code)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
		req.ID, endpointID, req.Method, req.Path,
		headersJSON, queryJSON, req.Body,
		req.ContentType, req.ContentLength, req.BodySize, req.RemoteAddr, req.Host,
		req.Timestamp, req.ResponseTimeMs, respHeadersJSON, req.StatusCode,
	)
	if err != nil {
		return fmt.Errorf("insert request: %w", err)
	}

	// Trim: keep only latest 500 per endpoint
	_, _ = p.pool.Exec(ctx,
		`DELETE FROM requests WHERE endpoint_id = $1 AND id NOT IN (
			SELECT id FROM requests WHERE endpoint_id = $1
			ORDER BY created_at DESC LIMIT 500
		)`, endpointID)

	return nil
}

// GetRequests fetches all requests for an endpoint (newest first).
func (p *Postgres) GetRequests(endpointID string) ([]model.WebhookRequest, error) {
	ctx := context.Background()

	rows, err := p.pool.Query(ctx,
		`SELECT id, method, path, headers, query_params, body,
		        content_type, content_length, body_size, remote_addr, host,
		        timestamp, response_time_ms, response_headers, status_code
		 FROM requests
		 WHERE endpoint_id = $1
		 ORDER BY created_at DESC
		 LIMIT 500`, endpointID)
	if err != nil {
		return nil, fmt.Errorf("query requests: %w", err)
	}
	defer rows.Close()

	var out []model.WebhookRequest
	for rows.Next() {
		var r model.WebhookRequest
		var headersJSON, queryJSON, respHeadersJSON []byte

		if err := rows.Scan(
			&r.ID, &r.Method, &r.Path,
			&headersJSON, &queryJSON, &r.Body,
			&r.ContentType, &r.ContentLength, &r.BodySize, &r.RemoteAddr, &r.Host,
			&r.Timestamp, &r.ResponseTimeMs, &respHeadersJSON, &r.StatusCode,
		); err != nil {
			return nil, fmt.Errorf("scan request: %w", err)
		}

		_ = json.Unmarshal(headersJSON, &r.Headers)
		_ = json.Unmarshal(queryJSON, &r.QueryParams)
		_ = json.Unmarshal(respHeadersJSON, &r.ResponseHeaders)

		out = append(out, r)
	}

	if out == nil {
		out = []model.WebhookRequest{}
	}
	return out, nil
}

// GetRequestsPaginated fetches a page of requests for an endpoint.
func (p *Postgres) GetRequestsPaginated(endpointID string, page, perPage int) (model.PaginatedRequests, error) {
	ctx := context.Background()
	result := model.PaginatedRequests{
		Requests: []model.WebhookRequest{},
		Page:     page,
		PerPage:  perPage,
	}

	// Get total count
	var total int
	err := p.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM requests WHERE endpoint_id = $1`, endpointID).Scan(&total)
	if err != nil {
		return result, fmt.Errorf("count requests: %w", err)
	}
	result.Total = total
	result.TotalPages = int(math.Ceil(float64(total) / float64(perPage)))
	if result.TotalPages == 0 {
		result.TotalPages = 1
	}

	offset := (page - 1) * perPage
	rows, err := p.pool.Query(ctx,
		`SELECT id, method, path, headers, query_params, body,
		        content_type, content_length, body_size, remote_addr, host,
		        timestamp, response_time_ms, response_headers, status_code
		 FROM requests
		 WHERE endpoint_id = $1
		 ORDER BY created_at DESC
		 LIMIT $2 OFFSET $3`, endpointID, perPage, offset)
	if err != nil {
		return result, fmt.Errorf("query requests: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var r model.WebhookRequest
		var headersJSON, queryJSON, respHeadersJSON []byte

		if err := rows.Scan(
			&r.ID, &r.Method, &r.Path,
			&headersJSON, &queryJSON, &r.Body,
			&r.ContentType, &r.ContentLength, &r.BodySize, &r.RemoteAddr, &r.Host,
			&r.Timestamp, &r.ResponseTimeMs, &respHeadersJSON, &r.StatusCode,
		); err != nil {
			return result, fmt.Errorf("scan request: %w", err)
		}

		_ = json.Unmarshal(headersJSON, &r.Headers)
		_ = json.Unmarshal(queryJSON, &r.QueryParams)
		_ = json.Unmarshal(respHeadersJSON, &r.ResponseHeaders)

		result.Requests = append(result.Requests, r)
	}

	return result, nil
}

// ClearRequests removes all requests for an endpoint.
func (p *Postgres) ClearRequests(endpointID string) error {
	ctx := context.Background()
	_, err := p.pool.Exec(ctx,
		`DELETE FROM requests WHERE endpoint_id = $1`, endpointID)
	if err != nil {
		return fmt.Errorf("clear requests: %w", err)
	}
	return nil
}

// UpdateEndpointConfig updates auth configuration for an endpoint.
func (p *Postgres) UpdateEndpointConfig(id string, cfg model.EndpointConfig) error {
	ctx := context.Background()
	_, err := p.pool.Exec(ctx,
		`UPDATE endpoints SET auth_mode = $2, auth_secret = $3, auth_location = $4, auth_key = $5 WHERE id = $1`,
		id, string(cfg.AuthMode), cfg.AuthSecret, string(cfg.AuthLocation), cfg.AuthKey)
	if err != nil {
		return fmt.Errorf("update endpoint config: %w", err)
	}
	return nil
}

// GetEndpointConfig returns the auth configuration for an endpoint.
func (p *Postgres) GetEndpointConfig(id string) (model.EndpointConfig, error) {
	ctx := context.Background()
	var authMode, authSecret, authLocation, authKey string
	err := p.pool.QueryRow(ctx,
		`SELECT auth_mode, auth_secret, auth_location, auth_key FROM endpoints WHERE id = $1`, id).Scan(&authMode, &authSecret, &authLocation, &authKey)
	if err != nil {
		return model.EndpointConfig{}, fmt.Errorf("get endpoint config: %w", err)
	}
	return model.EndpointConfig{
		AuthMode:     model.AuthMode(authMode),
		AuthSecret:   authSecret,
		AuthLocation: model.AuthLocation(authLocation),
		AuthKey:      authKey,
	}, nil
}

// Close shuts down the connection pool.
func (p *Postgres) Close() error {
	p.pool.Close()
	return nil
}
