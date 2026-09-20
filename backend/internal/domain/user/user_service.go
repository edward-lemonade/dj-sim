package user

import (
	"context"
	"errors"
)

type Service struct {
	usersDB Repository
}

func NewService(users *Repository) *Service {
	return &Service{usersDB: *users}
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
