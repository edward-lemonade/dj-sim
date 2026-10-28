package recording

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Recording struct {
	ID              string    `json:"id" gorm:"type:uuid;primaryKey"`
	UserID          string    `json:"-" gorm:"type:uuid;index;not null"`
	Title           string    `json:"title" gorm:"not null"`
	ObjectKey       string    `json:"-" gorm:"not null"`
	ContentType     string    `json:"contentType" gorm:"not null"`
	DurationSeconds float64   `json:"durationSeconds" gorm:"not null"`
	WaveformStatus  string    `json:"waveformStatus" gorm:"not null;default:pending"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

func (r *Recording) BeforeCreate(_ *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.NewString()
	}
	if r.WaveformStatus == "" {
		r.WaveformStatus = "pending"
	}
	return nil
}
