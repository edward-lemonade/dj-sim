package handler

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/svix/svix-webhooks/go"
)

const maxClerkWebhookBody = 1 << 20

type AccountDeleter interface {
	DeleteByClerkID(ctx context.Context, clerkID string) error
}

type ClerkWebhookHandler struct {
	Users  AccountDeleter
	Secret string
}

type clerkWebhookEvent struct {
	Type string `json:"type"`
	Data struct {
		ID string `json:"id"`
	} `json:"data"`
}

func (h *ClerkWebhookHandler) Handle(c *gin.Context) {
	if h.Secret == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Clerk webhook is not configured"})
		return
	}
	webhook, err := svix.NewWebhook(h.Secret)
	if err != nil {
		log.Printf("invalid Clerk webhook configuration: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Clerk webhook is not configured"})
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxClerkWebhookBody)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid webhook body"})
		return
	}
	if err := webhook.Verify(body, c.Request.Header); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid webhook signature"})
		return
	}

	var event clerkWebhookEvent
	if err := json.Unmarshal(body, &event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid webhook payload"})
		return
	}
	if event.Type != "user.deleted" {
		c.Status(http.StatusOK)
		return
	}
	if event.Data.ID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "deleted user ID is required"})
		return
	}

	if err := h.Users.DeleteByClerkID(c.Request.Context(), event.Data.ID); err != nil {
		log.Printf("failed to delete data for Clerk user %q: %v", event.Data.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete user data"})
		return
	}
	c.Status(http.StatusOK)
}
