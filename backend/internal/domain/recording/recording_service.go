package recording

import (
	"context"
	"fmt"
	"io"
	"math"
	"path/filepath"
	"strings"

	"github.com/edward-lemonade/dj-sim-backend/internal/storage"
	"github.com/google/uuid"
)

const maxDurationSeconds = 60 * 60

type Service struct {
	recordingsDB Repository
	store        *storage.S3Store
}

func NewService(recordings *Repository, store *storage.S3Store) *Service {
	return &Service{recordingsDB: *recordings, store: store}
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

	key := fmt.Sprintf("recordings/users/%s/%s.mp3", userID, uuid.NewString())
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

func (s *Service) Delete(ctx context.Context, id, userID string) error {
	item, err := s.recordingsDB.FindByIDForUser(ctx, id, userID)
	if err != nil {
		return err
	}
	if err := s.store.DeleteObject(ctx, item.ObjectKey); err != nil {
		return fmt.Errorf("delete recording audio: %w", err)
	}
	if err := s.recordingsDB.Delete(ctx, id, userID); err != nil {
		return fmt.Errorf("delete recording metadata: %w", err)
	}
	return nil
}
