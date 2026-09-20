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
		header := c.GetHeader("Authorization")
		token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
		token = strings.TrimSpace(strings.TrimPrefix(token, "Bearer "))
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"message": "missing bearer token"})
			return
		}

		claims, err := sessions.Verify(c.Request.Context(), token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"message": "invalid session: " + err.Error()})
			return
		}

		c.Set(clerkIDKey, claims.Subject)

		u, err := users.FindByClerkID(c.Request.Context(), claims.Subject)
		if err == nil {
			c.Set(userKey, u)
		} else if !errors.Is(err, user.ErrNotFound) {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"message": "failed to load user"})
			return
		}

		c.Next()
	}
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
