package store

import (
	"context"
	"encoding/json"
	"fmt"
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
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
	return err
}

// CreateEndpoint inserts a new endpoint row.
func (p *Postgres) CreateEndpoint(id string) (model.Endpoint, error) {
	ctx := context.Background()
	now := time.Now()
	_, err := p.pool.Exec(ctx,
		`INSERT INTO endpoints (id, created_at) VALUES ($1, $2)`, id, now)
	if err != nil {
		return model.Endpoint{}, fmt.Errorf("insert endpoint: %w", err)
	}
	return model.Endpoint{ID: id, CreatedAt: now}, nil
}

// GetEndpoint fetches endpoint metadata.
func (p *Postgres) GetEndpoint(id string) (model.Endpoint, bool) {
	ctx := context.Background()
	var ep model.Endpoint
	var count int
	err := p.pool.QueryRow(ctx,
		`SELECT e.id, e.created_at, COUNT(r.id)
		 FROM endpoints e
		 LEFT JOIN requests r ON r.endpoint_id = e.id
		 WHERE e.id = $1
		 GROUP BY e.id`, id).Scan(&ep.ID, &ep.CreatedAt, &count)
	if err != nil {
		return model.Endpoint{}, false
	}
	ep.RequestCount = count
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
		  content_type, content_length, remote_addr, host, timestamp,
		  response_time_ms, response_headers, status_code)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		req.ID, endpointID, req.Method, req.Path,
		headersJSON, queryJSON, req.Body,
		req.ContentType, req.ContentLength, req.RemoteAddr, req.Host,
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
		        content_type, content_length, remote_addr, host,
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
			&r.ContentType, &r.ContentLength, &r.RemoteAddr, &r.Host,
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

// Close shuts down the connection pool.
func (p *Postgres) Close() error {
	p.pool.Close()
	return nil
}
