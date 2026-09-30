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

	store, err := storage.NewS3Store(cfg)
	if err != nil {
		log.Fatalf("s3 store init failed: %v", err)
	}

	// No longer a hard requirement — WebhookAuth already fails closed
	// (500) on any request if this is empty, so an unconfigured secret
	// just means the webhook route sits inert while PollPendingAnalyses
	// (started in http.New) covers analysis results on its own.
	if cfg.AnalysisWebhookSecret == "" {
		log.Println("BACKEND_WEBHOOK_API_KEY not set — analysis webhook endpoint disabled, relying on S3 polling only")
	}

	r := http.New(db, cfg.CORSOrigin, cfg.ClerkSecretKey, store, cfg.S3TracksKey, cfg.S3AnalysisPrefix, cfg.AnalysisWebhookSecret)

	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
