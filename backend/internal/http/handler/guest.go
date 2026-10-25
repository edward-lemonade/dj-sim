package handler

import (
	"context"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/edward-lemonade/dj-sim-backend/internal/domain/user"
	"github.com/edward-lemonade/dj-sim-backend/internal/http/middleware"
	"github.com/gin-gonic/gin"
)

type GuestSessionService interface {
	CreateGuestSession(ctx context.Context, tokenHash string, ttl time.Duration) (*user.User, error)
	ResolveGuestSession(ctx context.Context, credential string, ttl time.Duration) (*user.User, error)
}

type GuestSessionHandler struct {
	Users  GuestSessionService
	Cookie middleware.GuestCookieOptions
}

func (h *GuestSessionHandler) Create(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	credential, err := c.Cookie(h.CookieName())
	if err == nil && credential != "" {
		guest, resolveErr := h.Users.ResolveGuestSession(c.Request.Context(), credential, h.Cookie.TTL)
		if resolveErr == nil {
			h.setCookie(c, credential)
			c.JSON(http.StatusOK, gin.H{"userId": guest.ID})
			return
		}
		if !errors.Is(resolveErr, user.ErrNotFound) && !errors.Is(resolveErr, user.ErrGuestExpired) {
			log.Printf("guest session resolution failed: %v", resolveErr)
			c.JSON(http.StatusInternalServerError, gin.H{"message": "could not resolve guest session"})
			return
		}
	}

	credential, tokenHash, err := user.NewGuestCredential()
	if err != nil {
		log.Printf("guest credential creation failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"message": "could not create guest session"})
		return
	}
	guest, err := h.Users.CreateGuestSession(c.Request.Context(), tokenHash, h.Cookie.TTL)
	if err != nil {
		log.Printf("guest session persistence failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"message": "could not create guest session"})
		return
	}
	h.setCookie(c, credential)
	c.JSON(http.StatusCreated, gin.H{"userId": guest.ID})
}

func (h *GuestSessionHandler) CookieName() string {
	if h.Cookie.Name == "" {
		return "dj_guest_session"
	}
	return h.Cookie.Name
}

func (h *GuestSessionHandler) setCookie(c *gin.Context, credential string) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     h.CookieName(),
		Value:    credential,
		Path:     "/",
		MaxAge:   int(h.Cookie.TTL.Seconds()),
		HttpOnly: true,
		Secure:   h.Cookie.Secure,
		SameSite: h.Cookie.SameSite,
	})
}
