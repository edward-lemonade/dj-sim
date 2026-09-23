package app_error

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/edward-lemonade/dj-sim-backend/internal/domain/track"
	"github.com/edward-lemonade/dj-sim-backend/internal/domain/user"
	"github.com/gin-gonic/gin"
)

func WriteError(c *gin.Context, err error) {
	fmt.Println(err)

	switch {
	case errors.Is(err, track.ErrNotFound), errors.Is(err, user.ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
	case errors.Is(err, user.ErrAlreadyExists):
		c.JSON(http.StatusConflict, gin.H{"message": err.Error()})
	case errors.Is(err, track.ErrInvalidFileType),
		errors.Is(err, track.ErrInvalidBeatOffset),
		errors.Is(err, track.ErrTooManyCues),
		errors.Is(err, track.ErrInvalidCueTime):
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"message": "internal error"})
	}
}
