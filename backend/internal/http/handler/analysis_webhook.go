package handler

import (
	"errors"
	"net/http"

	"github.com/edward-lemonade/dj-sim-backend/internal/domain/track"
	"github.com/gin-gonic/gin"
)

// Matches the Lambda's result JSON (handler.py). The Lambda calls the
// source object key "s3_key"; object_key is also accepted for compatibility.
type analysisWebhookPayload struct {
	ObjectKey     string  `json:"object_key"`
	S3Key         string  `json:"s3_key"`
	BPM           float64 `json:"bpm"`
	GridOffsetSec float64 `json:"grid_offset_sec"`
	Key           string  `json:"key"`
	Status        string  `json:"status" binding:"required"`
}

func (p analysisWebhookPayload) sourceObjectKey() string {
	if p.ObjectKey != "" {
		return p.ObjectKey
	}
	return p.S3Key
}

func (h *TrackHandler) AnalysisWebhook(c *gin.Context) {
	var payload analysisWebhookPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	objectKey := payload.sourceObjectKey()
	if objectKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "object key is required"})
		return
	}

	result := track.AnalysisResult{
		ObjectKey:  objectKey,
		BPM:        int(payload.BPM + 0.5), // round to nearest — BPM is always positive
		BeatOffset: payload.GridOffsetSec,
		Key:        payload.Key,
		Status:     payload.Status,
	}

	updated, err := h.Tracks.ApplyAnalysisResult(c.Request.Context(), result)
	if errors.Is(err, track.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "no track found for that object key"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to apply analysis result"})
		return
	}

	c.JSON(http.StatusOK, updated)
}
