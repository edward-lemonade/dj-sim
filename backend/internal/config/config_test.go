package config

import (
	"bytes"
	"encoding/hex"
	"errors"
	"testing"
)

func TestRoomCodePepper(t *testing.T) {
	want := bytes.Repeat([]byte{0x42}, 32)
	cfg := Config{RoomCodePepperHex: hex.EncodeToString(want)}

	got, err := cfg.RoomCodePepper()
	if err != nil {
		t.Fatalf("RoomCodePepper() error = %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Errorf("RoomCodePepper() = %x, want %x", got, want)
	}
}

func TestRoomCodePepperAllowsUnsetValue(t *testing.T) {
	got, err := (Config{}).RoomCodePepper()
	if err != nil {
		t.Fatalf("RoomCodePepper() error = %v", err)
	}
	if got != nil {
		t.Errorf("RoomCodePepper() = %x, want nil when unset", got)
	}
}

func TestRoomCodePepperRejectsInvalidValues(t *testing.T) {
	for _, value := range []string{"not-hex", hex.EncodeToString([]byte("short"))} {
		if _, err := (Config{RoomCodePepperHex: value}).RoomCodePepper(); !errors.Is(err, ErrInvalidRoomCodePepper) {
			t.Errorf("RoomCodePepper(%q) error = %v, want ErrInvalidRoomCodePepper", value, err)
		}
	}
}

func TestLoadReadsRecordingKey(t *testing.T) {
	t.Setenv("AWS_S3_RECORDINGS_KEY", "recordings/")
	t.Setenv("AWS_S3_RECORDINGS_PREFIX", "")

	cfg := Load()
	if cfg.S3RecordingsKey != "recordings/" {
		t.Fatalf("S3RecordingsKey = %q, want recordings/", cfg.S3RecordingsKey)
	}
}
