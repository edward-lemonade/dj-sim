package http

import (
	"context"
	"log"
	"time"

	"github.com/edward-lemonade/dj-sim-backend/internal/domain/recording"
	"github.com/edward-lemonade/dj-sim-backend/internal/domain/track"
	"github.com/edward-lemonade/dj-sim-backend/internal/domain/user"
	"github.com/edward-lemonade/dj-sim-backend/internal/http/handler"
	"github.com/edward-lemonade/dj-sim-backend/internal/http/middleware"
	"github.com/edward-lemonade/dj-sim-backend/internal/storage"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func New(db *gorm.DB, corsOrigin string, clerkSecretKey string, store *storage.S3Store, tracksPrefix string, analysisPrefix string, analysisWebhookSecret string) *gin.Engine {
	ctx := context.Background()

	r := gin.Default()
	r.MaxMultipartMemory = 16 << 20
	if corsOrigin == "" {
		corsOrigin = "*"
	}
	r.Use(middleware.CORS(corsOrigin))

	userRepo := user.NewRepository(db)
	userSvc := user.NewService(userRepo)
	userHandler := &handler.UserHandler{Users: userSvc}

	trackRepo := track.NewRepository(db)
	trackSvc := track.NewService(trackRepo, store, tracksPrefix, analysisPrefix)
	trackHandler := &handler.TrackHandler{Tracks: trackSvc}

	recordingRepo := recording.NewRepository(db)
	recordingSvc := recording.NewService(recordingRepo, store)
	recordingHandler := &handler.RecordingHandler{Recordings: recordingSvc}

	if err := trackRepo.Migrate(ctx); err != nil {
		log.Fatalf("migration failed: %v", err)
	}
	if err := userRepo.Migrate(ctx); err != nil {
		log.Fatalf("migration failed: %v", err)
	}
	if err := recordingRepo.Migrate(ctx); err != nil {
		log.Fatalf("recording migration failed: %v", err)
	}

	// Fallback (and, for local dev with no reachable BACKEND_WEBHOOK_URL,
	// the only) path to pick up analysis results: poll S3 directly for
	// any track still pending. Safe to run alongside the webhook — see
	// PollPendingAnalyses' doc comment on why they can't double-apply.
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			applied, err := trackSvc.PollPendingAnalyses(context.Background())
			if err != nil {
				log.Printf("analysis poll failed: %v", err)
				continue
			}
			if applied > 0 {
				log.Printf("analysis poll: applied %d result(s)", applied)
			}
		}
	}()

	r.GET("/health", handler.Health)

	internal := r.Group("/internal", middleware.WebhookAuth(analysisWebhookSecret))
	internal.POST("/tracks/analysis", trackHandler.AnalysisWebhook)

	sessions := middleware.NewSessionVerifier(clerkSecretKey)
	auth := r.Group("/", middleware.Auth(userRepo, sessions))

	auth.GET("/user/me", userHandler.Me)
	auth.POST("/user", userHandler.Register)

	tracks := auth.Group("/tracks", middleware.RequireUser())
	tracks.GET("", trackHandler.List)
	tracks.POST("/upload", trackHandler.Upload)
	tracks.PATCH("/:id", trackHandler.Update)
	tracks.DELETE("/:id", trackHandler.Delete)
	tracks.GET("/:id/audio", trackHandler.Audio)
	tracks.POST("/:id/analyze", trackHandler.Analyze)
	tracks.POST("/:id/analyze/cancel", trackHandler.CancelAnalysis)

	recordings := auth.Group("/recordings", middleware.RequireUser())
	recordings.GET("", recordingHandler.List)
	recordings.POST("/upload", recordingHandler.Upload)
	recordings.PATCH("/:id", recordingHandler.Update)
	recordings.GET("/:id/audio", recordingHandler.Audio)
	recordings.GET("/:id/download", recordingHandler.Download)
	recordings.DELETE("/:id", recordingHandler.Delete)

	return r
}
