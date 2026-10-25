package user

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"
)

type Service struct {
	usersDB        Repository
	store          AccountObjectStore
	analysisPrefix string
	cleanupRooms   func(context.Context, string) error
}

type AccountObjectStore interface {
	DeleteObject(ctx context.Context, objectKey string) error
}

func NewService(users *Repository, store AccountObjectStore, analysisPrefix string) *Service {
	return &Service{
		usersDB:        *users,
		store:          store,
		analysisPrefix: strings.Trim(strings.TrimSpace(analysisPrefix), "/"),
	}
}

func (s *Service) SetGuestRoomCleanup(cleanup func(context.Context, string) error) {
	s.cleanupRooms = cleanup
}

func (s *Service) FindByID(ctx context.Context, ID string) (*User, error) {
	u, err := s.usersDB.FindByID(ctx, ID)
	if errors.Is(err, ErrNotFound) {
		return nil, ErrNotFound
	}
	return u, err
}

func (s *Service) FindByClerkID(ctx context.Context, clerkID string) (*User, error) {
	u, err := s.usersDB.FindByClerkID(ctx, clerkID)
	if errors.Is(err, ErrNotFound) {
		return nil, ErrNotFound
	}
	return u, err
}

func (s *Service) GetByClerkID(ctx context.Context, clerkID string) (*User, error) {
	return s.FindByClerkID(ctx, clerkID)
}

func (s *Service) Register(ctx context.Context, clerkID, username string) (*User, error) {
	existing, err := s.usersDB.FindByClerkID(ctx, clerkID)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	u := &User{
		ClerkID:  &clerkID,
		Username: username,
	}
	if err := s.usersDB.Create(ctx, u); err != nil {
		if errors.Is(err, ErrAlreadyExists) {
			return nil, ErrAlreadyExists
		}
		return nil, err
	}
	return u, nil
}

func NewGuestCredential() (string, string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", fmt.Errorf("generate guest session credential: %w", err)
	}
	credential := base64.RawURLEncoding.EncodeToString(raw)
	return credential, HashGuestCredential(credential), nil
}

func HashGuestCredential(credential string) string {
	hash := sha256.Sum256([]byte(credential))
	return base64.RawURLEncoding.EncodeToString(hash[:])
}

func (s *Service) CreateGuestSession(ctx context.Context, tokenHash string, ttl time.Duration) (*User, error) {
	now := time.Now().UTC()
	u, err := s.usersDB.FindAndRefreshGuest(ctx, tokenHash, now, now.Add(ttl))
	if err == nil {
		return u, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	u, err = s.usersDB.CreateGuest(ctx, tokenHash, now, now.Add(ttl))
	if errors.Is(err, ErrAlreadyExists) {
		return s.usersDB.FindAndRefreshGuest(ctx, tokenHash, time.Now().UTC(), time.Now().UTC().Add(ttl))
	}
	return u, err
}

func (s *Service) ResolveGuestSession(ctx context.Context, credential string, ttl time.Duration) (*User, error) {
	if credential == "" {
		return nil, ErrNotFound
	}
	now := time.Now().UTC()
	return s.usersDB.FindAndRefreshGuest(ctx, HashGuestCredential(credential), now, now.Add(ttl))
}

func (s *Service) ClaimGuestSession(ctx context.Context, credential, clerkID, username string) (*User, bool, error) {
	if credential == "" {
		return nil, false, nil
	}
	return s.usersDB.ClaimGuest(ctx, HashGuestCredential(credential), clerkID, username, time.Now().UTC())
}

func (s *Service) CleanupExpiredGuests(ctx context.Context, limit int) (int, error) {
	if s.store == nil {
		return 0, fmt.Errorf("clean expired guest data: object store is not configured")
	}
	now := time.Now().UTC()
	guests, err := s.usersDB.ClaimExpiredGuests(ctx, now, limit)
	if err != nil {
		return 0, err
	}

	deleted := 0
	var failures []error
	for _, guest := range guests {
		if err := s.deleteGuestObjects(ctx, guest); err != nil {
			failures = append(failures, fmt.Errorf("delete objects for guest %s: %w", guest.UserID, err))
			if releaseErr := s.usersDB.ReleaseGuestCleanup(ctx, guest.UserID); releaseErr != nil {
				failures = append(failures, fmt.Errorf("release guest cleanup %s: %w", guest.UserID, releaseErr))
			}
			continue
		}
		if s.cleanupRooms != nil {
			if err := s.cleanupRooms(ctx, guest.UserID); err != nil {
				failures = append(failures, fmt.Errorf("close rooms for guest %s: %w", guest.UserID, err))
				if releaseErr := s.usersDB.ReleaseGuestCleanup(ctx, guest.UserID); releaseErr != nil {
					failures = append(failures, fmt.Errorf("release guest cleanup %s: %w", guest.UserID, releaseErr))
				}
				continue
			}
		}
		if err := s.usersDB.DeleteExpiredGuest(ctx, guest.UserID, now); err != nil {
			failures = append(failures, fmt.Errorf("delete expired guest %s: %w", guest.UserID, err))
			if releaseErr := s.usersDB.ReleaseGuestCleanup(ctx, guest.UserID); releaseErr != nil {
				failures = append(failures, fmt.Errorf("release guest cleanup %s: %w", guest.UserID, releaseErr))
			}
			continue
		}
		deleted++
	}
	return deleted, errors.Join(failures...)
}

func (s *Service) deleteGuestObjects(ctx context.Context, guest GuestObjectKeys) error {
	if len(guest.TrackObjectKeys) > 0 && s.analysisPrefix == "" {
		return fmt.Errorf("analysis object prefix is not configured")
	}
	for _, objectKey := range guest.TrackObjectKeys {
		if err := s.store.DeleteObject(ctx, objectKey); err != nil {
			return fmt.Errorf("delete track %q: %w", objectKey, err)
		}
		if err := s.store.DeleteObject(ctx, fmt.Sprintf("%s/%s.json", s.analysisPrefix, objectKey)); err != nil {
			return fmt.Errorf("delete track analysis for %q: %w", objectKey, err)
		}
	}
	for _, objectKey := range guest.RecordingObjectKeys {
		if err := s.store.DeleteObject(ctx, objectKey); err != nil {
			return fmt.Errorf("delete recording %q: %w", objectKey, err)
		}
	}
	return nil
}

func (s *Service) DeleteByClerkID(ctx context.Context, clerkID string) error {
	data, err := s.usersDB.AccountDataByClerkID(ctx, clerkID)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("load account data for deletion: %w", err)
	}
	if s.store == nil {
		return fmt.Errorf("delete account data: object store is not configured")
	}

	for _, objectKey := range data.TrackObjectKeys {
		if err := s.store.DeleteObject(ctx, objectKey); err != nil {
			return fmt.Errorf("delete account object %q: %w", objectKey, err)
		}
		if err := s.store.DeleteObject(ctx, fmt.Sprintf("%s/%s.json", s.analysisPrefix, objectKey)); err != nil {
			return fmt.Errorf("delete account analysis object for %q: %w", objectKey, err)
		}
	}
	for _, objectKey := range data.RecordingObjectKeys {
		if err := s.store.DeleteObject(ctx, objectKey); err != nil {
			return fmt.Errorf("delete account recording object %q: %w", objectKey, err)
		}
	}

	if err := s.usersDB.DeleteAccountData(ctx, data.UserID); err != nil {
		return fmt.Errorf("delete account database data: %w", err)
	}
	return nil
}
