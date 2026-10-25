package middleware

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/edward-lemonade/dj-sim-backend/internal/domain/user"
	"github.com/gin-gonic/gin"
)

const (
	clerkIDKey      = "clerkID"
	userKey         = "appUser"
	guestCookieName = "dj_guest_session"
)

type UserFinder interface {
	FindByClerkID(ctx context.Context, clerkID string) (*user.User, error)
}

type GuestSessionResolver interface {
	ResolveGuestSession(ctx context.Context, credential string, ttl time.Duration) (*user.User, error)
}

type GuestCookieOptions struct {
	Name     string
	TTL      time.Duration
	Secure   bool
	SameSite http.SameSite
}

func (o GuestCookieOptions) cookieName() string {
	if o.Name == "" {
		return guestCookieName
	}
	return o.Name
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

func IdentityAuth(users UserFinder, sessions *SessionVerifier, guests GuestSessionResolver, options GuestCookieOptions) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := strings.TrimSpace(c.GetHeader("Authorization"))
		if header != "" {
			if !authenticate(c, users, sessions, false) {
				return
			}
			c.Next()
			return
		}

		cookie, err := c.Cookie(options.cookieName())
		if err != nil || cookie == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"message": "authentication required"})
			return
		}
		if unsafeMethod(c.Request.Method) && subtle.ConstantTimeCompare(
			[]byte(c.GetHeader("X-Guest-Request")), []byte("1"),
		) != 1 {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"message": "guest request marker is required"})
			return
		}

		u, err := guests.ResolveGuestSession(c.Request.Context(), cookie, options.TTL)
		if err != nil {
			if errors.Is(err, user.ErrNotFound) || errors.Is(err, user.ErrGuestExpired) {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"message": "guest session is invalid or expired"})
				return
			}
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"message": "could not verify guest session"})
			return
		}
		c.Set(userKey, u)
		http.SetCookie(c.Writer, &http.Cookie{
			Name:     options.cookieName(),
			Value:    cookie,
			Path:     "/",
			MaxAge:   int(options.TTL.Seconds()),
			HttpOnly: true,
			Secure:   options.Secure,
			SameSite: options.SameSite,
		})
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

func RequirePermanentUser() gin.HandlerFunc {
	return func(c *gin.Context) {
		u := CurrentUser(c)
		if u == nil || u.ClerkID == nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"message": "a registered account is required"})
			return
		}
		c.Next()
	}
}

func unsafeMethod(method string) bool {
	return method != http.MethodGet && method != http.MethodHead && method != http.MethodOptions
}

func CORS(origin string) gin.HandlerFunc {
	allowedOrigins := make(map[string]struct{})
	for _, value := range strings.Split(origin, ",") {
		value = strings.TrimSpace(value)
		if value != "" {
			allowedOrigins[value] = struct{}{}
		}
	}
	return func(c *gin.Context) {
		requestOrigin := c.GetHeader("Origin")
		_, exactOriginAllowed := allowedOrigins[requestOrigin]
		_, wildcardAllowed := allowedOrigins["*"]
		if requestOrigin != "" && !exactOriginAllowed && !wildcardAllowed {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"message": "origin is not allowed"})
			return
		}
		if exactOriginAllowed {
			c.Header("Access-Control-Allow-Origin", requestOrigin)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Vary", "Origin")
		} else if wildcardAllowed {
			c.Header("Access-Control-Allow-Origin", "*")
		}
		c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Guest-Request")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
