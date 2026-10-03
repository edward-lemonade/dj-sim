package http

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/edward-lemonade/dj-sim-backend/internal/domain/recording"
	"github.com/edward-lemonade/dj-sim-backend/internal/domain/room"
	"github.com/edward-lemonade/dj-sim-backend/internal/domain/stream"
	"github.com/edward-lemonade/dj-sim-backend/internal/domain/track"
	"github.com/edward-lemonade/dj-sim-backend/internal/domain/user"
	"github.com/edward-lemonade/dj-sim-backend/internal/http/handler"
	"github.com/edward-lemonade/dj-sim-backend/internal/http/middleware"
	"github.com/edward-lemonade/dj-sim-backend/internal/storage"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func New(db *gorm.DB, corsOrigin string, clerkSecretKey string, store *storage.S3Store, tracksPrefix string, analysisPrefix string, recordingsPrefix string, analysisWebhookSecret string, liveKitURL string, liveKitAPIKey string, liveKitSecret string, roomCodePepper []byte) *gin.Engine {
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
	recordingSvc := recording.NewService(recordingRepo, store, recordingsPrefix)
	recordingHandler := &handler.RecordingHandler{Recordings: recordingSvc}
	streamRepo := stream.NewInMemoryRepository()
	streamManager := stream.NewManager()
	streamSvc := stream.NewService(streamRepo, streamManager, liveKitURL, liveKitAPIKey, liveKitSecret)
	streamHandler := handler.NewStreamHandler(streamSvc, corsOrigin)
	roomRepo := room.NewInMemoryRepository()
	roomManager := room.NewRoomManager()
	roomSvc := room.NewService(roomRepo, roomCodePepper, roomManager)
	roomHandler := handler.NewRoomHandler(roomSvc, corsOrigin)
	streamSvc.SetRoomDirectory(roomSvc)
	roomSvc.SetStreamTerminator(streamSvc)
	roomSvc.SetTrackDirectory(trackSvc)
	roomSvc.SetS3Store(store)

	if err := trackRepo.Migrate(ctx); err != nil {
		log.Fatalf("migration failed: %v", err)
	}
	if err := userRepo.Migrate(ctx); err != nil {
		log.Fatalf("migration failed: %v", err)
	}
	if err := recordingRepo.Migrate(ctx); err != nil {
		log.Fatalf("recording migration failed: %v", err)
	}
	if err := streamSvc.EndAllActive(ctx); err != nil {
		if errors.Is(err, stream.ErrCleanupStorage) {
			log.Fatalf("stream database cleanup failed: %v", err)
		}
		log.Printf("stream cleanup completed with errors: %v", err)
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

	sessions := middleware.NewSessionVerifier(clerkSecretKey)
	r.GET("/health", handler.Health)
	r.GET("/rooms", roomHandler.ListPublic)
	r.GET("/streams", streamHandler.List)
	r.POST("/streams/:id/join", middleware.OptionalAuth(userRepo, sessions), streamHandler.Join)

	internal := r.Group("/internal", middleware.WebhookAuth(analysisWebhookSecret))
	internal.POST("/tracks/analysis", trackHandler.AnalysisWebhook)

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

	rooms := auth.Group("/rooms", middleware.RequireUser())
	rooms.GET("/:id", roomHandler.Get)
	rooms.GET("/:id/library", roomHandler.GetLibrary)
	rooms.POST("", roomHandler.Create)
	rooms.POST("/join", roomHandler.JoinByCode)
	rooms.POST("/:id/join", roomHandler.JoinPublic)
	rooms.POST("/:id/leave", roomHandler.Leave)
	rooms.POST("/:id/tracks/:trackId/token", roomHandler.IssueTrackToken)
	rooms.GET("/:id/tracks/:trackId/audio", roomHandler.GetTrackAudio)

	streams := auth.Group("/streams", middleware.RequireUser())
	streams.POST("", streamHandler.Create)
	streams.POST("/:id/end", streamHandler.End)

	r.POST("/streams/:id/end-on-exit", streamHandler.EndOnExit)
	r.GET("/streams/:id/events", streamHandler.Events)
	r.GET("/rooms/:id/events", roomHandler.Events)
	return r
}
