package handler

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"net/url"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/webhooks/backend/internal/model"
	"github.com/webhooks/backend/internal/store"
	"github.com/webhooks/backend/internal/ws"
)

// Webhook handles incoming webhook capture requests.
type Webhook struct {
	Store store.Store
	Hub   *ws.Hub
}

// Catch  ALL /webhook/:id
func (h *Webhook) Catch(c *fiber.Ctx) error {
	start := time.Now()
	id := c.Params("id")

	if !h.Store.Exists(id) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Endpoint not found"})
	}

	// --- Auth verification ---
	cfg, err := h.Store.GetEndpointConfig(id)
	if err == nil && cfg.AuthMode != model.AuthNone {
		if !h.verifyAuth(c, cfg) {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error":   "Unauthorized",
				"message": fmt.Sprintf("This endpoint requires %s authentication", string(cfg.AuthMode)),
			})
		}
	}

	// Collect raw request headers
	headers := make(map[string][]string)
	c.Request().Header.VisitAll(func(key, val []byte) {
		k := string(key)
		headers[k] = append(headers[k], string(val))
	})

	// Parse query params
	queryParams := make(map[string][]string)
	c.Request().URI().QueryArgs().VisitAll(func(key, val []byte) {
		k := string(key)
		queryParams[k] = append(queryParams[k], string(val))
	})

	body := string(c.Body())
	bodySize := len(c.Body())
	elapsed := time.Since(start)

	responseHeaders := map[string]string{
		"Content-Type":       "application/json",
		"X-Webhook-ID":       id,
		"X-Request-Received": start.Format(time.RFC3339Nano),
		"X-Response-Time-Ms": fmt.Sprintf("%.2f", float64(elapsed.Microseconds())/1000),
		"X-Powered-By":       "Webhook Catcher",
		"Cache-Control":      "no-cache, no-store",
	}

	for k, v := range responseHeaders {
		c.Set(k, v)
	}

	rawURL := string(c.Request().RequestURI())
	parsedURL, _ := url.Parse(rawURL)
	path := "/"
	if parsedURL != nil {
		path = parsedURL.Path
	}

	req := model.WebhookRequest{
		ID:              uuid.New().String(),
		Method:          c.Method(),
		Path:            path,
		Headers:         headers,
		QueryParams:     queryParams,
		Body:            body,
		ContentType:     c.Get("Content-Type"),
		ContentLength:   c.Request().Header.ContentLength(),
		BodySize:        bodySize,
		RemoteAddr:      c.IP(),
		Host:            c.Hostname(),
		Timestamp:       start,
		ResponseTimeMs:  float64(elapsed.Microseconds()) / 1000,
		ResponseHeaders: responseHeaders,
		StatusCode:      200,
	}
	// Broadcast to WebSocket listeners (synchronous to avoid goroutine race)
	h.Hub.Broadcast(id, req)
	if err := h.Store.PushRequest(id, req); err != nil {
		log.Printf("push request: %v", err)
	}

	return c.JSON(fiber.Map{
		"success": true,
		"message": "Webhook received",
		"id":      req.ID,
	})
}

// verifyAuth checks the incoming request against the endpoint's auth config.
func (h *Webhook) verifyAuth(c *fiber.Ctx, cfg model.EndpointConfig) bool {
	switch cfg.AuthMode {
	case model.AuthPassword, model.AuthToken:
		secret := h.extractCredential(c, cfg.AuthLocation, cfg.AuthKey)
		return secret != "" && secret == cfg.AuthSecret

	case model.AuthHMAC:
		// HMAC always reads signature from a header
		headerName := cfg.AuthKey
		if headerName == "" {
			headerName = "X-Hub-Signature-256"
		}
		sigHeader := c.Get(headerName)
		if sigHeader == "" {
			return false
		}
		// Strip "sha256=" prefix if present
		if len(sigHeader) > 7 && sigHeader[:7] == "sha256=" {
			sigHeader = sigHeader[7:]
		}

		mac := hmac.New(sha256.New, []byte(cfg.AuthSecret))
		mac.Write(c.Body())
		expectedMAC := hex.EncodeToString(mac.Sum(nil))

		return hmac.Equal([]byte(sigHeader), []byte(expectedMAC))
	}

	return true
}

// extractCredential reads the credential value from the configured location + key.
func (h *Webhook) extractCredential(c *fiber.Ctx, loc model.AuthLocation, key string) string {
	switch loc {
	case model.LocHeader:
		if key == "" {
			return ""
		}
		val := c.Get(key)
		// Also support "Bearer <token>" in Authorization header
		if key == "Authorization" && len(val) > 7 && val[:7] == "Bearer " {
			return val[7:]
		}
		return val

	case model.LocQuery:
		if key == "" {
			return ""
		}
		return c.Query(key)

	case model.LocBody:
		if key == "" {
			return ""
		}
		// Try JSON body first
		ct := c.Get("Content-Type")
		if ct == "application/json" || ct == "application/json; charset=utf-8" {
			var bodyMap map[string]interface{}
			if err := c.BodyParser(&bodyMap); err == nil {
				if v, ok := bodyMap[key]; ok {
					return fmt.Sprintf("%v", v)
				}
			}
		}
		// Try form field
		return c.FormValue(key)
	}

	return ""
}
