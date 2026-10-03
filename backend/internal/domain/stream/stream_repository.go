package stream

import (
	"context"
	"errors"
	"sort"
	"sync"
	"time"

	"gorm.io/gorm"
)

var ErrNotFound = errors.New("stream not found")

type Repository struct {
	db       *gorm.DB
	mu       sync.RWMutex
	sessions map[string]*Session
}

func NewRepository(db *gorm.DB) *Repository {
	if db == nil {
		return NewInMemoryRepository()
	}
	return &Repository{db: db}
}

func NewInMemoryRepository() *Repository {
	return &Repository{sessions: make(map[string]*Session)}
}

func (r *Repository) Migrate(ctx context.Context) error {
	if r.db == nil {
		return nil
	}
	return r.db.WithContext(ctx).AutoMigrate(&Session{})
}

func (r *Repository) EndAllActive(ctx context.Context) error {
	if r.db != nil {
		now := time.Now().UTC()
		return r.db.WithContext(ctx).Model(&Session{}).
			Where("active = ?", true).
			Updates(map[string]any{"active": false, "ended_at": now}).Error
	}

	now := time.Now().UTC()
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, session := range r.sessions {
		if !session.Active {
			continue
		}
		session.Active = false
		session.EndedAt = &now
	}
	return nil
}

func (r *Repository) Create(ctx context.Context, session *Session) error {
	if r.db != nil {
		return r.db.WithContext(ctx).Create(session).Error
	}
	if session == nil {
		return errors.New("stream session is required")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if session.ID == "" {
		session.ID = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if session.Active && session.StartedAt.IsZero() {
		session.StartedAt = time.Now().UTC()
	}
	r.sessions[session.ID] = session
	return nil
}

func (r *Repository) ListActive(ctx context.Context) ([]Session, error) {
	if r.db != nil {
		var sessions []Session
		err := r.db.WithContext(ctx).Where("active = ?", true).Order("started_at DESC").Find(&sessions).Error
		return sessions, err
	}

	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Session, 0, len(r.sessions))
	for _, session := range r.sessions {
		if session.Active {
			out = append(out, *session)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].StartedAt.Equal(out[j].StartedAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].StartedAt.After(out[j].StartedAt)
	})
	return out, nil
}

func (r *Repository) FindActive(ctx context.Context, id string) (*Session, error) {
	if r.db != nil {
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

	r.mu.RLock()
	defer r.mu.RUnlock()
	session, ok := r.sessions[id]
	if !ok || !session.Active {
		return nil, ErrNotFound
	}
	clone := *session
	return &clone, nil
}

func (r *Repository) End(ctx context.Context, id, ownerID string) error {
	if r.db != nil {
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

	r.mu.Lock()
	defer r.mu.Unlock()
	session, ok := r.sessions[id]
	if !ok || !session.Active || session.UserID != ownerID {
		return ErrNotFound
	}
	now := time.Now().UTC()
	session.Active = false
	session.EndedAt = &now
	return nil
}

func (r *Repository) EndForced(ctx context.Context, id string) error {
	if r.db != nil {
		now := time.Now().UTC()
		result := r.db.WithContext(ctx).Model(&Session{}).
			Where("id = ? AND active = ?", id, true).
			Updates(map[string]any{"active": false, "ended_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrNotFound
		}
		return nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	session, ok := r.sessions[id]
	if !ok || !session.Active {
		return ErrNotFound
	}
	now := time.Now().UTC()
	session.Active = false
	session.EndedAt = &now
	return nil
}
