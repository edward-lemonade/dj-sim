package room

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/edward-lemonade/dj-sim-backend/internal/domain/track"
)

type Service struct {
	repository RepositoryService
	pepper     []byte
	manager    *RoomManager
	streams    StreamTerminator
	tracks     TrackDirectory
	s3Store    S3Presigner
}

type TrackDirectory interface {
	ListByUserIDs(ctx context.Context, userIDs []string) ([]track.Track, error)
}

type StreamTerminator interface {
	EndForced(ctx context.Context, streamID string) error
}

type S3Presigner interface {
	PresignedGetObject(ctx context.Context, objectKey string, expiresIn time.Duration) (string, error)
}

type RepositoryService interface {
	CreateWithCode(ctx context.Context, room *Room, creatorID, username, avatarURL string, pepper []byte) (string, error)
	ListPublic(ctx context.Context) ([]ListedRoom, error)
	Get(ctx context.Context, roomID, userID string) (*ListedRoom, error)
	GetMemberUserIDs(ctx context.Context, roomID string) ([]string, error)
	JoinByCode(ctx context.Context, code, userID, username, avatarURL string, pepper []byte) (*JoinResult, error)
	JoinPublic(ctx context.Context, roomID, userID, username, avatarURL string) (*JoinResult, error)
	Leave(ctx context.Context, roomID, userID string) (*LeaveResult, error)
	AssociateStream(ctx context.Context, roomID, userID, streamID string) error
	DetachStream(ctx context.Context, streamID string) error
	BroadcastsByStreamIDs(ctx context.Context, streamIDs []string) (map[string]BroadcastListing, error)
	CanControlStream(ctx context.Context, streamID, userID string) (bool, error)
	CloseRoomsNoMembers(ctx context.Context) error
}

type CreatedRoom struct {
	ID          string    `json:"id"`
	Code        string    `json:"code"`
	Visibility  string    `json:"visibility"`
	Capacity    int       `json:"capacity"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
	EventURL    string    `json:"eventUrl"`
	EventTicket string    `json:"eventTicket"`
}

func NewService(repository RepositoryService, pepper []byte, managers ...*RoomManager) *Service {
	manager := NewRoomManager()
	if len(managers) > 0 && managers[0] != nil {
		manager = managers[0]
	}
	return &Service{repository: repository, pepper: append([]byte(nil), pepper...), manager: manager}
}

func (s *Service) SetStreamTerminator(streams StreamTerminator) {
	s.streams = streams
}

func (s *Service) SetTrackDirectory(tracks TrackDirectory) {
	s.tracks = tracks
}

func (s *Service) SetS3Store(store S3Presigner) {
	s.s3Store = store
}

func (s *Service) Create(ctx context.Context, creatorID, username, avatarURL, visibility string) (*CreatedRoom, error) {
	if creatorID == "" {
		return nil, errors.New("room creator is required")
	}
	if visibility != VisibilityPublic && visibility != VisibilityPrivate {
		return nil, ErrInvalidVisibility
	}
	if avatarURL != "" {
		avatarURL = strings.TrimSpace(avatarURL)
		avatar, err := url.ParseRequestURI(avatarURL)
		if err != nil || avatar.Scheme != "https" || avatar.Host == "" {
			return nil, ErrInvalidAvatar
		}
	}
	if len(s.pepper) < 32 {
		return nil, ErrCodeConfig
	}

	item := &Room{
		CreatorUserID: creatorID,
		Visibility:    visibility,
		Capacity:      DefaultCapacity,
		Status:        StatusActive,
	}
	code, err := s.repository.CreateWithCode(ctx, item, creatorID, username, avatarURL, s.pepper)
	if err != nil {
		return nil, err
	}
	if item.ID == "" {
		return nil, errors.New("room creation returned no room ID")
	}
	s.manager.Ensure(item.ID)
	s.manager.RememberInviteCode(item.ID, code)
	ticket, err := s.manager.IssueTicket(item.ID, creatorID, username)
	if err != nil {
		return nil, err
	}
	return &CreatedRoom{
		ID: item.ID, Code: code, Visibility: item.Visibility, Capacity: item.Capacity,
		Status: item.Status, CreatedAt: item.CreatedAt, EventURL: "/rooms/" + item.ID + "/events", EventTicket: ticket,
	}, nil
}

func (s *Service) ListPublic(ctx context.Context) ([]ListedRoom, error) {
	rooms, err := s.repository.ListPublic(ctx)
	if err != nil {
		return nil, err
	}
	for i := range rooms {
		rooms[i] = withCoverArts(rooms[i], s.manager.CoverArts(rooms[i].ID))
	}
	return rooms, nil
}

func (s *Service) Get(ctx context.Context, roomID, userID string) (*ListedRoom, error) {
	if userID == "" {
		return nil, errors.New("room user is required")
	}
	item, err := s.repository.Get(ctx, roomID, userID)
	if err != nil {
		return nil, err
	}
	listed := withCoverArts(*item, s.manager.CoverArts(item.ID))
	return &listed, nil
}

func (s *Service) JoinByCode(ctx context.Context, code, userID, username, avatarURL string) (*JoinResult, error) {
	if userID == "" {
		return nil, errors.New("room member is required")
	}
	if len(s.pepper) < 32 {
		return nil, ErrCodeConfig
	}
	if _, err := HashJoinCode(code, s.pepper); err != nil {
		return nil, err
	}
	avatarURL, err := validateAvatarURL(avatarURL)
	if err != nil {
		return nil, err
	}
	joined, err := s.repository.JoinByCode(ctx, code, userID, username, avatarURL, s.pepper)
	if err != nil {
		return nil, err
	}
	s.manager.Ensure(joined.Room.ID)
	s.manager.RememberInviteCode(joined.Room.ID, code)
	return s.attachConnection(joined, userID, username)
}

func (s *Service) JoinPublic(ctx context.Context, roomID, userID, username, avatarURL string) (*JoinResult, error) {
	if userID == "" {
		return nil, errors.New("room member is required")
	}
	avatarURL, err := validateAvatarURL(avatarURL)
	if err != nil {
		return nil, err
	}
	joined, err := s.repository.JoinPublic(ctx, roomID, userID, username, avatarURL)
	if err != nil {
		return nil, err
	}
	return s.attachConnection(joined, userID, username)
}

func (s *Service) Leave(ctx context.Context, roomID, userID string) (*LeaveResult, error) {
	if userID == "" {
		return nil, errors.New("room member is required")
	}
	result, err := s.repository.Leave(ctx, roomID, userID)
	if err != nil {
		return nil, err
	}
	if result.RoomClosed {
		s.manager.Close(roomID)
		if result.StreamID != "" && s.streams != nil {
			if err := s.streams.EndForced(ctx, result.StreamID); err != nil {
				return nil, err
			}
		}
	} else {
		s.manager.RemoveMember(roomID, userID)
	}
	return result, nil
}

func (s *Service) AssociateStream(ctx context.Context, roomID, userID, streamID string) error {
	return s.repository.AssociateStream(ctx, roomID, userID, streamID)
}

func (s *Service) DetachStream(ctx context.Context, streamID string) error {
	return s.repository.DetachStream(ctx, streamID)
}

func (s *Service) BroadcastsByStreamIDs(ctx context.Context, streamIDs []string) (map[string]BroadcastListing, error) {
	listings, err := s.repository.BroadcastsByStreamIDs(ctx, streamIDs)
	if err != nil {
		return nil, err
	}
	for streamID, listing := range listings {
		if listing.Visibility == VisibilityPublic {
			listing.Code = s.manager.InviteCode(listing.ID)
		} else {
			listing.Code = ""
		}
		listings[streamID] = listing
	}
	return listings, nil
}

func (s *Service) CanControl(ctx context.Context, streamID, userID string) (bool, error) {
	return s.repository.CanControlStream(ctx, streamID, userID)
}

func (s *Service) CleanupRoomsNoMembers(ctx context.Context) error {
	if err := s.repository.CloseRoomsNoMembers(ctx); err != nil {
		return err
	}
	return nil
}

func (s *Service) RelayManager() *RoomManager {
	return s.manager
}

func (s *Service) attachConnection(joined *JoinResult, userID, username string) (*JoinResult, error) {
	if joined == nil || joined.Room.ID == "" {
		return nil, errors.New("room join returned no room ID")
	}
	s.manager.Ensure(joined.Room.ID)
	ticket, err := s.manager.IssueTicket(joined.Room.ID, userID, username)
	if err != nil {
		return nil, err
	}
	joined.EventURL = "/rooms/" + joined.Room.ID + "/events"
	joined.EventTicket = ticket
	joined.Code = s.manager.InviteCode(joined.Room.ID)
	joined.Room = withCoverArts(joined.Room, s.manager.CoverArts(joined.Room.ID))
	return joined, nil
}

func validateAvatarURL(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	avatar, err := url.ParseRequestURI(value)
	if err != nil || avatar.Scheme != "https" || avatar.Host == "" {
		return "", ErrInvalidAvatar
	}
	return value, nil
}

func withCoverArts(item ListedRoom, covers [2]string) ListedRoom {
	for i, value := range covers {
		if value == "" {
			continue
		}
		cover := value
		item.CoverArts[i] = &cover
	}
	return item
}

func (s *Service) GetRoomLibrary(ctx context.Context, roomID, requestingUserID string) ([]RoomTrack, error) {
	if s.tracks == nil {
		return nil, errors.New("track directory is not configured")
	}
	room, err := s.repository.Get(ctx, roomID, requestingUserID)
	if err != nil {
		return nil, err
	}
	userIDs, err := s.repository.GetMemberUserIDs(ctx, roomID)
	if err != nil {
		return nil, err
	}
	if len(userIDs) == 0 {
		return []RoomTrack{}, nil
	}
	memberByUserID := make(map[string]ListedMember)
	for _, member := range room.Members {
		memberByUserID[member.UserID] = member
	}
	tracks, err := s.tracks.ListByUserIDs(ctx, userIDs)
	if err != nil {
		return nil, err
	}
	result := make([]RoomTrack, 0, len(tracks))
	for _, t := range tracks {
		member := memberByUserID[t.UserID]
		result = append(result, RoomTrack{
			ID:             t.ID,
			Title:          t.Title,
			Artist:         t.Artist,
			BPM:            t.BPM,
			Key:            t.Key,
			CoverURL:       t.Cover,
			OwnerID:        t.UserID,
			OwnerUsername:  member.Username,
			OwnerAvatarURL: member.AvatarURL,
		})
	}
	return result, nil
}

func (s *Service) IssueTrackAccessToken(ctx context.Context, roomID, userID, trackID string) (string, error) {
	if roomID == "" || userID == "" || trackID == "" {
		return "", errors.New("room ID, user ID, and track ID are required")
	}
	_, err := s.repository.Get(ctx, roomID, userID)
	if err != nil {
		return "", err
	}
	return s.manager.IssueTrackToken(roomID, userID, trackID, TrackAccessTokenTTL)
}

func (s *Service) GetTrackAudioURL(ctx context.Context, roomID, trackID, token string) (string, error) {
	if roomID == "" || trackID == "" || token == "" {
		return "", errors.New("room ID, track ID, and token are required")
	}
	if s.s3Store == nil {
		return "", errors.New("S3 store is not configured")
	}
	userID, err := s.manager.ValidateTrackToken(token, roomID, trackID)
	if err != nil {
		return "", err
	}
	if userID == "" {
		return "", errors.New("invalid track access token")
	}
	_, err = s.repository.Get(ctx, roomID, userID)
	if err != nil {
		return "", err
	}
	if s.tracks == nil {
		return "", errors.New("track directory is not configured")
	}
	tracks, err := s.tracks.ListByUserIDs(ctx, []string{userID})
	if err != nil {
		return "", err
	}
	var objectKey string
	for _, t := range tracks {
		if t.ID == trackID {
			objectKey = t.ObjectKey
			break
		}
	}
	if objectKey == "" {
		return "", errors.New("track not found or not owned by user")
	}
	return s.s3Store.PresignedGetObject(ctx, objectKey, 5*time.Minute)
}
