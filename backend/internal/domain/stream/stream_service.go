package stream

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	lkauth "github.com/livekit/protocol/auth"
	livekit "github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
)

var (
	ErrInvalidName          = errors.New("stream name must be between 1 and 120 characters")
	ErrInvalidAvatar        = errors.New("avatar URL must be an HTTPS URL")
	ErrLiveKitNotConfigured = errors.New("LiveKit Cloud is not configured")
	ErrCleanupStorage       = errors.New("stream startup cleanup storage failure")
)

type Service struct {
	repository *Repository
	manager    *Manager
	liveKitURL string
	apiKey     string
	apiSecret  string
	createMu   sync.Mutex
}

func NewService(repository *Repository, manager *Manager, liveKitURL, apiKey, apiSecret string) *Service {
	return &Service{
		repository: repository,
		manager:    manager,
		liveKitURL: strings.TrimRight(liveKitURL, "/"),
		apiKey:     apiKey,
		apiSecret:  apiSecret,
	}
}

type CreateInput struct {
	UserID    string
	Username  string
	AvatarURL string
	Name      string
}

type Connection struct {
	Session      ListedSession `json:"session"`
	EventURL     string        `json:"eventUrl"`
	EventTicket  string        `json:"eventTicket"`
	ExitTicket   string        `json:"exitTicket,omitempty"`
	LiveKitURL   string        `json:"liveKitUrl"`
	LiveKitToken string        `json:"liveKitToken"`
}

func (s *Service) List(ctx context.Context) ([]ListedSession, error) {
	sessions, err := s.repository.ListActive(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]ListedSession, 0, len(sessions))
	for _, session := range sessions {
		result = append(result, ToListed(session))
	}
	return result, nil
}

func (s *Service) Create(ctx context.Context, input CreateInput) (*Connection, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" || utf8.RuneCountInString(name) > 120 {
		return nil, ErrInvalidName
	}
	if input.AvatarURL != "" {
		avatar, err := url.ParseRequestURI(input.AvatarURL)
		if err != nil || avatar.Scheme != "https" || avatar.Host == "" {
			return nil, ErrInvalidAvatar
		}
	}
	if err := s.requireLiveKit(); err != nil {
		return nil, err
	}
	s.createMu.Lock()
	defer s.createMu.Unlock()

	activeSessions, err := s.repository.ListActive(ctx)
	if err != nil {
		return nil, fmt.Errorf("list active streams before creating a session: %w", err)
	}
	for _, active := range activeSessions {
		if active.UserID == input.UserID {
			if err := s.End(ctx, active.ID, input.UserID); err != nil && !errors.Is(err, ErrNotFound) {
				return nil, fmt.Errorf("end previous stream %q before creating a new one: %w", active.ID, err)
			}
		}
	}

	session := &Session{
		UserID: input.UserID, Username: input.Username, AvatarURL: input.AvatarURL,
		Name: name, StartedAt: time.Now().UTC(), Active: true,
	}
	if err := s.repository.Create(ctx, session); err != nil {
		return nil, err
	}
	s.manager.Start(session.ID, session.UserID)
	connection, err := s.connection(*session, input.UserID, true)
	if err != nil {
		s.manager.End(session.ID)
		_ = s.repository.End(ctx, session.ID, session.UserID)
		return nil, err
	}
	return connection, nil
}

func (s *Service) Join(ctx context.Context, id, userID string) (*Connection, error) {
	if err := s.requireLiveKit(); err != nil {
		return nil, err
	}
	session, err := s.repository.FindActive(ctx, id)
	if err != nil {
		return nil, err
	}
	return s.connection(*session, userID, session.UserID == userID)
}

func (s *Service) End(ctx context.Context, id, userID string) error {
	if err := s.repository.End(ctx, id, userID); err != nil {
		return err
	}
	s.manager.End(id)
	return s.revokeRoom(ctx, id)
}

func (s *Service) EndAllActive(ctx context.Context) error {
	sessions, err := s.repository.ListActive(ctx)
	if err != nil {
		return fmt.Errorf("%w: list active sessions: %w", ErrCleanupStorage, err)
	}
	var revokeErrors []error
	if len(sessions) > 0 && s.requireLiveKit() != nil {
		revokeErrors = append(revokeErrors, ErrLiveKitNotConfigured)
	} else {
		for _, session := range sessions {
			if err := s.revokeRoom(ctx, session.ID); err != nil {
				revokeErrors = append(revokeErrors, err)
			}
		}
	}
	if err := s.repository.EndAllActive(ctx); err != nil {
		return errors.Join(append(revokeErrors, fmt.Errorf("%w: mark sessions ended: %w", ErrCleanupStorage, err))...)
	}
	for _, session := range sessions {
		s.manager.End(session.ID)
	}
	return errors.Join(revokeErrors...)
}

func (s *Service) revokeRoom(ctx context.Context, id string) error {
	if err := s.requireLiveKit(); err != nil {
		return err
	}
	if _, err := lksdk.NewRoomServiceClient(s.liveKitURL, s.apiKey, s.apiSecret).
		DeleteRoom(ctx, &livekit.DeleteRoomRequest{Room: id}); err != nil {
		return fmt.Errorf("revoke LiveKit room %q: %w", id, err)
	}
	return nil
}

func (s *Service) TicketManager() *Manager {
	return s.manager
}

func (s *Service) requireLiveKit() error {
	if s.liveKitURL == "" || s.apiKey == "" || s.apiSecret == "" {
		return ErrLiveKitNotConfigured
	}
	return nil
}

func (s *Service) connection(session Session, userID string, owner bool) (*Connection, error) {
	ticket, err := s.manager.IssueTicket(session.ID, userID, owner)
	if err != nil {
		return nil, err
	}
	exitTicket := ""
	if owner {
		exitTicket, err = s.manager.IssueExitTicket(session.ID, userID)
		if err != nil {
			return nil, err
		}
	}
	canPublish, canSubscribe := owner, true
	access := lkauth.NewAccessToken(s.apiKey, s.apiSecret).
		SetIdentity(userID + "-" + uuid.NewString()).
		SetName(session.Username).
		SetValidFor(10 * time.Minute).
		SetVideoGrant(&lkauth.VideoGrant{
			RoomJoin:   true,
			Room:       session.ID,
			CanPublish: &canPublish,
			CanPublishSources: func() []string {
				if owner {
					return []string{"microphone"}
				}
				return []string{}
			}(),
			CanSubscribe: &canSubscribe,
		})
	token, err := access.ToJWT()
	if err != nil {
		return nil, fmt.Errorf("create LiveKit token: %w", err)
	}
	return &Connection{
		Session:      ToListed(session),
		EventURL:     "/streams/" + session.ID + "/events",
		EventTicket:  ticket,
		ExitTicket:   exitTicket,
		LiveKitURL:   s.liveKitURL,
		LiveKitToken: token,
	}, nil
}
