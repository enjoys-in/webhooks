package handler

import (
	"fmt"
	"log"
	"strconv"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/webhooks/backend/internal/model"
	"github.com/webhooks/backend/internal/store"
)

// Endpoint groups the /api/endpoints routes.
type Endpoint struct {
	Store store.Store
}

// Create  POST /api/endpoints
func (h *Endpoint) Create(c *fiber.Ctx) error {
	id := uuid.New().String()
	ep, err := h.Store.CreateEndpoint(id)
	if err != nil {
		log.Printf("create endpoint: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create endpoint"})
	}

	return c.JSON(model.EndpointCreated{
		ID:        ep.ID,
		URL:       fmt.Sprintf("/webhook/%s", ep.ID),
		CreatedAt: ep.CreatedAt,
	})
}

// Get  GET /api/endpoints/:id
func (h *Endpoint) Get(c *fiber.Ctx) error {
	id := c.Params("id")
	ep, ok := h.Store.GetEndpoint(id)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Endpoint not found"})
	}
	return c.JSON(ep)
}

// GetRequests  GET /api/endpoints/:id/requests
func (h *Endpoint) GetRequests(c *fiber.Ctx) error {
	id := c.Params("id")
	reqs, err := h.Store.GetRequests(id)
	if err != nil {
		log.Printf("get requests: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch requests"})
	}
	return c.JSON(reqs)
}

// GetRequestsPaginated  GET /api/endpoints/:id/requests/page
func (h *Endpoint) GetRequestsPaginated(c *fiber.Ctx) error {
	id := c.Params("id")

	page, _ := strconv.Atoi(c.Query("page", "1"))
	perPage, _ := strconv.Atoi(c.Query("per_page", "100"))
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 500 {
		perPage = 100
	}

	result, err := h.Store.GetRequestsPaginated(id, page, perPage)
	if err != nil {
		log.Printf("get requests paginated: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch requests"})
	}
	return c.JSON(result)
}

// ClearRequests  DELETE /api/endpoints/:id/requests
func (h *Endpoint) ClearRequests(c *fiber.Ctx) error {
	id := c.Params("id")
	if !h.Store.Exists(id) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Endpoint not found"})
	}
	if err := h.Store.ClearRequests(id); err != nil {
		log.Printf("clear requests: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to clear requests"})
	}
	return c.JSON(fiber.Map{"success": true, "message": "All requests cleared"})
}

// UpdateConfig  PUT /api/endpoints/:id/config
func (h *Endpoint) UpdateConfig(c *fiber.Ctx) error {
	id := c.Params("id")
	if !h.Store.Exists(id) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Endpoint not found"})
	}

	var cfg model.EndpointConfig
	if err := c.BodyParser(&cfg); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	// Validate auth mode
	switch cfg.AuthMode {
	case model.AuthNone, model.AuthPassword, model.AuthToken, model.AuthHMAC:
	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid auth_mode. Use: none, password, token, hmac"})
	}

	if cfg.AuthMode != model.AuthNone && cfg.AuthSecret == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "auth_secret is required when auth_mode is not 'none'"})
	}

	if err := h.Store.UpdateEndpointConfig(id, cfg); err != nil {
		log.Printf("update config: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update config"})
	}

	return c.JSON(fiber.Map{"success": true, "config": cfg})
}

// GetConfig  GET /api/endpoints/:id/config
func (h *Endpoint) GetConfig(c *fiber.Ctx) error {
	id := c.Params("id")
	if !h.Store.Exists(id) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Endpoint not found"})
	}

	cfg, err := h.Store.GetEndpointConfig(id)
	if err != nil {
		log.Printf("get config: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to get config"})
	}

	return c.JSON(cfg)
}
