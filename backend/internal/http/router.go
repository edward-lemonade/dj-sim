package http

import (
	"github.com/edward-lemonade/dj-sim-backend/internal/domain/track"
	"github.com/edward-lemonade/dj-sim-backend/internal/domain/user"
	"github.com/edward-lemonade/dj-sim-backend/internal/http/handler"
	"github.com/edward-lemonade/dj-sim-backend/internal/http/middleware"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func New(db *gorm.DB, corsOrigin string, clerkSecretKey string) *gin.Engine {
	r := gin.Default()
	r.MaxMultipartMemory = 100 << 20
	if corsOrigin == "" {
		corsOrigin = "*"
	}
	r.Use(middleware.CORS(corsOrigin))

	userRepo := user.NewRepository(db)
	userSvc := user.NewService(userRepo)
	userHandler := &handler.UserHandler{Users: userSvc}
	trackRepo := track.NewRepository(db)
	trackSvc := track.NewService(trackRepo)
	trackHandler := &handler.TrackHandler{Tracks: trackSvc}

	r.GET("/health", handler.Health)

	sessions := middleware.NewSessionVerifier(clerkSecretKey)
	auth := r.Group("/")
	auth.Use(middleware.Auth(userRepo, sessions))

	auth.GET("user/me", userHandler.Me)
	auth.POST("user", userHandler.Register)
	auth.GET("tracks", middleware.RequireUser(), trackHandler.List)
	auth.POST("tracks/upload", middleware.RequireUser(), trackHandler.Upload)
	auth.DELETE("tracks/:id", middleware.RequireUser(), trackHandler.Delete)

	return r
}
