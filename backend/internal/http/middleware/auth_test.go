package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/edward-lemonade/dj-sim-backend/internal/domain/user"
	"github.com/gin-gonic/gin"
)

type guestResolverStub struct {
	user *user.User
	err  error
}

func (s guestResolverStub) ResolveGuestSession(context.Context, string, time.Duration) (*user.User, error) {
	return s.user, s.err
}

type userFinderStub struct{}

func (userFinderStub) FindByClerkID(context.Context, string) (*user.User, error) {
	return nil, user.ErrNotFound
}

func TestIdentityAuthAcceptsGuestCookieAndMarksItForMutation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	options := GuestCookieOptions{
		Name:     "guest",
		TTL:      time.Hour,
		SameSite: http.SameSiteLaxMode,
	}
	router := gin.New()
	router.POST("/tracks", IdentityAuth(userFinderStub{}, nil, guestResolverStub{
		user: &user.User{ID: "guest-id"},
	}, options), RequireUser(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodPost, "/tracks", nil)
	request.AddCookie(&http.Cookie{Name: "guest", Value: "opaque-token"})
	request.Header.Set("X-Guest-Request", "1")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusNoContent, response.Body.String())
	}
	if got := response.Header().Get("Set-Cookie"); got == "" {
		t.Fatal("expected guest cookie to be refreshed")
	}
}

func TestIdentityAuthRejectsGuestMutationWithoutRequestMarker(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/tracks", IdentityAuth(userFinderStub{}, nil, guestResolverStub{
		user: &user.User{ID: "guest-id"},
	}, GuestCookieOptions{Name: "guest", TTL: time.Hour}), RequireUser(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodPost, "/tracks", nil)
	request.AddCookie(&http.Cookie{Name: "guest", Value: "opaque-token"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
}

func TestIdentityAuthRejectsMissingGuestCookie(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/tracks", IdentityAuth(userFinderStub{}, nil, guestResolverStub{
		user: &user.User{ID: "guest-id"},
	}, GuestCookieOptions{Name: "guest", TTL: time.Hour}), RequireUser(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/tracks", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestCORSAllowsCredentialsOnlyForConfiguredOrigin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(CORS("https://app.example"))
	router.GET("/", func(c *gin.Context) { c.Status(http.StatusNoContent) })

	allowed := httptest.NewRequest(http.MethodGet, "/", nil)
	allowed.Header.Set("Origin", "https://app.example")
	allowedResponse := httptest.NewRecorder()
	router.ServeHTTP(allowedResponse, allowed)
	if allowedResponse.Code != http.StatusNoContent ||
		allowedResponse.Header().Get("Access-Control-Allow-Credentials") != "true" ||
		allowedResponse.Header().Get("Access-Control-Allow-Origin") != "https://app.example" {
		t.Fatalf("allowed origin response headers = %v", allowedResponse.Header())
	}

	rejected := httptest.NewRequest(http.MethodGet, "/", nil)
	rejected.Header.Set("Origin", "https://attacker.example")
	rejectedResponse := httptest.NewRecorder()
	router.ServeHTTP(rejectedResponse, rejected)
	if rejectedResponse.Code != http.StatusForbidden {
		t.Fatalf("unconfigured origin status = %d, want %d", rejectedResponse.Code, http.StatusForbidden)
	}
}
