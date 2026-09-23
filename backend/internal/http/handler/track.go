package handler

import (
	"context"
	"net/http"

	"github.com/edward-lemonade/dj-sim-backend/internal/domain/track"
	"github.com/edward-lemonade/dj-sim-backend/internal/http/app_error"
	"github.com/edward-lemonade/dj-sim-backend/internal/http/middleware"
	"github.com/edward-lemonade/dj-sim-backend/internal/storage"
	"github.com/gin-gonic/gin"
)

type TrackService interface {
	ListByUserID(ctx context.Context, userID string) ([]track.Track, error)
	Upload(ctx context.Context, userID string, input track.UploadInput) (*track.Track, error)
	GetByIDForUser(ctx context.Context, id, userID string) (*track.Track, error)
	Update(ctx context.Context, id, userID string, fields track.UpdateFields) (*track.Track, error)
	Delete(ctx context.Context, id, userID string) error
	GetAudioForUser(ctx context.Context, id, userID string) (*storage.S3Object, string, error)
}

type patchTrackRequest struct {
	Title            *string                 `json:"title"`
	Artist           *string                 `json:"artist"`
	BPM              *int                    `json:"bpm"`
	BeatOffset       *float64                `json:"beatOffset"`
	Key              *string                 `json:"key"`
	WaveformOverview *track.WaveformOverview `json:"waveformOverview"`
	Cues             []*float64              `json:"cues"`
}

type TrackHandler struct {
	Tracks TrackService
}

func (h *TrackHandler) List(c *gin.Context) {
	u := middleware.CurrentUser(c)
	tracks, err := h.Tracks.ListByUserID(c.Request.Context(), u.ID)
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	if tracks == nil {
		tracks = []track.Track{}
	}
	c.JSON(http.StatusOK, tracks)
}

func (h *TrackHandler) Upload(c *gin.Context) {
	u := middleware.CurrentUser(c)
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "file is required"})
		return
	}
	defer file.Close()

	if header == nil || header.Filename == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "file is required"})
		return
	}

	input := track.UploadInput{
		File:                file,
		FileName:            header.Filename,
		ContentTypeHeader:   header.Header.Get("Content-Type"),
		Title:               c.PostForm("title"),
		Artist:              c.PostForm("artist"),
		Duration:            c.PostForm("duration"),
		Key:                 c.PostForm("key"),
		BPMRaw:              c.PostForm("bpm"),
		Cover:               c.PostForm("cover"),
		WaveformOverviewRaw: c.PostForm("waveformOverview"),
	}

	saved, err := h.Tracks.Upload(c.Request.Context(), u.ID, input)
	if err != nil {
		app_error.WriteError(c, err)
		return
	}

	c.JSON(http.StatusCreated, saved)
}

func (h *TrackHandler) Delete(c *gin.Context) {
	u := middleware.CurrentUser(c)
	id := c.Param("id")

	if err := h.Tracks.Delete(c.Request.Context(), id, u.ID); err != nil {
		app_error.WriteError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *TrackHandler) Update(c *gin.Context) {
	u := middleware.CurrentUser(c)
	id := c.Param("id")

	var req patchTrackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid JSON body"})
		return
	}

	fields := track.UpdateFields{
		Title:            req.Title,
		Artist:           req.Artist,
		BPM:              req.BPM,
		BeatOffset:       req.BeatOffset,
		Key:              req.Key,
		WaveformOverview: req.WaveformOverview,
		Cues:             req.Cues,
	}

	updated, err := h.Tracks.Update(c.Request.Context(), id, u.ID, fields)
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	c.JSON(http.StatusOK, updated)
}

func (h *TrackHandler) Audio(c *gin.Context) {
	u := middleware.CurrentUser(c)
	id := c.Param("id")

	obj, contentType, err := h.Tracks.GetAudioForUser(c.Request.Context(), id, u.ID)
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	defer obj.Body.Close()

	c.Header("Accept-Ranges", "bytes")
	c.Header("Cache-Control", "private, max-age=3600")
	c.DataFromReader(http.StatusOK, obj.ContentLength, contentType, obj.Body, nil)
}
