package config

import (
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	Port                string
	DatabaseURL         string
	ClerkSecretKey      string
	ClerkWebhookSecret  string
	CORSOrigin          string
	GuestSessionTTL     string
	GuestCookieSecure   string
	GuestCookieSameSite string
	S3Bucket            string
	S3TracksKey         string
	S3AnalysisPrefix    string
	S3RecordingsKey     string
	S3Region            string
	AWSAccessKeyID      string
	AWSSecretAccessKey  string

	AnalysisWebhookSecret string

	LiveKitURL    string
	LiveKitAPIKey string
	LiveKitSecret string

	RoomCodePepperHex string
}

var ErrInvalidRoomCodePepper = errors.New("ROOM_CODE_PEPPER_HEX must contain at least 64 hexadecimal characters")

func Load() Config {
	_ = godotenv.Load()
	_ = godotenv.Load(".env")

	analysisPrefix := getEnv("AWS_S3_ANALYSIS_KEY", "")
	if analysisPrefix == "" {
		analysisPrefix = getEnv("AWS_S3_ANALYSIS_PREFIX", "")
	}

	return Config{
		Port:                getEnv("PORT", "8080"),
		DatabaseURL:         getEnv("DATABASE_URL", ""),
		ClerkSecretKey:      getEnv("CLERK_SECRET_KEY", ""),
		ClerkWebhookSecret:  getEnv("CLERK_WEBHOOK_SECRET", ""),
		CORSOrigin:          getEnv("CORS_ORIGIN", "*"),
		GuestSessionTTL:     getEnv("GUEST_SESSION_TTL", "24h"),
		GuestCookieSecure:   getEnv("GUEST_COOKIE_SECURE", "true"),
		GuestCookieSameSite: getEnv("GUEST_COOKIE_SAME_SITE", "Lax"),

		S3Bucket:           getEnv("AWS_S3_BUCKET", ""),
		S3TracksKey:        getEnv("AWS_S3_TRACKS_KEY", ""),
		S3AnalysisPrefix:   analysisPrefix,
		S3RecordingsKey:    getEnv("AWS_S3_RECORDINGS_KEY", ""),
		S3Region:           getEnv("AWS_REGION", ""),
		AWSAccessKeyID:     getEnv("AWS_ACCESS_KEY_ID", ""),
		AWSSecretAccessKey: getEnv("AWS_SECRET_ACCESS_KEY", ""),

		AnalysisWebhookSecret: getEnv("BACKEND_WEBHOOK_API_KEY", ""),
		LiveKitURL:            getEnv("LIVEKIT_URL", ""),
		LiveKitAPIKey:         getEnv("LIVEKIT_API_KEY", ""),
		LiveKitSecret:         getEnv("LIVEKIT_API_SECRET", ""),
		RoomCodePepperHex:     getEnv("ROOM_CODE_PEPPER_HEX", ""),
	}
}

func (c Config) GuestCookieOptions() (time.Duration, bool, http.SameSite, error) {
	ttl, err := time.ParseDuration(c.GuestSessionTTL)
	if err != nil || ttl <= 0 {
		return 0, false, 0, fmt.Errorf("GUEST_SESSION_TTL must be a positive duration")
	}
	secure, err := strconv.ParseBool(c.GuestCookieSecure)
	if err != nil {
		return 0, false, 0, fmt.Errorf("GUEST_COOKIE_SECURE must be true or false")
	}
	var sameSite http.SameSite
	switch strings.ToLower(c.GuestCookieSameSite) {
	case "lax":
		sameSite = http.SameSiteLaxMode
	case "strict":
		sameSite = http.SameSiteStrictMode
	case "none":
		sameSite = http.SameSiteNoneMode
	default:
		return 0, false, 0, fmt.Errorf("GUEST_COOKIE_SAME_SITE must be Lax, Strict, or None")
	}
	if sameSite == http.SameSiteNoneMode && !secure {
		return 0, false, 0, fmt.Errorf("GUEST_COOKIE_SECURE must be true when GUEST_COOKIE_SAME_SITE=None")
	}
	return ttl, secure, sameSite, nil
}

func (c Config) ValidateGuestCORS() error {
	origins := strings.Split(c.CORSOrigin, ",")
	if len(origins) == 0 {
		return fmt.Errorf("CORS_ORIGIN must contain at least one explicit frontend origin")
	}
	for _, value := range origins {
		origin := strings.TrimSpace(value)
		if origin == "" || origin == "*" {
			return fmt.Errorf("CORS_ORIGIN must contain explicit origins, not wildcard")
		}
		parsed, err := url.Parse(origin)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") ||
			parsed.Host == "" || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
			return fmt.Errorf("CORS_ORIGIN contains invalid origin %q", origin)
		}
	}
	return nil
}

func (c Config) RoomCodePepper() ([]byte, error) {
	if c.RoomCodePepperHex == "" {
		return nil, nil
	}
	pepper, err := hex.DecodeString(c.RoomCodePepperHex)
	if err != nil || len(pepper) < 32 {
		return nil, fmt.Errorf("%w: provide at least 32 random bytes encoded as hex", ErrInvalidRoomCodePepper)
	}
	return pepper, nil
}

func getEnv(key, fallback string) string {
	value := fallback
	if v, ok := os.LookupEnv(key); ok {
		value = v
	}
	return strings.Trim(strings.TrimSpace(value), `"'`)
}
