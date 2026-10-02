package stream

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
)

var ErrNotFound = errors.New("stream not found")

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Migrate(ctx context.Context) error {
	return r.db.WithContext(ctx).AutoMigrate(&Session{})
}

func (r *Repository) EndAllActive(ctx context.Context) error {
	now := time.Now().UTC()
	return r.db.WithContext(ctx).Model(&Session{}).
		Where("active = ?", true).
		Updates(map[string]any{"active": false, "ended_at": now}).Error
}

func (r *Repository) Create(ctx context.Context, session *Session) error {
	return r.db.WithContext(ctx).Create(session).Error
}

func (r *Repository) ListActive(ctx context.Context) ([]Session, error) {
	var sessions []Session
	err := r.db.WithContext(ctx).Where("active = ?", true).Order("started_at DESC").Find(&sessions).Error
	return sessions, err
}

func (r *Repository) FindActive(ctx context.Context, id string) (*Session, error) {
	var session Session
	err := r.db.WithContext(ctx).Where("id = ? AND active = ?", id, true).First(&session).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *Repository) End(ctx context.Context, id, ownerID string) error {
	now := time.Now().UTC()
	result := r.db.WithContext(ctx).Model(&Session{}).
		Where("id = ? AND user_id = ? AND active = ?", id, ownerID, true).
		Updates(map[string]any{"active": false, "ended_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}
