package track

import (
	"context"
	"encoding/json"
	"errors"

	"gorm.io/gorm"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) ListByUserID(ctx context.Context, userID string) ([]Track, error) {
	var tracks []Track
	err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Find(&tracks).Error
	return tracks, err
}

func (r *Repository) FindByIDForUser(ctx context.Context, id, userID string) (*Track, error) {
	var t Track
	err := r.db.WithContext(ctx).Where("id = ? AND user_id = ?", id, userID).First(&t).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (r *Repository) Create(ctx context.Context, track *Track) error {
	return r.db.WithContext(ctx).Create(track).Error
}

func (r *Repository) Update(ctx context.Context, id, userID string, fields UpdateFields) (*Track, error) {
	existing, err := r.FindByIDForUser(ctx, id, userID)
	if err != nil {
		return nil, err
	}

	updates := map[string]any{}
	if fields.Title != nil {
		updates["title"] = *fields.Title
	}
	if fields.Artist != nil {
		updates["artist"] = *fields.Artist
	}
	if fields.BPM != nil {
		updates["bpm"] = *fields.BPM
	}
	if fields.BeatOffset != nil {
		updates["beat_offset"] = *fields.BeatOffset
	}
	if fields.Key != nil {
		updates["key"] = *fields.Key
	}
	if fields.WaveformOverview != nil {
		updates["waveform_overview"] = fields.WaveformOverview
	}
	if fields.Cues != nil {
		b, err := json.Marshal(fields.Cues)
		if err != nil {
			return nil, err
		}
		updates["cues"] = gorm.Expr("?::jsonb", string(b))
	}
	if len(updates) == 0 {
		return existing, nil
	}

	if err := r.db.WithContext(ctx).Model(existing).Updates(updates).Error; err != nil {
		return nil, err
	}
	return r.FindByIDForUser(ctx, id, userID)
}

func (r *Repository) Delete(ctx context.Context, id, userID string) error {
	res := r.db.WithContext(ctx).Where("id = ? AND user_id = ?", id, userID).Delete(&Track{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}
