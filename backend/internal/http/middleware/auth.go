package middleware

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/edward-lemonade/dj-sim-backend/internal/domain/user"
	"github.com/gin-gonic/gin"
)

const (
	clerkIDKey = "clerkID"
	userKey    = "appUser"
)

type UserFinder interface {
	FindByClerkID(ctx context.Context, clerkID string) (*user.User, error)
}

func ClerkID(c *gin.Context) string {
	v, _ := c.Get(clerkIDKey)
	id, _ := v.(string)
	return id
}

func CurrentUser(c *gin.Context) *user.User {
	v, _ := c.Get(userKey)
	u, _ := v.(*user.User)
	return u
}

func Auth(users UserFinder, sessions *SessionVerifier) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !authenticate(c, users, sessions, false) {
			return
		}
		c.Next()
	}
}

func OptionalAuth(users UserFinder, sessions *SessionVerifier) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !authenticate(c, users, sessions, true) {
			return
		}
		c.Next()
	}
}

func authenticate(c *gin.Context, users UserFinder, sessions *SessionVerifier, allowAnonymous bool) bool {
	header := c.GetHeader("Authorization")
	token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	token = strings.TrimSpace(strings.TrimPrefix(token, "Bearer "))
	if token == "" {
		if allowAnonymous {
			return true
		}
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"message": "missing bearer token"})
		return false
	}

	claims, err := sessions.Verify(c.Request.Context(), token)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"message": "invalid session: " + err.Error()})
		return false
	}

	c.Set(clerkIDKey, claims.Subject)

	u, err := users.FindByClerkID(c.Request.Context(), claims.Subject)
	if err == nil {
		c.Set(userKey, u)
	} else if !errors.Is(err, user.ErrNotFound) {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"message": "failed to load user"})
		return false
	}
	return true
}

func RequireUser() gin.HandlerFunc {
	return func(c *gin.Context) {
		if CurrentUser(c) == nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"message": "user not registered"})
			return
		}
		c.Next()
	}
}

func CORS(origin string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", origin)
		c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
