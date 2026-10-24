package user

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

type Service struct {
	usersDB        Repository
	store          AccountObjectStore
	analysisPrefix string
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
		ClerkID:  clerkID,
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
