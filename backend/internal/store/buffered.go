package store

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/webhooks/backend/internal/model"
)

/*
BufferedStore wraps a PostgreSQL store with a Dragonfly (Redis-compatible) write buffer.

Architecture:
  - HOT PATH  (PushRequest):  XADD to a Redis Stream per endpoint → ~0.5 ms
  - READS     (GetRequests):  Merge buffered (Dragonfly) + persisted (PostgreSQL)
  - FLUSH     (background):   Every flushInterval, drain streams into PostgreSQL batch inserts
  - Endpoints (CRUD/config):  Pass-through to PostgreSQL (low frequency, needs durability)
  - Endpoint existence cache: SET in Dragonfly with TTL to avoid hitting PG on every webhook
*/

const (
	streamPrefix   = "wh:stream:" // per-endpoint request stream
	existsPrefix   = "wh:exists:" // endpoint existence cache
	countPrefix    = "wh:count:"  // buffered request count
	configPrefix   = "wh:config:" // endpoint config cache
	existsTTL      = 10 * time.Minute
	configTTL      = 10 * time.Minute
	maxStreamLen   = 2000 // cap stream length per endpoint
	flushBatchSize = 500  // max rows per INSERT batch
)

// BufferedStore implements Store with Dragonfly buffer + Postgres persistence.
type BufferedStore struct {
	pg  *Postgres
	rdb *redis.Client

	flushInterval time.Duration
	stopCh        chan struct{}
	wg            sync.WaitGroup
}

// NewBufferedStore creates a new buffered store.
// It starts a background goroutine that flushes to Postgres periodically.
func NewBufferedStore(pg *Postgres, rdb *redis.Client, flushInterval time.Duration) *BufferedStore {
	bs := &BufferedStore{
		pg:            pg,
		rdb:           rdb,
		flushInterval: flushInterval,
		stopCh:        make(chan struct{}),
	}
	bs.wg.Add(1)
	go bs.flushLoop()
	return bs
}

// ─── Endpoint operations (pass-through to Postgres) ──────────────────────────

func (bs *BufferedStore) CreateEndpoint(id string) (model.Endpoint, error) {
	ep, err := bs.pg.CreateEndpoint(id)
	if err != nil {
		return ep, err
	}
	// Cache existence
	ctx := context.Background()
	bs.rdb.Set(ctx, existsPrefix+id, "1", existsTTL)
	return ep, nil
}

func (bs *BufferedStore) GetEndpoint(id string) (model.Endpoint, bool) {
	return bs.pg.GetEndpoint(id)
}

func (bs *BufferedStore) Exists(id string) bool {
	ctx := context.Background()
	// Check Dragonfly cache first
	val, err := bs.rdb.Get(ctx, existsPrefix+id).Result()
	if err == nil && val == "1" {
		return true
	}
	// Fallback to Postgres
	exists := bs.pg.Exists(id)
	if exists {
		bs.rdb.Set(ctx, existsPrefix+id, "1", existsTTL)
	}
	return exists
}

func (bs *BufferedStore) UpdateEndpointConfig(id string, cfg model.EndpointConfig) error {
	err := bs.pg.UpdateEndpointConfig(id, cfg)
	if err != nil {
		return err
	}
	// Invalidate cached config so next read fetches fresh data
	bs.rdb.Del(context.Background(), configPrefix+id)
	return nil
}

func (bs *BufferedStore) GetEndpointConfig(id string) (model.EndpointConfig, error) {
	ctx := context.Background()

	// Try Dragonfly cache first
	cached, err := bs.rdb.Get(ctx, configPrefix+id).Bytes()
	if err == nil {
		var cfg model.EndpointConfig
		if json.Unmarshal(cached, &cfg) == nil {
			return cfg, nil
		}
	}

	// Cache miss → hit Postgres
	cfg, err := bs.pg.GetEndpointConfig(id)
	if err != nil {
		return cfg, err
	}

	// Store in Dragonfly cache
	if data, e := json.Marshal(cfg); e == nil {
		bs.rdb.Set(ctx, configPrefix+id, data, configTTL)
	}

	return cfg, nil
}

// ─── PushRequest — fast path via Dragonfly stream ────────────────────────────

func (bs *BufferedStore) PushRequest(endpointID string, req model.WebhookRequest) error {
	ctx := context.Background()

	data, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	streamKey := streamPrefix + endpointID

	// XADD with MAXLEN ~ maxStreamLen to bound memory
	_, err = bs.rdb.XAdd(ctx, &redis.XAddArgs{
		Stream: streamKey,
		MaxLen: maxStreamLen,
		Approx: true,
		Values: map[string]interface{}{
			"data":        string(data),
			"endpoint_id": endpointID,
		},
	}).Result()
	if err != nil {
		return fmt.Errorf("xadd: %w", err)
	}

	// Increment buffered count
	bs.rdb.Incr(ctx, countPrefix+endpointID)

	return nil
}

// ─── Read operations — merge buffer + persisted ──────────────────────────────

func (bs *BufferedStore) GetRequests(endpointID string) ([]model.WebhookRequest, error) {
	// Get buffered requests from Dragonfly
	buffered := bs.getBufferedRequests(endpointID)

	// Get persisted requests from Postgres
	persisted, err := bs.pg.GetRequests(endpointID)
	if err != nil {
		return nil, err
	}

	// Merge: buffered first (newest), then persisted, deduplicate by ID
	return mergeRequests(buffered, persisted, 500), nil
}

func (bs *BufferedStore) GetRequestsPaginated(endpointID string, page, perPage int) (model.PaginatedRequests, error) {
	// Get all buffered + persisted to calculate correct totals
	buffered := bs.getBufferedRequests(endpointID)

	// Get persisted count from Postgres
	pgResult, err := bs.pg.GetRequestsPaginated(endpointID, 1, 1) // just for count
	if err != nil {
		return model.PaginatedRequests{Requests: []model.WebhookRequest{}, Page: page, PerPage: perPage}, err
	}

	// Build a deduped ID set from buffered
	bufferedIDs := make(map[string]bool, len(buffered))
	for _, r := range buffered {
		bufferedIDs[r.ID] = true
	}

	// Total = buffered unique + persisted not in buffer
	// Approximate: assume minimal overlap for speed
	totalBuffered := len(buffered)
	totalPersisted := pgResult.Total
	total := totalBuffered + totalPersisted

	totalPages := int(math.Ceil(float64(total) / float64(perPage)))
	if totalPages == 0 {
		totalPages = 1
	}

	// For page 1, serve from buffer first, then fill from Postgres
	offset := (page - 1) * perPage
	var merged []model.WebhookRequest

	if offset < totalBuffered {
		// Slice from buffer
		end := offset + perPage
		if end > totalBuffered {
			end = totalBuffered
		}
		merged = append(merged, buffered[offset:end]...)
	}

	// If we need more items from Postgres
	remaining := perPage - len(merged)
	if remaining > 0 {
		pgOffset := 0
		if offset > totalBuffered {
			pgOffset = offset - totalBuffered
		}
		pgPage := (pgOffset / perPage) + 1
		pgData, err := bs.pg.GetRequestsPaginated(endpointID, pgPage, remaining)
		if err == nil {
			// Filter out any that are already in buffer
			for _, r := range pgData.Requests {
				if !bufferedIDs[r.ID] {
					merged = append(merged, r)
					if len(merged) >= perPage {
						break
					}
				}
			}
		}
	}

	if merged == nil {
		merged = []model.WebhookRequest{}
	}

	return model.PaginatedRequests{
		Requests:   merged,
		Page:       page,
		PerPage:    perPage,
		Total:      total,
		TotalPages: totalPages,
	}, nil
}

// ─── ClearRequests — clear both Dragonfly and Postgres ───────────────────────

func (bs *BufferedStore) ClearRequests(endpointID string) error {
	ctx := context.Background()

	// Delete stream and counter from Dragonfly
	bs.rdb.Del(ctx, streamPrefix+endpointID, countPrefix+endpointID)

	// Clear from Postgres
	return bs.pg.ClearRequests(endpointID)
}

// ─── Close — flush remaining and shut down ───────────────────────────────────

func (bs *BufferedStore) Close() error {
	close(bs.stopCh)
	bs.wg.Wait()

	// Final flush
	bs.flushAll()

	return bs.pg.Close()
}

// ─── Background flush loop ───────────────────────────────────────────────────

func (bs *BufferedStore) flushLoop() {
	defer bs.wg.Done()
	ticker := time.NewTicker(bs.flushInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			bs.flushAll()
		case <-bs.stopCh:
			return
		}
	}
}

func (bs *BufferedStore) flushAll() {
	ctx := context.Background()

	// Scan for all active streams
	var cursor uint64
	pattern := streamPrefix + "*"
	for {
		keys, nextCursor, err := bs.rdb.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			log.Printf("flush scan error: %v", err)
			break
		}

		for _, key := range keys {
			endpointID := key[len(streamPrefix):]
			bs.flushEndpoint(ctx, endpointID)
		}

		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}
}

func (bs *BufferedStore) flushEndpoint(ctx context.Context, endpointID string) {
	streamKey := streamPrefix + endpointID

	// Read up to flushBatchSize entries from the beginning of the stream
	messages, err := bs.rdb.XRangeN(ctx, streamKey, "-", "+", int64(flushBatchSize)).Result()
	if err != nil || len(messages) == 0 {
		return
	}

	var flushed []string // message IDs to delete after successful insert
	var requests []model.WebhookRequest

	for _, msg := range messages {
		dataStr, ok := msg.Values["data"].(string)
		if !ok {
			flushed = append(flushed, msg.ID) // skip corrupt entry
			continue
		}

		var req model.WebhookRequest
		if err := json.Unmarshal([]byte(dataStr), &req); err != nil {
			log.Printf("flush unmarshal error: %v", err)
			flushed = append(flushed, msg.ID)
			continue
		}

		requests = append(requests, req)
		flushed = append(flushed, msg.ID)
	}

	// Batch insert into Postgres
	if len(requests) > 0 {
		if err := bs.batchInsert(ctx, endpointID, requests); err != nil {
			log.Printf("flush batch insert error (endpoint=%s, count=%d): %v", endpointID, len(requests), err)
			return // Don't delete from stream if insert failed
		}
	}

	// Remove flushed messages from stream
	if len(flushed) > 0 {
		if _, err := bs.rdb.XDel(ctx, streamKey, flushed...).Result(); err != nil {
			log.Printf("flush xdel error: %v", err)
		}
		// Decrement counter
		bs.rdb.DecrBy(ctx, countPrefix+endpointID, int64(len(flushed)))
	}

	// Trim old requests in Postgres (keep 500)
	_, _ = bs.pg.pool.Exec(ctx,
		`DELETE FROM requests WHERE endpoint_id = $1 AND id NOT IN (
			SELECT id FROM requests WHERE endpoint_id = $1
			ORDER BY created_at DESC LIMIT 500
		)`, endpointID)

	log.Printf("flushed %d requests for endpoint=%s", len(requests), endpointID)
}

func (bs *BufferedStore) batchInsert(ctx context.Context, endpointID string, requests []model.WebhookRequest) error {
	// Use a transaction for batch insert
	tx, err := bs.pg.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	for _, req := range requests {
		headersJSON, _ := json.Marshal(req.Headers)
		queryJSON, _ := json.Marshal(req.QueryParams)
		respHeadersJSON, _ := json.Marshal(req.ResponseHeaders)

		_, err := tx.Exec(ctx,
			`INSERT INTO requests
			 (id, endpoint_id, method, path, headers, query_params, body,
			  content_type, content_length, body_size, remote_addr, host, timestamp,
			  response_time_ms, response_headers, status_code)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
			 ON CONFLICT (id) DO NOTHING`,
			req.ID, endpointID, req.Method, req.Path,
			headersJSON, queryJSON, req.Body,
			req.ContentType, req.ContentLength, req.BodySize, req.RemoteAddr, req.Host,
			req.Timestamp, req.ResponseTimeMs, respHeadersJSON, req.StatusCode,
		)
		if err != nil {
			return fmt.Errorf("insert request %s: %w", req.ID, err)
		}
	}

	return tx.Commit(ctx)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func (bs *BufferedStore) getBufferedRequests(endpointID string) []model.WebhookRequest {
	ctx := context.Background()
	streamKey := streamPrefix + endpointID

	// Read all from stream (newest = last entries)
	messages, err := bs.rdb.XRange(ctx, streamKey, "-", "+").Result()
	if err != nil || len(messages) == 0 {
		return nil
	}

	var out []model.WebhookRequest
	for _, msg := range messages {
		dataStr, ok := msg.Values["data"].(string)
		if !ok {
			continue
		}
		var req model.WebhookRequest
		if err := json.Unmarshal([]byte(dataStr), &req); err != nil {
			continue
		}
		out = append(out, req)
	}

	// Sort newest first
	sort.Slice(out, func(i, j int) bool {
		return out[i].Timestamp.After(out[j].Timestamp)
	})

	return out
}

// mergeRequests deduplicates by ID, keeps newest first, capped at limit.
func mergeRequests(buffered, persisted []model.WebhookRequest, limit int) []model.WebhookRequest {
	seen := make(map[string]bool, len(buffered)+len(persisted))
	var out []model.WebhookRequest

	// Buffered requests are newer, add first
	for _, r := range buffered {
		if !seen[r.ID] {
			seen[r.ID] = true
			out = append(out, r)
		}
	}

	// Fill from persisted
	for _, r := range persisted {
		if !seen[r.ID] {
			seen[r.ID] = true
			out = append(out, r)
		}
	}

	// Sort newest first
	sort.Slice(out, func(i, j int) bool {
		return out[i].Timestamp.After(out[j].Timestamp)
	})

	if len(out) > limit {
		out = out[:limit]
	}

	if out == nil {
		out = []model.WebhookRequest{}
	}

	return out
}

// GetBufferedCount returns how many requests are in the Dragonfly buffer for an endpoint.
func (bs *BufferedStore) GetBufferedCount(endpointID string) int64 {
	ctx := context.Background()
	val, err := bs.rdb.Get(ctx, countPrefix+endpointID).Int64()
	if err != nil {
		return 0
	}
	return val
}

// FlushNow triggers an immediate flush (useful for testing or admin endpoints).
func (bs *BufferedStore) FlushNow() {
	bs.flushAll()
}

// GetRedisInfo returns Dragonfly connection info for health checks.
func (bs *BufferedStore) GetRedisInfo() string {
	ctx := context.Background()
	info, err := bs.rdb.Ping(ctx).Result()
	if err != nil {
		return fmt.Sprintf("error: %v", err)
	}
	return info
}
