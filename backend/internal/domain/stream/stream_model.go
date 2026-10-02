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
	RoomID    *string    `json:"-" gorm:"type:uuid;index"`
}

func (s *Session) BeforeCreate(_ *gorm.DB) error {
	if s.ID == "" {
		s.ID = uuid.NewString()
	}
	return nil
}

type ListedMember struct {
	Username  string `json:"username"`
	AvatarURL string `json:"avatarUrl"`
}

type ListedRoomBroadcast struct {
	ID          string         `json:"id"`
	Visibility  string         `json:"visibility"`
	Members     []ListedMember `json:"members"`
	MemberCount int            `json:"memberCount"`
	Capacity    int            `json:"capacity"`
	Code        string         `json:"code,omitempty"`
}

type ListedSession struct {
	ID        string               `json:"id"`
	Username  string               `json:"username"`
	AvatarURL string               `json:"avatarUrl"`
	Name      string               `json:"name"`
	StartedAt time.Time            `json:"startedAt"`
	CoverArts [2]*string           `json:"coverArts"`
	Room      *ListedRoomBroadcast `json:"room,omitempty"`
}

func ToListed(s Session) ListedSession {
	return ListedSession{
		ID: s.ID, Username: s.Username, AvatarURL: s.AvatarURL,
		Name: s.Name, StartedAt: s.StartedAt, CoverArts: [2]*string{},
	}
}
