package track

import "context"

type Service struct {
	tracksDB Repository
}

func NewService(tracks *Repository) *Service {
	return &Service{tracksDB: *tracks}
}

func (s *Service) ListByUserID(ctx context.Context, userID string) ([]Track, error) {
	return s.tracksDB.ListByUserID(ctx, userID)
}

func (s *Service) Create(ctx context.Context, track *Track) error {
	return s.tracksDB.Create(ctx, track)
}

func (s *Service) GetByIDForUser(ctx context.Context, id, userID string) (*Track, error) {
	return s.tracksDB.FindByIDForUser(ctx, id, userID)
}

func (s *Service) Delete(ctx context.Context, id, userID string) error {
	return s.tracksDB.Delete(ctx, id, userID)
}
