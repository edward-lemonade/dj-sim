package user

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
	return r.db.AutoMigrate(&User{})
}

func (r *Repository) FindByID(ctx context.Context, ID string) (*User, error) {
	var u User
	err := r.db.WithContext(ctx).Where("id = ?", ID).First(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *Repository) FindByClerkID(ctx context.Context, clerkID string) (*User, error) {
	var u User
	err := r.db.WithContext(ctx).Where("clerk_id = ?", clerkID).First(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *Repository) Create(ctx context.Context, user *User) error {
	err := r.db.WithContext(ctx).Create(user).Error
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return ErrAlreadyExists
	}
	return err
}

type AccountData struct {
	UserID              string
	TrackObjectKeys     []string
	RecordingObjectKeys []string
}

func (r *Repository) AccountDataByClerkID(ctx context.Context, clerkID string) (*AccountData, error) {
	u, err := r.FindByClerkID(ctx, clerkID)
	if err != nil {
		return nil, err
	}

	data := &AccountData{UserID: u.ID}
	var trackObjects []struct {
		ObjectKey string
	}
	if err := r.db.WithContext(ctx).Table("tracks").
		Select("object_key").Where("user_id = ?", u.ID).Scan(&trackObjects).Error; err != nil {
		return nil, err
	}
	for _, object := range trackObjects {
		data.TrackObjectKeys = append(data.TrackObjectKeys, object.ObjectKey)
	}

	var recordingObjects []struct {
		ObjectKey string
	}
	if err := r.db.WithContext(ctx).Table("recordings").
		Select("object_key").Where("user_id = ?", u.ID).Scan(&recordingObjects).Error; err != nil {
		return nil, err
	}
	for _, object := range recordingObjects {
		data.RecordingObjectKeys = append(data.RecordingObjectKeys, object.ObjectKey)
	}
	return data, nil
}

func (r *Repository) DeleteAccountData(ctx context.Context, userID string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("DELETE FROM tracks WHERE user_id = ?", userID).Error; err != nil {
			return err
		}
		if err := tx.Exec("DELETE FROM recordings WHERE user_id = ?", userID).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", userID).Delete(&User{}).Error
	})
}
