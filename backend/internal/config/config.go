package config

import (
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	Port               string
	DatabaseURL        string
	ClerkSecretKey     string
	CORSOrigin         string
	S3Bucket           string
	S3TracksKey        string
	S3AnalysisPrefix   string
	S3RecordingsPrefix string
	S3Region           string
	AWSAccessKeyID     string
	AWSSecretAccessKey string

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

	return Config{
		Port:           getEnv("PORT", "8080"),
		DatabaseURL:    getEnv("DATABASE_URL", ""),
		ClerkSecretKey: getEnv("CLERK_SECRET_KEY", ""),
		CORSOrigin:     getEnv("CORS_ORIGIN", "*"),

		S3Bucket:           getEnv("AWS_S3_BUCKET", ""),
		S3TracksKey:        getEnv("AWS_S3_TRACKS_KEY", ""),
		S3AnalysisPrefix:   getEnv("AWS_S3_ANALYSIS_PREFIX", ""),
		S3RecordingsPrefix: getEnv("AWS_S3_RECORDINGS_PREFIX", ""),
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
