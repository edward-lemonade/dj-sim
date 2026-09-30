package handler

import (
	"errors"
	"net/http"

	"github.com/edward-lemonade/dj-sim-backend/internal/domain/track"
	"github.com/gin-gonic/gin"
)

// Matches the Lambda's result JSON (handler.py): bucket, object_key, bpm,
// grid_offset_sec, key, key_confidence, duration_sec, status,
// result_location, and on failure an "error" string. Only the fields we
// act on are bound here — extras are ignored by ShouldBindJSON.
type analysisWebhookPayload struct {
	ObjectKey     string  `json:"object_key" binding:"required"`
	BPM           float64 `json:"bpm"`
	GridOffsetSec float64 `json:"grid_offset_sec"`
	Key           string  `json:"key"`
	Status        string  `json:"status" binding:"required"`
}

func (h *TrackHandler) AnalysisWebhook(c *gin.Context) {
	var payload analysisWebhookPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	result := track.AnalysisResult{
		ObjectKey:  payload.ObjectKey,
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
