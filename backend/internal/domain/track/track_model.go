package track

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type WaveformOverview struct {
	Lows            []float64 `json:"lows"`
	Mids            []float64 `json:"mids"`
	Highs           []float64 `json:"highs"`
	DurationSeconds float64   `json:"durationSeconds,omitempty"`
}

type Track struct {
	ID               string            `json:"id" gorm:"type:uuid;primaryKey"`
	UserID           string            `json:"userId" gorm:"type:uuid;index;not null"`
	Title            string            `json:"title" gorm:"not null"`
	Artist           string            `json:"artist" gorm:"not null"`
	BPM              int               `json:"bpm"`
	BeatOffset       float64           `json:"beatOffset" gorm:"not null;default:0"`
	Key              string            `json:"key"`
	Duration         string            `json:"duration"`
	Cover            string            `json:"cover"`
	URL              string            `json:"url" gorm:"not null"`
	ObjectKey        string            `json:"-" gorm:"not null"`
	FileName         string            `json:"fileName"`
	WaveformOverview *WaveformOverview `json:"waveformOverview" gorm:"type:jsonb;serializer:json"`
	CreatedAt        time.Time         `json:"createdAt"`
	UpdatedAt        time.Time         `json:"updatedAt"`
}

type UpdateFields struct {
	Title            *string
	Artist           *string
	BPM              *int
	BeatOffset       *float64
	Key              *string
	WaveformOverview *WaveformOverview
}

func (t *Track) BeforeCreate(_ *gorm.DB) error {
	if t.ID == "" {
		t.ID = uuid.NewString()
	}
	return nil
}
