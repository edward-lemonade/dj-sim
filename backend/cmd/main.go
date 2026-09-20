package main

import (
	"log"

	"github.com/clerk/clerk-sdk-go/v2"
	"github.com/edward-lemonade/dj-sim-backend/internal/config"
	"github.com/edward-lemonade/dj-sim-backend/internal/http"
	"github.com/edward-lemonade/dj-sim-backend/internal/storage"
)

func main() {
	cfg := config.Load()
	if cfg.ClerkSecretKey == "" {
		log.Fatal("CLERK_SECRET_KEY is required")
	}
	clerk.SetKey(cfg.ClerkSecretKey)
	clerk.SetBackend(clerk.NewBackend(&clerk.BackendConfig{
		Key: clerk.String(cfg.ClerkSecretKey),
	}))

	db, err := storage.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db connect failed: %v", err)
	}

	r := http.New(db, cfg.CORSOrigin, cfg.ClerkSecretKey)

	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
