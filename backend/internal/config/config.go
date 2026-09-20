package config

import (
	"os"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	Port            string
	DatabaseURL     string
	ClerkSecretKey  string
	CORSOrigin      string
}

func Load() Config {
	_ = godotenv.Load()
	_ = godotenv.Load(".env")

	return Config{
		Port:           getEnv("PORT", "8080"),
		DatabaseURL:    getEnv("DATABASE_URL", ""),
		ClerkSecretKey: getEnv("CLERK_SECRET_KEY", ""),
		CORSOrigin:     getEnv("CORS_ORIGIN", "*"),
	}
}

func getEnv(key, fallback string) string {
	value := fallback
	if v, ok := os.LookupEnv(key); ok {
		value = v
	}
	return strings.Trim(strings.TrimSpace(value), `"'`)
}