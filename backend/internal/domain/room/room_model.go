package room

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	VisibilityPublic  = "public"
	VisibilityPrivate = "private"

	StatusActive = "active"
	StatusClosed = "closed"

	DefaultCapacity = 2
	codeSpace       = 1_000_000
)

var (
	ErrInvalidVisibility = errors.New("room visibility must be public or private")
	ErrInvalidAvatar     = errors.New("avatar URL must be an HTTPS URL")
	ErrInvalidCapacity   = errors.New("room capacity must be positive")
	ErrInvalidJoinCode   = errors.New("room join code must contain exactly six digits")
	ErrInvalidCodePepper = errors.New("room join code pepper must be at least 32 bytes")
	ErrCodeAllocation    = errors.New("could not allocate a unique room join code")
	ErrCodeConfig        = errors.New("room join codes are not configured")
	ErrUnavailable       = errors.New("room is unavailable")
	ErrFull              = errors.New("room is full")
	ErrAlreadyStreaming  = errors.New("room is already streaming")
)

type Room struct {
	ID            string     `json:"id" gorm:"type:uuid;primaryKey"`
	CreatorUserID string     `json:"-" gorm:"type:uuid;index;not null"`
	CodeHash      *string    `json:"-" gorm:"uniqueIndex:uidx_rooms_code_hash"`
	Visibility    string     `json:"visibility" gorm:"not null;index"`
	Capacity      int        `json:"capacity" gorm:"not null"`
	Status        string     `json:"status" gorm:"not null;index"`
	CreatedAt     time.Time  `json:"createdAt"`
	ClosedAt      *time.Time `json:"closedAt,omitempty"`
	StreamID      *string    `json:"-" gorm:"type:uuid;index"`
}

func (r *Room) BeforeCreate(_ *gorm.DB) error {
	return r.prepare()
}

func (r *Room) prepare() error {
	if r.ID == "" {
		r.ID = uuid.NewString()
	}
	if r.Visibility != VisibilityPublic && r.Visibility != VisibilityPrivate {
		return ErrInvalidVisibility
	}
	if r.Capacity == 0 {
		r.Capacity = DefaultCapacity
	}
	if r.Capacity < 1 {
		return ErrInvalidCapacity
	}
	if r.Status == "" {
		r.Status = StatusActive
	}
	if r.CreatedAt.IsZero() {
		r.CreatedAt = time.Now().UTC()
	}
	return nil
}

type Member struct {
	RoomID    string    `json:"roomId" gorm:"type:uuid;primaryKey"`
	UserID    string    `json:"userId" gorm:"type:uuid;primaryKey"`
	Username  string    `json:"username" gorm:"not null;default:''"`
	AvatarURL string    `json:"avatarUrl" gorm:"not null;default:''"`
	JoinedAt  time.Time `json:"joinedAt"`
}

func (Member) TableName() string {
	return "room_members"
}

type ListedMember struct {
	UserID    string `json:"userId"`
	Username  string `json:"username"`
	AvatarURL string `json:"avatarUrl"`
}

type memberLookup struct {
	UserID    string
	Username  string
	AvatarURL string
}

type ControlLease struct {
	ControlID    string    `json:"controlId"`
	OwnerID      string    `json:"ownerId"`
	OwnerUsername string    `json:"ownerUsername"`
	ExpiresAt    time.Time `json:"expiresAt"`
}

type RoomTrack struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Artist       string `json:"artist"`
	BPM          int    `json:"bpm"`
	Key          string `json:"key"`
	CoverURL     string `json:"coverUrl"`
	OwnerID      string `json:"ownerId"`
	OwnerUsername string `json:"ownerUsername"`
	OwnerAvatarURL string `json:"ownerAvatarUrl"`
}

type ListedRoom struct {
	ID          string         `json:"id"`
	Visibility  string         `json:"visibility"`
	Members     []ListedMember `json:"members"`
	MemberCount int            `json:"memberCount"`
	Capacity    int            `json:"capacity"`
	CreatedAt   time.Time      `json:"createdAt"`
	CoverArts   [2]*string     `json:"coverArts"`
}

type JoinResult struct {
	Room          ListedRoom `json:"room"`
	AlreadyMember bool       `json:"alreadyMember"`
	Code          string     `json:"code,omitempty"`
	EventURL      string     `json:"eventUrl,omitempty"`
	EventTicket   string     `json:"eventTicket,omitempty"`
}

type LeaveResult struct {
	RoomClosed bool   `json:"roomClosed"`
	StreamID   string `json:"-"`
}

type BroadcastListing struct {
	StreamID    string
	ID          string
	Visibility  string
	Members     []ListedMember
	MemberCount int
	Capacity    int
	Code        string
}

func ToListed(room Room, members []ListedMember, memberCount int) ListedRoom {
	if members == nil {
		members = []ListedMember{}
	}
	return ListedRoom{
		ID: room.ID, Visibility: room.Visibility, Members: members, MemberCount: memberCount,
		Capacity: room.Capacity, CreatedAt: room.CreatedAt,
		CoverArts: [2]*string{},
	}
}

func GenerateJoinCode() (string, error) {
	value, err := rand.Int(rand.Reader, big.NewInt(codeSpace))
	if err != nil {
		return "", fmt.Errorf("generate room join code: %w", err)
	}
	return formatJoinCode(value.Int64()), nil
}

func HashJoinCode(code string, pepper []byte) (string, error) {
	if len(code) != 6 {
		return "", ErrInvalidJoinCode
	}
	if len(pepper) < 32 {
		return "", ErrInvalidCodePepper
	}
	for _, digit := range code {
		if digit < '0' || digit > '9' {
			return "", ErrInvalidJoinCode
		}
	}
	mac := hmac.New(sha256.New, pepper)
	_, _ = mac.Write([]byte(code))
	return hex.EncodeToString(mac.Sum(nil)), nil
}

func formatJoinCode(value int64) string {
	return fmt.Sprintf("%06d", value)
}
