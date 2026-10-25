package user

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Migrate(ctx context.Context) error {
	return r.db.AutoMigrate(&User{}, &GuestSession{})
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

func (r *Repository) CreateGuest(ctx context.Context, tokenHash string, now, expiresAt time.Time) (*User, error) {
	guest := &User{Username: "Guest"}
	session := &GuestSession{
		UserID:       guest.ID,
		TokenHash:    tokenHash,
		LastActiveAt: now,
		ExpiresAt:    expiresAt,
	}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(guest).Error; err != nil {
			return err
		}
		session.UserID = guest.ID
		return tx.Create(session).Error
	})
	if err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return nil, ErrAlreadyExists
		}
		return nil, err
	}
	return guest, nil
}

func (r *Repository) FindAndRefreshGuest(ctx context.Context, tokenHash string, now, expiresAt time.Time) (*User, error) {
	var guestSession GuestSession
	result := r.db.WithContext(ctx).Model(&GuestSession{}).
		Where("token_hash = ? AND expires_at > ? AND cleanup_claimed = ?", tokenHash, now, false).
		Updates(map[string]any{"last_active_at": now, "expires_at": expiresAt})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, ErrNotFound
	}
	if err := r.db.WithContext(ctx).Where("token_hash = ?", tokenHash).First(&guestSession).Error; err != nil {
		return nil, err
	}
	return r.FindByID(ctx, guestSession.UserID)
}

type GuestObjectKeys struct {
	UserID              string
	TrackObjectKeys     []string
	RecordingObjectKeys []string
}

func (r *Repository) ClaimGuest(ctx context.Context, tokenHash, clerkID, username string, now time.Time) (*User, bool, error) {
	var account *User
	claimed := false
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var guestSession GuestSession
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("token_hash = ?", tokenHash).First(&guestSession).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		if guestSession.ExpiresAt.Before(now) || guestSession.CleanupClaimed {
			return ErrGuestExpired
		}

		var guest User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND clerk_id IS NULL", guestSession.UserID).First(&guest).Error; err != nil {
			return err
		}

		var existing User
		err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("clerk_id = ?", clerkID).First(&existing).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		if errors.Is(err, gorm.ErrRecordNotFound) {
			guest.ClerkID = &clerkID
			guest.Username = username
			if err := tx.Save(&guest).Error; err != nil {
				return err
			}
			account = &guest
		} else {
			account = &existing
			if existing.ID != guest.ID {
				if err := tx.Table("tracks").Where("user_id = ?", guest.ID).
					Update("user_id", existing.ID).Error; err != nil {
					return err
				}
				if err := tx.Table("recordings").Where("user_id = ?", guest.ID).
					Update("user_id", existing.ID).Error; err != nil {
					return err
				}
				if err := tx.Delete(&User{}, "id = ?", guest.ID).Error; err != nil {
					return err
				}
			}
		}

		if err := tx.Delete(&GuestSession{}, "id = ?", guestSession.ID).Error; err != nil {
			return err
		}
		claimed = true
		return nil
	})
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return nil, false, ErrAlreadyExists
	}
	return account, claimed, err
}

func (r *Repository) ClaimExpiredGuests(ctx context.Context, now time.Time, limit int) ([]GuestObjectKeys, error) {
	var guests []GuestSession
	var claimed []GuestObjectKeys
	staleClaim := now.Add(-15 * time.Minute)
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where("expires_at <= ? AND (cleanup_claimed = ? OR cleanup_claimed_at <= ?)", now, false, staleClaim).
			Order("expires_at ASC").Limit(limit).Find(&guests).Error; err != nil {
			return err
		}
		for i := range guests {
			guests[i].CleanupClaimed = true
			guests[i].CleanupClaimedAt = &now
			if err := tx.Save(&guests[i]).Error; err != nil {
				return err
			}
			keys := GuestObjectKeys{UserID: guests[i].UserID}
			var tracks []struct{ ObjectKey string }
			if err := tx.Table("tracks").Select("object_key").Where("user_id = ?", keys.UserID).
				Scan(&tracks).Error; err != nil {
				return err
			}
			for _, track := range tracks {
				keys.TrackObjectKeys = append(keys.TrackObjectKeys, track.ObjectKey)
			}
			var recordings []struct{ ObjectKey string }
			if err := tx.Table("recordings").Select("object_key").Where("user_id = ?", keys.UserID).
				Scan(&recordings).Error; err != nil {
				return err
			}
			for _, recording := range recordings {
				keys.RecordingObjectKeys = append(keys.RecordingObjectKeys, recording.ObjectKey)
			}
			claimed = append(claimed, keys)
		}
		return nil
	})
	return claimed, err
}

func (r *Repository) ReleaseGuestCleanup(ctx context.Context, userID string) error {
	return r.db.WithContext(ctx).Model(&GuestSession{}).
		Where("user_id = ?", userID).
		Updates(map[string]any{"cleanup_claimed": false, "cleanup_claimed_at": nil}).Error
}

func (r *Repository) DeleteExpiredGuest(ctx context.Context, userID string, now time.Time) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var session GuestSession
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("user_id = ? AND cleanup_claimed = ? AND expires_at <= ?", userID, true, now).
			First(&session).Error; err != nil {
			return err
		}
		if err := tx.Exec("DELETE FROM tracks WHERE user_id = ?", userID).Error; err != nil {
			return err
		}
		if err := tx.Exec("DELETE FROM recordings WHERE user_id = ?", userID).Error; err != nil {
			return err
		}
		if err := tx.Delete(&GuestSession{}, "id = ?", session.ID).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND clerk_id IS NULL", userID).Delete(&User{}).Error
	})
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
