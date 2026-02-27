package handler

import (
	"fmt"
	"log"

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
