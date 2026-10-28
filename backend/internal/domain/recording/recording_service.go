package recording

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"path/filepath"
	"strings"
	"time"

	"github.com/edward-lemonade/dj-sim-backend/internal/storage"
	"github.com/google/uuid"
)

const maxDurationSeconds = 60 * 60

type Waveform struct {
	Version         int          `json:"version"`
	DurationSeconds float64      `json:"durationSeconds"`
	Peaks           [][2]float32 `json:"peaks"`
}

type Service struct {
	recordingsDB     Repository
	store            *storage.S3Store
	recordingsPrefix string
}

func NewService(recordings *Repository, store *storage.S3Store, recordingsPrefix string) *Service {
	return &Service{
		recordingsDB:     *recordings,
		store:            store,
		recordingsPrefix: strings.Trim(strings.TrimSpace(recordingsPrefix), "/"),
	}
}

type UploadInput struct {
	File            io.Reader
	FileName        string
	ContentType     string
	Title           string
	DurationSeconds float64
}

func (s *Service) ListByUserID(ctx context.Context, userID string) ([]Recording, error) {
	return s.recordingsDB.ListByUserID(ctx, userID)
}

func (s *Service) Upload(ctx context.Context, userID string, input UploadInput) (*Recording, error) {
	if input.File == nil || strings.ToLower(filepath.Ext(input.FileName)) != ".mp3" ||
		!strings.EqualFold(strings.TrimSpace(input.ContentType), "audio/mpeg") {
		return nil, ErrInvalidUpload
	}
	title := strings.TrimSpace(input.Title)
	if title == "" || len([]rune(title)) > 200 {
		return nil, ErrInvalidTitle
	}
	if math.IsNaN(input.DurationSeconds) || math.IsInf(input.DurationSeconds, 0) ||
		input.DurationSeconds <= 0 || input.DurationSeconds > maxDurationSeconds {
		return nil, ErrInvalidDuration
	}

	if s.recordingsPrefix == "" {
		return nil, fmt.Errorf("AWS_S3_RECORDINGS_KEY is not configured")
	}
	key := fmt.Sprintf("%s/users/%s/%s.mp3", s.recordingsPrefix, userID, uuid.NewString())
	uploaded, err := s.store.UploadObject(ctx, input.File, key, "audio/mpeg")
	if err != nil {
		return nil, err
	}

	item := &Recording{
		UserID:          userID,
		Title:           title,
		ObjectKey:       uploaded.Key,
		ContentType:     "audio/mpeg",
		DurationSeconds: input.DurationSeconds,
		WaveformStatus:  "pending",
	}
	if err := s.recordingsDB.Create(ctx, item); err != nil {
		if cleanupErr := s.store.DeleteObject(ctx, uploaded.Key); cleanupErr != nil {
			return nil, fmt.Errorf("create recording metadata: %w (also failed to remove uploaded object: %v)", err, cleanupErr)
		}
		return nil, fmt.Errorf("create recording metadata: %w", err)
	}
	return item, nil
}

func (s *Service) UpdateTitle(ctx context.Context, id, userID, title string) (*Recording, error) {
	title = strings.TrimSpace(title)
	if title == "" || len([]rune(title)) > 200 {
		return nil, ErrInvalidTitle
	}
	return s.recordingsDB.UpdateTitle(ctx, id, userID, title)
}

func (s *Service) GetAudioForUser(ctx context.Context, id, userID string) (*storage.S3Object, *Recording, error) {
	item, err := s.recordingsDB.FindByIDForUser(ctx, id, userID)
	if err != nil {
		return nil, nil, err
	}
	object, err := s.store.GetObject(ctx, item.ObjectKey)
	if err != nil {
		return nil, nil, err
	}
	return object, item, nil
}

func (s *Service) GetPlaybackURLForUser(ctx context.Context, id, userID string) (string, error) {
	item, err := s.recordingsDB.FindByIDForUser(ctx, id, userID)
	if err != nil {
		return "", err
	}
	return s.store.PresignedGetObject(ctx, item.ObjectKey, 2*time.Hour)
}

func (s *Service) GetWaveformForUser(ctx context.Context, id, userID string) (*Waveform, error) {
	item, err := s.recordingsDB.FindByIDForUser(ctx, id, userID)
	if err != nil {
		return nil, err
	}
	if item.WaveformStatus != "ready" {
		return nil, ErrWaveformNotReady
	}
	object, err := s.store.GetObject(ctx, item.ObjectKey+".waveform.json")
	if err != nil {
		return nil, err
	}
	defer object.Body.Close()
	data, err := io.ReadAll(io.LimitReader(object.Body, 128<<10))
	if err != nil {
		return nil, fmt.Errorf("read waveform sidecar: %w", err)
	}
	var waveform Waveform
	if err := json.Unmarshal(data, &waveform); err != nil {
		return nil, fmt.Errorf("decode waveform sidecar: %w", err)
	}
	if waveform.Version != 1 || len(waveform.Peaks) != 2048 ||
		math.IsNaN(waveform.DurationSeconds) || math.IsInf(waveform.DurationSeconds, 0) ||
		waveform.DurationSeconds <= 0 || waveform.DurationSeconds > maxDurationSeconds {
		return nil, fmt.Errorf("invalid waveform sidecar for recording %s", id)
	}
	for _, pair := range waveform.Peaks {
		for _, peak := range pair {
			if math.IsNaN(float64(peak)) || math.IsInf(float64(peak), 0) || peak < -1 || peak > 1 {
				return nil, fmt.Errorf("invalid waveform peak for recording %s", id)
			}
		}
	}
	return &waveform, nil
}

func (s *Service) ApplyWaveformResult(ctx context.Context, objectKey, status string) error {
	if !strings.HasPrefix(objectKey, s.recordingsPrefix+"/users/") ||
		!strings.HasSuffix(objectKey, ".mp3") {
		return ErrInvalidWaveformResult
	}
	switch status {
	case "complete":
		status = "ready"
	case "failed":
	default:
		return ErrInvalidWaveformResult
	}
	if status == "failed" {
		if _, err := s.recordingsDB.FindByObjectKey(ctx, objectKey); err != nil {
			return err
		}
		_, err := s.recordingsDB.TransitionWaveformStatus(ctx, objectKey, "pending", "failed")
		return err
	}
	return s.recordingsDB.UpdateWaveformStatus(ctx, objectKey, status)
}

func (s *Service) PollPendingWaveforms(ctx context.Context) (int, error) {
	pending, err := s.recordingsDB.ListPendingWaveforms(ctx)
	if err != nil {
		return 0, fmt.Errorf("list pending recording waveforms: %w", err)
	}

	applied := 0
	for _, item := range pending {
		waveformObject, err := s.store.GetObject(ctx, item.ObjectKey+".waveform.json")
		if err == nil {
			closeErr := waveformObject.Body.Close()
			if closeErr != nil {
				return applied, fmt.Errorf("close waveform sidecar for %s: %w", item.ID, closeErr)
			}
			transitioned, err := s.recordingsDB.TransitionWaveformStatus(ctx, item.ObjectKey, "pending", "ready")
			if err != nil {
				return applied, fmt.Errorf("mark waveform ready for %s: %w", item.ID, err)
			}
			if transitioned {
				applied++
			}
			continue
		}

		statusObject, err := s.store.GetObject(ctx, item.ObjectKey+".waveform-status.json")
		if err == nil {
			var result struct {
				Status string `json:"status"`
			}
			decodeErr := json.NewDecoder(io.LimitReader(statusObject.Body, 4<<10)).Decode(&result)
			closeErr := statusObject.Body.Close()
			if decodeErr != nil {
				return applied, fmt.Errorf("decode waveform status for %s: %w", item.ID, decodeErr)
			}
			if closeErr != nil {
				return applied, fmt.Errorf("close waveform status for %s: %w", item.ID, closeErr)
			}
			if result.Status == "failed" {
				transitioned, err := s.recordingsDB.TransitionWaveformStatus(ctx, item.ObjectKey, "pending", "failed")
				if err != nil {
					return applied, fmt.Errorf("mark waveform failed for %s: %w", item.ID, err)
				}
				if transitioned {
					applied++
				}
				continue
			}
			return applied, fmt.Errorf("invalid waveform status marker for %s", item.ID)
		}
	}
	return applied, nil
}

func (s *Service) RetryWaveformForUser(ctx context.Context, id, userID string) error {
	item, err := s.recordingsDB.FindByIDForUser(ctx, id, userID)
	if err != nil {
		return err
	}
	if item.WaveformStatus != "failed" {
		return ErrWaveformNotFailed
	}
	if err := s.store.DeleteObject(ctx, item.ObjectKey+".waveform-status.json"); err != nil {
		return fmt.Errorf("clear waveform failure status: %w", err)
	}
	transitioned, err := s.recordingsDB.TransitionWaveformStatus(ctx, item.ObjectKey, "failed", "pending")
	if err != nil {
		return err
	}
	if !transitioned {
		return ErrWaveformNotFailed
	}
	if err := s.store.RetriggerObject(ctx, item.ObjectKey); err != nil {
		if _, statusErr := s.recordingsDB.TransitionWaveformStatus(ctx, item.ObjectKey, "pending", "failed"); statusErr != nil {
			return fmt.Errorf("retrigger waveform: %w (also failed to restore status: %v)", err, statusErr)
		}
		return fmt.Errorf("retrigger waveform: %w", err)
	}
	return nil
}

func (s *Service) Delete(ctx context.Context, id, userID string) error {
	item, err := s.recordingsDB.FindByIDForUser(ctx, id, userID)
	if err != nil {
		return err
	}
	if err := s.store.DeleteObject(ctx, item.ObjectKey+".waveform.json"); err != nil {
		return fmt.Errorf("delete recording waveform: %w", err)
	}
	if err := s.store.DeleteObject(ctx, item.ObjectKey+".waveform-status.json"); err != nil {
		return fmt.Errorf("delete recording waveform status: %w", err)
	}
	if err := s.store.DeleteObject(ctx, item.ObjectKey); err != nil {
		return fmt.Errorf("delete recording audio: %w", err)
	}
	if err := s.recordingsDB.Delete(ctx, id, userID); err != nil {
		return fmt.Errorf("delete recording metadata: %w", err)
	}
	return nil
}
