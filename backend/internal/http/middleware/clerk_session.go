package middleware

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/clerk/clerk-sdk-go/v2"
	"github.com/clerk/clerk-sdk-go/v2/jwks"
	"github.com/clerk/clerk-sdk-go/v2/jwt"
)

type SessionVerifier struct {
	jwksClient *jwks.Client
	httpClient *http.Client

	mu    sync.RWMutex
	cache map[string]*clerk.JSONWebKey
}

func NewSessionVerifier(secretKey string) *SessionVerifier {
	config := &clerk.ClientConfig{}
	config.Key = clerk.String(secretKey)
	return &SessionVerifier{
		jwksClient: jwks.NewClient(config),
		httpClient: &http.Client{Timeout: 8 * time.Second},
		cache:      make(map[string]*clerk.JSONWebKey),
	}
}

func (v *SessionVerifier) Verify(ctx context.Context, token string) (*clerk.SessionClaims, error) {
	decoded, err := jwt.Decode(ctx, &jwt.DecodeParams{Token: token})
	if err != nil {
		return nil, err
	}

	jwk, err := v.keyFor(ctx, decoded)
	if err != nil {
		return nil, err
	}

	return jwt.Verify(ctx, &jwt.VerifyParams{
		Token:      token,
		JWK:        jwk,
		JWKSClient: v.jwksClient,
	})
}

func (v *SessionVerifier) keyFor(ctx context.Context, decoded *clerk.UnverifiedToken) (*clerk.JSONWebKey, error) {
	if decoded.KeyID == "" {
		return nil, fmt.Errorf("missing jwt kid header claim")
	}

	v.mu.RLock()
	cached := v.cache[decoded.KeyID]
	v.mu.RUnlock()
	if cached != nil {
		return cached, nil
	}

	jwk, err := jwt.GetJSONWebKey(ctx, &jwt.GetJSONWebKeyParams{
		KeyID:      decoded.KeyID,
		JWKSClient: v.jwksClient,
	})
	if err != nil {
		jwk, err = v.keyFromIssuer(ctx, decoded.Issuer, decoded.KeyID)
		if err != nil {
			return nil, err
		}
	}

	v.mu.Lock()
	v.cache[decoded.KeyID] = jwk
	v.mu.Unlock()
	return jwk, nil
}

func (v *SessionVerifier) keyFromIssuer(ctx context.Context, issuer, kid string) (*clerk.JSONWebKey, error) {
	jwksURL, err := clerkJWKSURL(issuer)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, jwksURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := v.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch clerk jwks: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("read clerk jwks: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("fetch clerk jwks: status %d", resp.StatusCode)
	}

	var set clerk.JSONWebKeySet
	if err := json.Unmarshal(body, &set); err != nil {
		return nil, fmt.Errorf("parse clerk jwks: %w", err)
	}
	for _, key := range set.Keys {
		if key != nil && key.KeyID == kid {
			return key, nil
		}
	}
	return nil, fmt.Errorf("missing json web key")
}

func clerkJWKSURL(issuer string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(issuer))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return "", fmt.Errorf("invalid clerk issuer")
	}
	if !isClerkHost(parsed.Host) {
		return "", fmt.Errorf("invalid clerk issuer")
	}
	return strings.TrimRight(parsed.String(), "/") + "/.well-known/jwks.json", nil
}

func isClerkHost(host string) bool {
	host = strings.ToLower(host)
	return strings.HasSuffix(host, ".clerk.accounts.dev") ||
		strings.HasSuffix(host, ".lcl.dev") ||
		strings.HasPrefix(host, "clerk.") ||
		host == "clerk.com" ||
		strings.HasSuffix(host, ".clerk.com")
}
