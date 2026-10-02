package handler

import (
	"context"
	"errors"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/edward-lemonade/dj-sim-backend/internal/domain/recording"
	"github.com/edward-lemonade/dj-sim-backend/internal/http/app_error"
	"github.com/edward-lemonade/dj-sim-backend/internal/http/middleware"
	"github.com/edward-lemonade/dj-sim-backend/internal/storage"
	"github.com/gin-gonic/gin"
)

const (
	maxRecordingUploadBytes  = 100 << 20
	maxRecordingRequestBytes = maxRecordingUploadBytes + (1 << 20)
)

type RecordingService interface {
	ListByUserID(ctx context.Context, userID string) ([]recording.Recording, error)
	Upload(ctx context.Context, userID string, input recording.UploadInput) (*recording.Recording, error)
	UpdateTitle(ctx context.Context, id, userID, title string) (*recording.Recording, error)
	GetAudioForUser(ctx context.Context, id, userID string) (*storage.S3Object, *recording.Recording, error)
	Delete(ctx context.Context, id, userID string) error
}

type RecordingHandler struct {
	Recordings RecordingService
}

func (h *RecordingHandler) List(c *gin.Context) {
	u := middleware.CurrentUser(c)
	items, err := h.Recordings.ListByUserID(c.Request.Context(), u.ID)
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	if items == nil {
		items = []recording.Recording{}
	}
	c.JSON(http.StatusOK, items)
}

func (h *RecordingHandler) Upload(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxRecordingRequestBytes)
	parseErr := c.Request.ParseMultipartForm(16 << 20)
	if c.Request.MultipartForm != nil {
		defer c.Request.MultipartForm.RemoveAll()
	}
	if parseErr != nil {
		var maxErr *http.MaxBytesError
		if errors.As(parseErr, &maxErr) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"message": "recording upload exceeds the 100 MB limit"})
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"message": "invalid multipart recording upload"})
		}
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "MP3 file is required"})
		return
	}
	defer file.Close()
	if header.Size <= 0 || header.Size > maxRecordingUploadBytes {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"message": "recording must be between 1 byte and 100 MB"})
		return
	}

	durationSeconds, err := strconv.ParseFloat(c.PostForm("durationSeconds"), 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "durationSeconds must be a number"})
		return
	}
	contentType, _, err := mime.ParseMediaType(header.Header.Get("Content-Type"))
	if err != nil {
		contentType = ""
	}

	u := middleware.CurrentUser(c)
	saved, err := h.Recordings.Upload(c.Request.Context(), u.ID, recording.UploadInput{
		File:            file,
		FileName:        filepath.Base(header.Filename),
		ContentType:     strings.ToLower(contentType),
		Title:           c.PostForm("title"),
		DurationSeconds: durationSeconds,
	})
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	c.JSON(http.StatusCreated, saved)
}

func (h *RecordingHandler) Update(c *gin.Context) {
	var req struct {
		Title *string `json:"title"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Title == nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "title is required"})
		return
	}

	u := middleware.CurrentUser(c)
	updated, err := h.Recordings.UpdateTitle(c.Request.Context(), c.Param("id"), u.ID, *req.Title)
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	c.JSON(http.StatusOK, updated)
}

func (h *RecordingHandler) Audio(c *gin.Context) {
	h.serveAudio(c, false)
}

func (h *RecordingHandler) Download(c *gin.Context) {
	h.serveAudio(c, true)
}

func (h *RecordingHandler) serveAudio(c *gin.Context, download bool) {
	u := middleware.CurrentUser(c)
	object, item, err := h.Recordings.GetAudioForUser(c.Request.Context(), c.Param("id"), u.ID)
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	defer object.Body.Close()

	c.Header("Cache-Control", "private, no-store")
	if download {
		disposition := mime.FormatMediaType("attachment", map[string]string{
			"filename": item.Title + ".mp3",
		})
		if disposition == "" {
			c.JSON(http.StatusInternalServerError, gin.H{"message": "invalid download filename"})
			return
		}
		c.Header("Content-Disposition", disposition)
	} else {
		c.Header("Content-Disposition", mime.FormatMediaType("inline", map[string]string{
			"filename": item.Title + ".mp3",
		}))
	}
	c.DataFromReader(http.StatusOK, object.ContentLength, "audio/mpeg", object.Body, nil)
}

func (h *RecordingHandler) Delete(c *gin.Context) {
	u := middleware.CurrentUser(c)
	if err := h.Recordings.Delete(c.Request.Context(), c.Param("id"), u.ID); err != nil {
		app_error.WriteError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
