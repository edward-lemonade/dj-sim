package recording

import "testing"

func TestBeforeCreateDefaultsWaveformStatus(t *testing.T) {
	item := &Recording{}
	if err := item.BeforeCreate(nil); err != nil {
		t.Fatalf("BeforeCreate() error = %v", err)
	}
	if item.WaveformStatus != "pending" {
		t.Fatalf("WaveformStatus = %q, want pending", item.WaveformStatus)
	}
	if item.ID == "" {
		t.Fatal("BeforeCreate() did not assign an ID")
	}
}

func TestNewServiceNormalizesRecordingsPrefix(t *testing.T) {
	service := NewService(&Repository{}, nil, " recordings/ ")
	if service.recordingsPrefix != "recordings" {
		t.Fatalf("recordingsPrefix = %q, want recordings", service.recordingsPrefix)
	}
}
