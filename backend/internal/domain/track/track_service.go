package track

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"

	"github.com/edward-lemonade/dj-sim-backend/internal/storage"
)

type Service struct {
	tracksDB       Repository
	store          *storage.S3Store
	tracksPrefix   string
	analysisPrefix string
}

// AnalysisStatus values for Track.AnalysisStatus. Set to Pending at
// upload; moved to Complete or Failed by ApplyAnalysisResult, called
// either from the webhook handler or from PollPendingAnalyses below.
const (
	AnalysisStatusPending   = "pending"
	AnalysisStatusComplete  = "complete"
	AnalysisStatusFailed    = "failed"
	AnalysisStatusCancelled = "cancelled"
)

func NewService(tracks *Repository, store *storage.S3Store, tracksPrefix string, analysisPrefix string) *Service {
	analysisPrefix = strings.Trim(strings.TrimSpace(analysisPrefix), "/")
	return &Service{
		tracksDB:       *tracks,
		store:          store,
		tracksPrefix:   strings.Trim(strings.TrimSpace(tracksPrefix), "/"),
		analysisPrefix: analysisPrefix,
	}
}

func (s *Service) ListByUserID(ctx context.Context, userID string) ([]Track, error) {
	return s.tracksDB.ListByUserID(ctx, userID)
}

func (s *Service) ListByUserIDs(ctx context.Context, userIDs []string) ([]Track, error) {
	return s.tracksDB.ListByUserIDs(ctx, userIDs)
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

	objectKey, err := s.buildTrackObjectKey(input.FileName)
	if err != nil {
		return nil, err
	}

	uploaded, err := s.store.UploadObject(ctx, input.File, objectKey, contentType)
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
		AnalysisStatus:   AnalysisStatusPending,
	}

	if err := s.tracksDB.Create(ctx, saved); err != nil {
		_ = s.store.DeleteObject(ctx, uploaded.Key)
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

	_ = s.store.DeleteObject(ctx, existing.ObjectKey)
	return nil
}

func (s *Service) GetAudioForUser(ctx context.Context, id, userID string) (*storage.S3Object, string, error) {
	existing, err := s.tracksDB.FindByIDForUser(ctx, id, userID)
	if err != nil {
		return nil, "", err
	}

	obj, err := s.store.GetObject(ctx, existing.ObjectKey)
	if err != nil {
		return nil, "", err
	}

	contentType := obj.ContentType
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = mimeTypeForFile(existing.FileName)
	}

	return obj, contentType, nil
}

// AnalysisResult is what the Lambda's webhook reports back. On failure,
// BPM/BeatOffset/Key are zero values and Status is AnalysisStatusFailed —
// the row still gets updated (out of "pending") so the frontend can stop
// waiting and show a failure state instead of polling forever.
type AnalysisResult struct {
	ObjectKey  string
	BPM        int
	BeatOffset float64
	Key        string
	Status     string
}

func (s *Service) ApplyAnalysisResult(ctx context.Context, result AnalysisResult) (*Track, error) {
	if strings.TrimSpace(result.ObjectKey) == "" {
		return nil, fmt.Errorf("object key is required")
	}
	if result.Status != AnalysisStatusComplete && result.Status != AnalysisStatusFailed {
		return nil, fmt.Errorf("invalid analysis status %q", result.Status)
	}
	return s.tracksDB.UpdateAnalysisByObjectKey(ctx, result.ObjectKey, result)
}

// s3AnalysisResult mirrors the JSON the Lambda writes to
// s3://<bucket>/<analysisPrefix>/<objectKey>.json (handler.py
// _persist_result). Only the fields ApplyAnalysisResult needs are bound —
// a failed-analysis JSON simply omits bpm/grid_offset_sec/key entirely,
// which unmarshal to their zero values here and are then never written
// (UpdateAnalysisByObjectKey only touches bpm/beat_offset/key when
// Status == AnalysisStatusComplete).
type s3AnalysisResult struct {
	BPM           float64 `json:"bpm"`
	GridOffsetSec float64 `json:"grid_offset_sec"`
	Key           string  `json:"key"`
	Status        string  `json:"status"`
}

// PollPendingAnalyses checks S3 directly for any track still in
// AnalysisStatusPending, as a fallback to (or replacement for) the
// Lambda's webhook — useful whenever BACKEND_WEBHOOK_URL can't be
// reached from AWS (e.g. local dev with nothing tunneled). Safe to call
// on a fixed interval: once a track leaves "pending" it drops out of the
// ListPending query, so this never double-applies a result even if the
// webhook and a poll tick race each other. Returns how many results were
// applied this tick, for logging; a missing result object (analysis
// still running) is not an error and is silently skipped.
func (s *Service) PollPendingAnalyses(ctx context.Context) (int, error) {
	pending, err := s.tracksDB.ListPending(ctx)
	if err != nil {
		return 0, fmt.Errorf("list pending tracks: %w", err)
	}

	applied := 0
	for _, t := range pending {
		resultKey := fmt.Sprintf("%s/%s.json", s.analysisPrefix, t.ObjectKey)

		obj, err := s.store.GetObject(ctx, resultKey)
		if err != nil {
			// Not there yet, or a transient S3 error — either way, just
			// try again on the next tick.
			continue
		}

		body, readErr := io.ReadAll(obj.Body)
		obj.Body.Close()
		if readErr != nil {
			continue
		}

		var parsed s3AnalysisResult
		if err := json.Unmarshal(body, &parsed); err != nil {
			continue
		}
		if parsed.Status != AnalysisStatusComplete && parsed.Status != AnalysisStatusFailed {
			continue
		}

		_, err = s.ApplyAnalysisResult(ctx, AnalysisResult{
			ObjectKey:  t.ObjectKey,
			BPM:        int(parsed.BPM + 0.5), // round to nearest — BPM is always positive
			BeatOffset: parsed.GridOffsetSec,
			Key:        parsed.Key,
			Status:     parsed.Status,
		})
		if err != nil {
			continue
		}
		applied++
	}

	return applied, nil
}

func (s *Service) StartAnalysis(ctx context.Context, id, userID string) error {
	existing, err := s.tracksDB.FindByIDForUser(ctx, id, userID)
	if err != nil {
		return err
	}
	if existing.AnalysisStatus == AnalysisStatusPending {
		return ErrAnalysisInProgress
	}

	// clear the old result first, or the poller would re-apply it immediately
	resultKey := fmt.Sprintf("%s/%s.json", s.analysisPrefix, existing.ObjectKey)
	if err := s.store.DeleteObject(ctx, resultKey); err != nil {
		return err
	}

	started, err := s.tracksDB.TransitionAnalysisStatus(
		ctx, id, userID,
		[]string{AnalysisStatusComplete, AnalysisStatusFailed, AnalysisStatusCancelled},
		AnalysisStatusPending,
	)
	if err != nil {
		return err
	}
	if !started {
		return ErrAnalysisInProgress
	}

	if err := s.store.RetriggerObject(ctx, existing.ObjectKey); err != nil {
		_, _ = s.tracksDB.TransitionAnalysisStatus(ctx, id, userID, []string{AnalysisStatusPending}, AnalysisStatusFailed)
		return err
	}
	return nil
}

func (s *Service) CancelAnalysis(ctx context.Context, id, userID string) error {
	if _, err := s.tracksDB.FindByIDForUser(ctx, id, userID); err != nil {
		return err
	}

	cancelled, err := s.tracksDB.TransitionAnalysisStatus(
		ctx, id, userID,
		[]string{AnalysisStatusPending},
		AnalysisStatusCancelled,
	)
	if err != nil {
		return err
	}
	if !cancelled {
		return ErrAnalysisNotPending
	}
	return nil
}

// --- internal helpers ---

func (s *Service) buildTrackObjectKey(fileName string) (string, error) {
	if s.tracksPrefix == "" {
		return "", fmt.Errorf("AWS_S3_TRACKS_KEY is not configured")
	}
	datePath := time.Now().UTC().Format("2006/01/02")
	return fmt.Sprintf("%s/%s/%s-%s", s.tracksPrefix, datePath, uuid.NewString(), sanitizeFileName(fileName)), nil
}

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
