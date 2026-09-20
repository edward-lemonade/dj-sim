package handler

import (
	"context"
	"net/http"

	"github.com/edward-lemonade/dj-sim-backend/internal/domain/user"
	"github.com/edward-lemonade/dj-sim-backend/internal/http/app_error"
	"github.com/edward-lemonade/dj-sim-backend/internal/http/middleware"
	"github.com/gin-gonic/gin"
)

type UserService interface {
	GetByClerkID(ctx context.Context, clerkID string) (*user.User, error)
	Register(ctx context.Context, clerkID, username string) (*user.User, error)
}

type UserHandler struct {
	Users UserService
}

type registerUserRequest struct {
	Username string `json:"username" binding:"required"`
}

func (h *UserHandler) Me(c *gin.Context) {
	u := middleware.CurrentUser(c)
	if u == nil {
		c.JSON(http.StatusOK, nil)
		return
	}
	c.JSON(http.StatusOK, u)
}

func (h *UserHandler) Register(c *gin.Context) {
	var req registerUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "username and handle are required"})
		return
	}

	if existing := middleware.CurrentUser(c); existing != nil {
		c.JSON(http.StatusOK, existing)
		return
	}

	u, err := h.Users.Register(c.Request.Context(), middleware.ClerkID(c), req.Username)
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	c.JSON(http.StatusCreated, u)
}
