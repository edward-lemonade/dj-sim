package room

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"gorm.io/gorm"
)

func TestFormatJoinCode(t *testing.T) {
	tests := []struct {
		value int64
		want  string
	}{
		{value: 0, want: "000000"},
		{value: 9, want: "000009"},
		{value: 123456, want: "123456"},
		{value: 999999, want: "999999"},
	}

	for _, test := range tests {
		if got := formatJoinCode(test.value); got != test.want {
			t.Errorf("formatJoinCode(%d) = %q, want %q", test.value, got, test.want)
		}
	}
}

func TestGenerateJoinCode(t *testing.T) {
	for range 100 {
		code, err := GenerateJoinCode()
		if err != nil {
			t.Fatalf("GenerateJoinCode() error = %v", err)
		}
		if len(code) != 6 {
			t.Errorf("GenerateJoinCode() = %q, want six digits", code)
			continue
		}
		for _, digit := range code {
			if digit < '0' || digit > '9' {
				t.Errorf("GenerateJoinCode() = %q, want decimal digits", code)
				break
			}
		}
	}
}

func TestHashJoinCode(t *testing.T) {
	pepper := []byte("0123456789abcdef0123456789abcdef")
	hash, err := HashJoinCode("000042", pepper)
	if err != nil {
		t.Fatalf("HashJoinCode() error = %v", err)
	}
	if len(hash) != 64 {
		t.Errorf("HashJoinCode() hash length = %d, want 64", len(hash))
	}
	otherHash, err := HashJoinCode("000042", []byte("abcdef0123456789abcdef0123456789"))
	if err != nil {
		t.Fatalf("HashJoinCode() with another pepper error = %v", err)
	}
	if hash == otherHash {
		t.Error("HashJoinCode() must use its pepper")
	}
}

func TestHashJoinCodeRejectsInvalidInput(t *testing.T) {
	pepper := []byte("0123456789abcdef0123456789abcdef")
	for _, code := range []string{"12345", "1234567", "1234a6", "12 456"} {
		if _, err := HashJoinCode(code, pepper); !errors.Is(err, ErrInvalidJoinCode) {
			t.Errorf("HashJoinCode(%q) error = %v, want ErrInvalidJoinCode", code, err)
		}
	}
}

func TestHashJoinCodeRequiresPepper(t *testing.T) {
	if _, err := HashJoinCode("000042", []byte("short")); !errors.Is(err, ErrInvalidCodePepper) {
		t.Errorf("HashJoinCode() error = %v, want ErrInvalidCodePepper", err)
	}
}

func TestRoomBeforeCreateDefaults(t *testing.T) {
	room := Room{Visibility: VisibilityPublic}
	if err := room.BeforeCreate(&gorm.DB{}); err != nil {
		t.Fatalf("BeforeCreate() error = %v", err)
	}
	if room.ID == "" {
		t.Error("BeforeCreate() did not assign an ID")
	}
	if room.Capacity != DefaultCapacity {
		t.Errorf("capacity = %d, want %d", room.Capacity, DefaultCapacity)
	}
	if room.Status != StatusActive {
		t.Errorf("status = %q, want %q", room.Status, StatusActive)
	}
	if room.CreatedAt.IsZero() {
		t.Error("BeforeCreate() did not assign a creation time")
	}
}

func TestRoomBeforeCreateRejectsInvalidRoom(t *testing.T) {
	tests := []struct {
		name string
		room Room
		err  error
	}{
		{
			name: "visibility",
			room: Room{Visibility: "unlisted"},
			err:  ErrInvalidVisibility,
		},
		{
			name: "capacity",
			room: Room{Visibility: VisibilityPrivate, Capacity: -1},
			err:  ErrInvalidCapacity,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := test.room.BeforeCreate(&gorm.DB{}); !errors.Is(err, test.err) {
				t.Errorf("BeforeCreate() error = %v, want %v", err, test.err)
			}
		})
	}
}

func TestListedRoomOmitsJoinCode(t *testing.T) {
	listed := ToListed(Room{ID: "room-1", Visibility: VisibilityPublic}, nil, 0)
	payload, err := json.Marshal(listed)
	if err != nil {
		t.Fatalf("Marshal(ListedRoom) error = %v", err)
	}
	if strings.Contains(string(payload), "code") {
		t.Errorf("public directory payload unexpectedly contains code: %s", payload)
	}
	if listed.Members == nil {
		t.Error("ListedRoom members must be an empty array, not nil")
	}
	if listed.CoverArts != [2]*string{} {
		t.Errorf("empty ListedRoom cover arts = %v, want two null entries", listed.CoverArts)
	}
}
