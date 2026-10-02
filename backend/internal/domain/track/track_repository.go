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

func (r *Repository) Migrate(ctx context.Context) error {
	return r.db.AutoMigrate(&Track{})
}

func (r *Repository) ListByUserID(ctx context.Context, userID string) ([]Track, error) {
	var tracks []Track
	err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Find(&tracks).Error
	return tracks, err
}

func (r *Repository) ListByUserIDs(ctx context.Context, userIDs []string) ([]Track, error) {
	if len(userIDs) == 0 {
		return []Track{}, nil
	}
	var tracks []Track
	err := r.db.WithContext(ctx).
		Where("user_id IN ?", userIDs).
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

func (r *Repository) FindByObjectKey(ctx context.Context, objectKey string) (*Track, error) {
	var t Track
	err := r.db.WithContext(ctx).Where("object_key = ?", objectKey).First(&t).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// ListPending returns every track across all users still awaiting
// analysis — used by PollPendingAnalyses, which is a maintenance job,
// not a per-user request, hence no user_id filter here.
func (r *Repository) ListPending(ctx context.Context) ([]Track, error) {
	var tracks []Track
	err := r.db.WithContext(ctx).Where("analysis_status = ?", AnalysisStatusPending).Find(&tracks).Error
	return tracks, err
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

// UpdateAnalysisByObjectKey applies the Lambda's analysis result. On
// failure (result.Status == AnalysisStatusFailed), only analysis_status
// is written — bpm/beat_offset/key are left as-is rather than overwritten
// with zero values from a failed run.
func (r *Repository) UpdateAnalysisByObjectKey(ctx context.Context, objectKey string, result AnalysisResult) (*Track, error) {
	existing, err := r.FindByObjectKey(ctx, objectKey)
	if err != nil {
		return nil, err
	}

	updates := map[string]any{
		"analysis_status": result.Status,
	}
	if result.Status == AnalysisStatusComplete {
		updates["bpm"] = result.BPM
		updates["beat_offset"] = result.BeatOffset
		updates["key"] = result.Key
	}

	res := r.db.WithContext(ctx).Model(existing).
		Where("analysis_status = ?", AnalysisStatusPending).
		Updates(updates)
	if res.Error != nil {
		return nil, res.Error
	}
	return r.FindByObjectKey(ctx, objectKey)
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

func (r *Repository) TransitionAnalysisStatus(ctx context.Context, id, userID string, from []string, to string) (bool, error) {
	res := r.db.WithContext(ctx).
		Model(&Track{}).
		Where("id = ? AND user_id = ? AND analysis_status IN ?", id, userID, from).
		Update("analysis_status", to)
	return res.RowsAffected > 0, res.Error
}
