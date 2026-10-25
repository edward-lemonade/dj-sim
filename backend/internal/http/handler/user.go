package handler

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/edward-lemonade/dj-sim-backend/internal/domain/track"
	"github.com/edward-lemonade/dj-sim-backend/internal/domain/user"
	"github.com/edward-lemonade/dj-sim-backend/internal/http/app_error"
	"github.com/edward-lemonade/dj-sim-backend/internal/http/middleware"
	"github.com/gin-gonic/gin"
)

type UserService interface {
	GetByClerkID(ctx context.Context, clerkID string) (*user.User, error)
	Register(ctx context.Context, clerkID, username string) (*user.User, error)
	ClaimGuestSession(ctx context.Context, credential, clerkID, username string) (*user.User, bool, error)
	ResolveGuestSession(ctx context.Context, credential string, ttl time.Duration) (*user.User, error)
}

type GuestTrackLister interface {
	ListByUserID(ctx context.Context, userID string) ([]track.Track, error)
}

type UserHandler struct {
	Users       UserService
	Tracks      GuestTrackLister
	GuestCookie string
	GuestTTL    time.Duration
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

func (h *UserHandler) GuestSessionStatus(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	credential, err := c.Cookie(h.guestCookieName())
	if err != nil || credential == "" {
		c.JSON(http.StatusOK, gin.H{"hasGuestSession": false})
		return
	}

	guest, err := h.Users.ResolveGuestSession(c.Request.Context(), credential, h.GuestTTL)
	if errors.Is(err, user.ErrNotFound) || errors.Is(err, user.ErrGuestExpired) {
		h.clearGuestCookie(c)
		c.JSON(http.StatusOK, gin.H{"hasGuestSession": false})
		return
	}
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	tracks, err := h.Tracks.ListByUserID(c.Request.Context(), guest.ID)
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"hasGuestSession": true, "userId": guest.ID, "tracks": tracks})
}

func (h *UserHandler) ClaimGuest(c *gin.Context) {
	credential, err := c.Cookie(h.guestCookieName())
	if err != nil || credential == "" {
		u, err := h.Users.Register(c.Request.Context(), middleware.ClerkID(c), h.username(c))
		if err != nil {
			app_error.WriteError(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"claimed": false, "userId": u.ID})
		return
	}
	u, claimed, err := h.Users.ClaimGuestSession(c.Request.Context(), credential, middleware.ClerkID(c), h.username(c))
	if err != nil {
		if errors.Is(err, user.ErrGuestExpired) || errors.Is(err, user.ErrNotFound) {
			h.clearGuestCookie(c)
			u, registerErr := h.Users.Register(c.Request.Context(), middleware.ClerkID(c), h.username(c))
			if registerErr != nil {
				app_error.WriteError(c, registerErr)
				return
			}
			c.JSON(http.StatusOK, gin.H{"claimed": false, "userId": u.ID})
			return
		}
		app_error.WriteError(c, err)
		return
	}
	if claimed {
		h.clearGuestCookie(c)
		c.JSON(http.StatusOK, gin.H{"claimed": true, "userId": u.ID})
		return
	}
	u, err = h.Users.Register(c.Request.Context(), middleware.ClerkID(c), h.username(c))
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	h.clearGuestCookie(c)
	c.JSON(http.StatusOK, gin.H{"claimed": false, "userId": u.ID})
}

func (h *UserHandler) DeclineGuest(c *gin.Context) {
	h.clearGuestCookie(c)
	c.JSON(http.StatusOK, gin.H{"declined": true})
}

func (h *UserHandler) username(c *gin.Context) string {
	username := c.Query("username")
	if username == "" {
		return "DJ"
	}
	return username
}

func (h *UserHandler) guestCookieName() string {
	if h.GuestCookie == "" {
		return "dj_guest_session"
	}
	return h.GuestCookie
}

func (h *UserHandler) clearGuestCookie(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     h.guestCookieName(),
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})
}
