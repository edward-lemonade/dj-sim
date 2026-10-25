package user

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type User struct {
	ID        string    `json:"id" gorm:"type:uuid;primaryKey"`
	ClerkID   *string   `json:"clerkId,omitempty" gorm:"uniqueIndex"`
	Username  string    `json:"username" gorm:"not null"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type GuestSession struct {
	ID               string     `json:"-" gorm:"type:uuid;primaryKey"`
	UserID           string     `json:"-" gorm:"type:uuid;uniqueIndex;not null"`
	TokenHash        string     `json:"-" gorm:"uniqueIndex;not null"`
	LastActiveAt     time.Time  `json:"-" gorm:"not null"`
	ExpiresAt        time.Time  `json:"-" gorm:"index;not null"`
	CleanupClaimed   bool       `json:"-" gorm:"not null;default:false"`
	CleanupClaimedAt *time.Time `json:"-"`
	CreatedAt        time.Time  `json:"-"`
}

func (u *User) BeforeCreate(_ *gorm.DB) error {
	if u.ID == "" {
		u.ID = uuid.NewString()
	}
	return nil
}

func (s *GuestSession) BeforeCreate(_ *gorm.DB) error {
	if s.ID == "" {
		s.ID = uuid.NewString()
	}
	return nil
}
