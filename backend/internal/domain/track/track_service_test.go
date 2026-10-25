package track

import (
	"path"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestBuildTrackObjectKeyUsesUserAndFilenameUUID(t *testing.T) {
	userID := uuid.NewString()
	service := &Service{tracksPrefix: "tracks"}

	objectKey, err := service.buildTrackObjectKey(userID, "My Song.mp3")
	if err != nil {
		t.Fatalf("buildTrackObjectKey() error = %v", err)
	}

	parts := strings.Split(objectKey, "/")
	if len(parts) != 3 {
		t.Fatalf("object key = %q, want three path segments", objectKey)
	}
	if parts[0] != "tracks" {
		t.Errorf("prefix = %q, want %q", parts[0], "tracks")
	}
	if parts[1] != userID {
		t.Errorf("user segment = %q, want %q", parts[1], userID)
	}
	if !strings.HasPrefix(parts[2], "My_Song-") || path.Ext(parts[2]) != ".mp3" {
		t.Errorf("filename = %q, want My_Song-{uuid}.mp3", parts[2])
	}
	fileID := strings.TrimSuffix(strings.TrimPrefix(parts[2], "My_Song-"), ".mp3")
	if _, err := uuid.Parse(fileID); err != nil {
		t.Errorf("filename UUID %q is invalid: %v", fileID, err)
	}
}

func TestBuildTrackObjectKeyRejectsInvalidUserID(t *testing.T) {
	service := &Service{tracksPrefix: "tracks"}

	if _, err := service.buildTrackObjectKey("../someone-else", "song.mp3"); err == nil {
		t.Fatal("buildTrackObjectKey() error = nil, want invalid user ID error")
	}
}
