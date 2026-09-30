package middleware

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// WebhookAuth checks "Authorization: Bearer <secret>" against a
// pre-shared secret. Used for the analysis-result callback from the
// Lambda, which has no Clerk session to verify — this is its only guard,
// so an unconfigured secret fails closed rather than accepting anything.
func WebhookAuth(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if secret == "" {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
				"error": "webhook auth is not configured",
			})
			return
		}

		header := c.GetHeader("Authorization")
		token, ok := strings.CutPrefix(header, "Bearer ")
		if !ok || subtle.ConstantTimeCompare([]byte(token), []byte(secret)) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		c.Next()
	}
}
