package stream

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Session struct {
	ID        string     `json:"id" gorm:"type:uuid;primaryKey"`
	UserID    string     `json:"-" gorm:"type:uuid;index;not null"`
	Username  string     `json:"username" gorm:"not null"`
	AvatarURL string     `json:"avatarUrl"`
	Name      string     `json:"name" gorm:"not null"`
	StartedAt time.Time  `json:"startedAt" gorm:"index;not null"`
	EndedAt   *time.Time `json:"endedAt,omitempty"`
	Active    bool       `json:"active" gorm:"index;not null;default:true"`
}

func (s *Session) BeforeCreate(_ *gorm.DB) error {
	if s.ID == "" {
		s.ID = uuid.NewString()
	}
	return nil
}

type ListedSession struct {
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	AvatarURL string    `json:"avatarUrl"`
	Name      string    `json:"name"`
	StartedAt time.Time `json:"startedAt"`
}

func ToListed(s Session) ListedSession {
	return ListedSession{
		ID: s.ID, Username: s.Username, AvatarURL: s.AvatarURL,
		Name: s.Name, StartedAt: s.StartedAt,
	}
}
