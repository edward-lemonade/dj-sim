package handler

import (
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"unicode"

	"github.com/edward-lemonade/dj-sim-backend/internal/domain/track"
	"github.com/edward-lemonade/dj-sim-backend/internal/http/app_error"
	"github.com/edward-lemonade/dj-sim-backend/internal/http/middleware"
	"github.com/edward-lemonade/dj-sim-backend/internal/storage"
	"github.com/gin-gonic/gin"
)

type TrackService interface {
	ListByUserID(ctx context.Context, userID string) ([]track.Track, error)
	Create(ctx context.Context, t *track.Track) error
	GetByIDForUser(ctx context.Context, id, userID string) (*track.Track, error)
	Update(ctx context.Context, id, userID string, fields track.UpdateFields) (*track.Track, error)
	Delete(ctx context.Context, id, userID string) error
}

type patchTrackRequest struct {
	Title            *string                 `json:"title"`
	Artist           *string                 `json:"artist"`
	BPM              *int                    `json:"bpm"`
	Key              *string                 `json:"key"`
	WaveformOverview *track.WaveformOverview `json:"waveformOverview"`
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

	if !isAudioUpload(header) {
		c.JSON(http.StatusBadRequest, gin.H{"message": "only audio files are allowed"})
		return
	}

	meta := storage.InferTrackMetadata(header.Filename)
	title := firstNonEmpty(c.PostForm("title"), meta.Title)
	artist := firstNonEmpty(c.PostForm("artist"), meta.Artist)
	duration := firstNonEmpty(c.PostForm("duration"), "--:--")
	key := strings.TrimSpace(c.PostForm("key"))
	bpm := parseBPM(c.PostForm("bpm"))
	cover := firstNonEmpty(c.PostForm("cover"), coverFromTitle(title))
	overview := parseWaveformOverview(c.PostForm("waveformOverview"))

	contentType := header.Header.Get("Content-Type")
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = mimeTypeForFile(header.Filename)
	}

	uploaded, err := storage.UploadTrackToS3(c.Request.Context(), file, sanitizeFileName(header.Filename), contentType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}

	saved := &track.Track{
		UserID:           u.ID,
		Title:            title,
		Artist:           artist,
		BPM:              bpm,
		Key:              key,
		Duration:         duration,
		Cover:            cover,
		URL:              uploaded.URL,
		ObjectKey:        uploaded.Key,
		FileName:         filepath.Base(header.Filename),
		WaveformOverview: overview,
	}
	if err := h.Tracks.Create(c.Request.Context(), saved); err != nil {
		_ = storage.DeleteTrackFromS3(c.Request.Context(), uploaded.Key)
		app_error.WriteError(c, err)
		return
	}

	c.JSON(http.StatusCreated, saved)
}

func (h *TrackHandler) Delete(c *gin.Context) {
	u := middleware.CurrentUser(c)
	id := c.Param("id")

	existing, err := h.Tracks.GetByIDForUser(c.Request.Context(), id, u.ID)
	if err != nil {
		app_error.WriteError(c, err)
		return
	}

	if err := h.Tracks.Delete(c.Request.Context(), id, u.ID); err != nil {
		app_error.WriteError(c, err)
		return
	}

	_ = storage.DeleteTrackFromS3(c.Request.Context(), existing.ObjectKey)
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
		Title:            trimPointer(req.Title),
		Artist:           trimPointer(req.Artist),
		BPM:              req.BPM,
		Key:              trimPointer(req.Key),
		WaveformOverview: req.WaveformOverview,
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

	existing, err := h.Tracks.GetByIDForUser(c.Request.Context(), id, u.ID)
	if err != nil {
		app_error.WriteError(c, err)
		return
	}

	obj, err := storage.GetTrackFromS3(c.Request.Context(), existing.ObjectKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	defer obj.Body.Close()

	contentType := obj.ContentType
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = mimeTypeForFile(existing.FileName)
	}
	c.Header("Accept-Ranges", "bytes")
	c.Header("Cache-Control", "private, max-age=3600")
	c.DataFromReader(http.StatusOK, obj.ContentLength, contentType, obj.Body, nil)
}

func isAudioUpload(header *multipart.FileHeader) bool {
	contentType := header.Header.Get("Content-Type")
	if strings.HasPrefix(contentType, "audio/") {
		return true
	}

	switch strings.ToLower(filepath.Ext(header.Filename)) {
	case ".mp3", ".wav", ".flac", ".aac", ".m4a", ".ogg", ".aiff", ".aif", ".wma":
		return true
	default:
		return false
	}
}

func sanitizeFileName(name string) string {
	base := filepath.Base(name)
	base = strings.TrimSpace(base)
	base = strings.ReplaceAll(base, " ", "_")
	return base
}

func mimeTypeForFile(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".m4a":
		return "audio/mp4"
	case ".aac":
		return "audio/aac"
	case ".flac":
		return "audio/flac"
	case ".ogg":
		return "audio/ogg"
	default:
		return "application/octet-stream"
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func parseWaveformOverview(raw string) *track.WaveformOverview {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var overview track.WaveformOverview
	if err := json.Unmarshal([]byte(raw), &overview); err != nil {
		return nil
	}
	if len(overview.Lows) == 0 && len(overview.Mids) == 0 && len(overview.Highs) == 0 {
		return nil
	}
	return &overview
}

func trimPointer(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	return &trimmed
}

func parseBPM(raw string) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 {
		return 0
	}
	return value
}

func coverFromTitle(title string) string {
	var letters []rune
	for _, r := range title {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			letters = append(letters, unicode.ToUpper(r))
		}
		if len(letters) == 2 {
			break
		}
	}
	if len(letters) == 0 {
		return "TR"
	}
	return string(letters)
}
