package app_error

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/edward-lemonade/dj-sim-backend/internal/domain/recording"
	"github.com/edward-lemonade/dj-sim-backend/internal/domain/room"
	"github.com/edward-lemonade/dj-sim-backend/internal/domain/stream"
	"github.com/edward-lemonade/dj-sim-backend/internal/domain/track"
	"github.com/edward-lemonade/dj-sim-backend/internal/domain/user"
	"github.com/gin-gonic/gin"
)

func WriteError(c *gin.Context, err error) {
	fmt.Println(err)

	switch {
	case errors.Is(err, recording.ErrNotFound), errors.Is(err, stream.ErrNotFound), errors.Is(err, track.ErrNotFound), errors.Is(err, user.ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
	case errors.Is(err, stream.ErrLiveKitNotConfigured):
		c.JSON(http.StatusServiceUnavailable, gin.H{"message": "live streaming is not configured"})
	case errors.Is(err, room.ErrCodeConfig), errors.Is(err, room.ErrCodeAllocation):
		c.JSON(http.StatusServiceUnavailable, gin.H{"message": "room code operations are temporarily unavailable"})
	case errors.Is(err, room.ErrUnavailable):
		c.JSON(http.StatusNotFound, gin.H{"message": "room is unavailable"})
	case errors.Is(err, room.ErrFull):
		c.JSON(http.StatusConflict, gin.H{"message": "room is full"})
	case errors.Is(err, room.ErrAlreadyStreaming):
		c.JSON(http.StatusConflict, gin.H{"message": err.Error()})
	case errors.Is(err, user.ErrAlreadyExists):
		c.JSON(http.StatusConflict, gin.H{"message": err.Error()})
	case errors.Is(err, track.ErrInvalidFileType),
		errors.Is(err, track.ErrInvalidBeatOffset),
		errors.Is(err, track.ErrTooManyCues),
		errors.Is(err, track.ErrInvalidCueTime),
		errors.Is(err, recording.ErrInvalidUpload),
		errors.Is(err, recording.ErrInvalidTitle),
		errors.Is(err, recording.ErrInvalidDuration),
		errors.Is(err, room.ErrInvalidVisibility),
		errors.Is(err, room.ErrInvalidAvatar),
		errors.Is(err, room.ErrInvalidJoinCode),
		errors.Is(err, stream.ErrInvalidName),
		errors.Is(err, stream.ErrInvalidAvatar):
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"message": "internal error"})
	}
}
