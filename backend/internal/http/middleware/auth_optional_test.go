package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestOptionalAuthAllowsAnonymousRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	reachedHandler := false
	router.GET("/", OptionalAuth(nil, nil), func(c *gin.Context) {
		reachedHandler = true
		c.Status(http.StatusNoContent)
	})

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))

	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNoContent)
	}
	if !reachedHandler {
		t.Fatal("anonymous request did not reach handler")
	}
}
