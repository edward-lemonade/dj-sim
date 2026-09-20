package track

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Track struct {
	ID        string    `json:"id" gorm:"type:uuid;primaryKey"`
	UserID    string    `json:"userId" gorm:"type:uuid;index;not null"`
	Title     string    `json:"title" gorm:"not null"`
	Artist    string    `json:"artist" gorm:"not null"`
	BPM       int       `json:"bpm"`
	Duration  string    `json:"duration"`
	Cover     string    `json:"cover"`
	URL       string    `json:"url" gorm:"not null"`
	ObjectKey string    `json:"-" gorm:"not null"`
	FileName  string    `json:"fileName"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (t *Track) BeforeCreate(_ *gorm.DB) error {
	if t.ID == "" {
		t.ID = uuid.NewString()
	}
	return nil
}
