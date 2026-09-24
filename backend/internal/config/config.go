package config

import (
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
	S3Region           string
	AWSAccessKeyID     string
	AWSSecretAccessKey string
}

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
		S3Region:           getEnv("AWS_REGION", ""),
		AWSAccessKeyID:     getEnv("AWS_ACCESS_KEY_ID", ""),
		AWSSecretAccessKey: getEnv("AWS_SECRET_ACCESS_KEY", ""),
	}
}

func getEnv(key, fallback string) string {
	value := fallback
	if v, ok := os.LookupEnv(key); ok {
		value = v
	}
	return strings.Trim(strings.TrimSpace(value), `"'`)
}
