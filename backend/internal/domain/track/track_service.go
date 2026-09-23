package track

import (
	"context"
	"encoding/json"
	"io"
	"path/filepath"
	"strconv"
	"strings"
	"unicode"

	"github.com/edward-lemonade/dj-sim-backend/internal/storage"
)

type Service struct {
	tracksDB Repository
}

func NewService(tracks *Repository) *Service {
	return &Service{tracksDB: *tracks}
}

func (s *Service) ListByUserID(ctx context.Context, userID string) ([]Track, error) {
	return s.tracksDB.ListByUserID(ctx, userID)
}

type UploadInput struct {
	File                io.Reader
	FileName            string
	ContentTypeHeader   string
	Title               string
	Artist              string
	Duration            string
	Key                 string
	BPMRaw              string
	Cover               string
	WaveformOverviewRaw string
}

func (s *Service) Upload(ctx context.Context, userID string, input UploadInput) (*Track, error) {
	if !isAudioUpload(input.FileName, input.ContentTypeHeader) {
		return nil, ErrInvalidFileType
	}

	meta := storage.InferTrackMetadata(input.FileName)
	title := firstNonEmpty(input.Title, meta.Title)
	artist := firstNonEmpty(input.Artist, meta.Artist)
	duration := firstNonEmpty(input.Duration, "--:--")
	key := strings.TrimSpace(input.Key)
	bpm := parseBPM(input.BPMRaw)
	cover := firstNonEmpty(input.Cover, coverFromTitle(title))
	overview := parseWaveformOverview(input.WaveformOverviewRaw)

	contentType := input.ContentTypeHeader
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = mimeTypeForFile(input.FileName)
	}

	uploaded, err := storage.UploadTrackToS3(ctx, input.File, sanitizeFileName(input.FileName), contentType)
	if err != nil {
		return nil, err
	}

	saved := &Track{
		UserID:           userID,
		Title:            title,
		Artist:           artist,
		BPM:              bpm,
		BeatOffset:       0,
		Key:              key,
		Duration:         duration,
		Cover:            cover,
		URL:              uploaded.URL,
		ObjectKey:        uploaded.Key,
		FileName:         filepath.Base(input.FileName),
		WaveformOverview: overview,
	}

	if err := s.tracksDB.Create(ctx, saved); err != nil {
		_ = storage.DeleteTrackFromS3(ctx, uploaded.Key)
		return nil, err
	}

	return saved, nil
}

func (s *Service) GetByIDForUser(ctx context.Context, id, userID string) (*Track, error) {
	return s.tracksDB.FindByIDForUser(ctx, id, userID)
}

func (s *Service) Update(ctx context.Context, id, userID string, fields UpdateFields) (*Track, error) {
	if fields.BeatOffset != nil && (*fields.BeatOffset < 0 || *fields.BeatOffset > 3600) {
		return nil, ErrInvalidBeatOffset
	}

	if fields.Cues != nil {
		if len(fields.Cues) > 8 {
			return nil, ErrTooManyCues
		}
		for _, cue := range fields.Cues {
			if cue != nil && (*cue < 0 || *cue > 36000) {
				return nil, ErrInvalidCueTime
			}
		}
	}

	fields.Title = trimPointer(fields.Title)
	fields.Artist = trimPointer(fields.Artist)
	fields.Key = trimPointer(fields.Key)

	return s.tracksDB.Update(ctx, id, userID, fields)
}

func (s *Service) Delete(ctx context.Context, id, userID string) error {
	existing, err := s.tracksDB.FindByIDForUser(ctx, id, userID)
	if err != nil {
		return err
	}

	if err := s.tracksDB.Delete(ctx, id, userID); err != nil {
		return err
	}

	_ = storage.DeleteTrackFromS3(ctx, existing.ObjectKey)
	return nil
}

func (s *Service) GetAudioForUser(ctx context.Context, id, userID string) (*storage.S3Object, string, error) {
	existing, err := s.tracksDB.FindByIDForUser(ctx, id, userID)
	if err != nil {
		return nil, "", err
	}

	obj, err := storage.GetTrackFromS3(ctx, existing.ObjectKey)
	if err != nil {
		return nil, "", err
	}

	contentType := obj.ContentType
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = mimeTypeForFile(existing.FileName)
	}

	return obj, contentType, nil
}

// --- internal helpers ---

func isAudioUpload(fileName, contentTypeHeader string) bool {
	if strings.HasPrefix(contentTypeHeader, "audio/") {
		return true
	}
	switch strings.ToLower(filepath.Ext(fileName)) {
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

func parseWaveformOverview(raw string) *WaveformOverview {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var overview WaveformOverview
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
