package recording

import (
	"context"
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
	return r.db.AutoMigrate(&Recording{})
}

func (r *Repository) ListByUserID(ctx context.Context, userID string) ([]Recording, error) {
	var recordings []Recording
	err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Find(&recordings).Error
	return recordings, err
}

func (r *Repository) FindByIDForUser(ctx context.Context, id, userID string) (*Recording, error) {
	var item Recording
	err := r.db.WithContext(ctx).Where("id = ? AND user_id = ?", id, userID).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) Create(ctx context.Context, item *Recording) error {
	return r.db.WithContext(ctx).Create(item).Error
}

func (r *Repository) UpdateTitle(ctx context.Context, id, userID, title string) (*Recording, error) {
	item, err := r.FindByIDForUser(ctx, id, userID)
	if err != nil {
		return nil, err
	}
	if err := r.db.WithContext(ctx).Model(item).Update("title", title).Error; err != nil {
		return nil, err
	}
	return r.FindByIDForUser(ctx, id, userID)
}

func (r *Repository) Delete(ctx context.Context, id, userID string) error {
	result := r.db.WithContext(ctx).Where("id = ? AND user_id = ?", id, userID).Delete(&Recording{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}
