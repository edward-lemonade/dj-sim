package room

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const codeAllocationAttempts = 8

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Migrate(ctx context.Context) error {
	return r.db.WithContext(ctx).AutoMigrate(&Room{}, &Member{})
}

func (r *Repository) ListPublic(ctx context.Context) ([]ListedRoom, error) {
	var rooms []Room
	if err := r.db.WithContext(ctx).
		Where("visibility = ? AND status = ?", VisibilityPublic, StatusActive).
		Order("created_at DESC").
		Find(&rooms).Error; err != nil {
		return nil, err
	}
	if len(rooms) == 0 {
		return []ListedRoom{}, nil
	}

	roomIDs := make([]string, len(rooms))
	for i := range rooms {
		roomIDs[i] = rooms[i].ID
	}
	type memberRow struct {
		RoomID    string
		UserID    string
		Username  string
		AvatarURL string
	}
	var rows []memberRow
	if err := r.db.WithContext(ctx).
		Table("room_members").
		Select("room_members.room_id, room_members.user_id, COALESCE(NULLIF(users.username, ''), room_members.username) AS username, room_members.avatar_url").
		Joins("LEFT JOIN users ON users.id = room_members.user_id").
		Where("room_members.room_id IN ?", roomIDs).
		Order("room_members.joined_at ASC").
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	membersByRoom := make(map[string][]ListedMember, len(rooms))
	countsByRoom := make(map[string]int, len(rooms))
	for _, row := range rows {
		membersByRoom[row.RoomID] = append(membersByRoom[row.RoomID], ListedMember{
			UserID: row.UserID, Username: row.Username, AvatarURL: row.AvatarURL,
		})
		countsByRoom[row.RoomID]++
	}

	result := make([]ListedRoom, 0, len(rooms))
	for _, item := range rooms {
		result = append(result, ToListed(item, membersByRoom[item.ID], countsByRoom[item.ID]))
	}
	return result, nil
}

func (r *Repository) CloseRoomsNoMembers(ctx context.Context) error {
	now := time.Now().UTC()
	result := r.db.WithContext(ctx).Model(&Room{}).
		Where("status = ? AND id NOT IN (SELECT DISTINCT room_id FROM room_members)", StatusActive).
		Updates(map[string]any{
			"status":    StatusClosed,
			"closed_at": now,
			"code_hash": nil,
		})
	return result.Error
}

func (r *Repository) Get(ctx context.Context, roomID, userID string) (*ListedRoom, error) {
	var item Room
	err := r.db.WithContext(ctx).
		Where("id = ? AND status = ?", roomID, StatusActive).
		First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrUnavailable
	}
	if err != nil {
		return nil, err
	}
	if item.Visibility == VisibilityPrivate {
		var member Member
		err := r.db.WithContext(ctx).Where("room_id = ? AND user_id = ?", roomID, userID).First(&member).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUnavailable
		}
		if err != nil {
			return nil, err
		}
	}
	listed, err := getListedRoom(r.db.WithContext(ctx), item)
	if err != nil {
		return nil, err
	}
	return &listed, nil
}

func (r *Repository) GetMemberUserIDs(ctx context.Context, roomID string) ([]string, error) {
	var userIDs []string
	err := r.db.WithContext(ctx).
		Table("room_members").
		Where("room_id = ?", roomID).
		Pluck("user_id", &userIDs).Error
	return userIDs, err
}

func (r *Repository) GetStreamID(ctx context.Context, roomID string) (string, error) {
	var item Room
	err := r.db.WithContext(ctx).
		Select("stream_id").
		Where("id = ?", roomID).
		First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if item.StreamID == nil {
		return "", nil
	}
	return *item.StreamID, nil
}

func (r *Repository) CreateWithCode(ctx context.Context, room *Room, creatorID, username, avatarURL string, pepper []byte) (string, error) {
	if creatorID == "" {
		return "", errors.New("room creator is required")
	}
	if _, err := HashJoinCode("000000", pepper); err != nil {
		return "", err
	}
	if err := room.prepare(); err != nil {
		return "", err
	}

	for range codeAllocationAttempts {
		code, err := GenerateJoinCode()
		if err != nil {
			return "", err
		}
		codeHash, err := HashJoinCode(code, pepper)
		if err != nil {
			return "", err
		}
		room.CodeHash = &codeHash
		room.CreatorUserID = creatorID
		room.Status = StatusActive

		err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := tx.Create(room).Error; err != nil {
				return err
			}
			return tx.Create(&Member{
				RoomID: room.ID, UserID: creatorID, Username: username, AvatarURL: avatarURL,
			}).Error
		})
		if err == nil {
			return code, nil
		}
		if !errors.Is(err, gorm.ErrDuplicatedKey) {
			return "", fmt.Errorf("create room and initial membership: %w", err)
		}
		room.ID = ""
		room.CodeHash = nil
	}

	return "", ErrCodeAllocation
}

func (r *Repository) JoinByCode(ctx context.Context, code, userID, username, avatarURL string, pepper []byte) (*JoinResult, error) {
	codeHash, err := HashJoinCode(code, pepper)
	if err != nil {
		return nil, err
	}
	return r.join(ctx, userID, username, avatarURL, func(tx *gorm.DB) (*Room, error) {
		var item Room
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("code_hash = ? AND status = ?", codeHash, StatusActive).
			First(&item).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUnavailable
		}
		if err != nil {
			return nil, err
		}
		return &item, nil
	})
}

func (r *Repository) JoinPublic(ctx context.Context, roomID, userID, username, avatarURL string) (*JoinResult, error) {
	return r.join(ctx, userID, username, avatarURL, func(tx *gorm.DB) (*Room, error) {
		var item Room
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND visibility = ? AND status = ?", roomID, VisibilityPublic, StatusActive).
			First(&item).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUnavailable
		}
		if err != nil {
			return nil, err
		}
		return &item, nil
	})
}

func (r *Repository) join(
	ctx context.Context,
	userID, username, avatarURL string,
	findRoom func(*gorm.DB) (*Room, error),
) (*JoinResult, error) {
	if userID == "" {
		return nil, errors.New("room member is required")
	}
	var result JoinResult
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		item, err := findRoom(tx)
		if err != nil {
			return err
		}

		var existing Member
		err = tx.Where("room_id = ? AND user_id = ?", item.ID, userID).First(&existing).Error
		alreadyMember := err == nil
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if !alreadyMember {
			var count int64
			if err := tx.Model(&Member{}).Where("room_id = ?", item.ID).Count(&count).Error; err != nil {
				return err
			}
			if count >= int64(item.Capacity) {
				return ErrFull
			}
			if err := tx.Create(&Member{
				RoomID: item.ID, UserID: userID, Username: username, AvatarURL: avatarURL,
			}).Error; err != nil {
				return err
			}
		}
		listed, err := getListedRoom(tx, *item)
		if err != nil {
			return err
		}
		result = JoinResult{Room: listed, AlreadyMember: alreadyMember}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("join room: %w", err)
	}
	return &result, nil
}

func (r *Repository) Leave(ctx context.Context, roomID, userID string) (*LeaveResult, error) {
	result := &LeaveResult{}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var item Room
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", roomID).
			First(&item).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrUnavailable
		}
		if err != nil {
			return err
		}
		if item.Status != StatusActive {
			result.RoomClosed = true
			return nil
		}

		deleted := tx.Where("room_id = ? AND user_id = ?", roomID, userID).Delete(&Member{})
		if deleted.Error != nil {
			return deleted.Error
		}

		var count int64
		if err := tx.Model(&Member{}).Where("room_id = ?", roomID).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			now := time.Now().UTC()
			if err := tx.Model(&Room{}).Where("id = ?", roomID).Updates(map[string]any{
				"status": StatusClosed, "closed_at": now, "code_hash": nil, "stream_id": nil,
			}).Error; err != nil {
				return err
			}
			result.RoomClosed = true
			if item.StreamID != nil {
				result.StreamID = *item.StreamID
			}
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("leave room: %w", err)
	}
	return result, nil
}

func getListedRoom(tx *gorm.DB, item Room) (ListedRoom, error) {
	type memberRow struct {
		RoomID    string
		UserID    string
		Username  string
		AvatarURL string
	}
	var rows []memberRow
	if err := tx.Table("room_members").
		Select("room_members.room_id, room_members.user_id, COALESCE(NULLIF(users.username, ''), room_members.username) AS username, room_members.avatar_url").
		Joins("LEFT JOIN users ON users.id = room_members.user_id").
		Where("room_members.room_id = ?", item.ID).
		Order("room_members.joined_at ASC").
		Scan(&rows).Error; err != nil {
		return ListedRoom{}, err
	}
	members := make([]ListedMember, 0, len(rows))
	for _, row := range rows {
		members = append(members, ListedMember{UserID: row.UserID, Username: row.Username, AvatarURL: row.AvatarURL})
	}
	return ToListed(item, members, len(members)), nil
}

func (r *Repository) AssociateStream(ctx context.Context, roomID, userID, streamID string) error {
	if roomID == "" || userID == "" || streamID == "" {
		return errors.New("room stream association is required")
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var item Room
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND status = ?", roomID, StatusActive).
			First(&item).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrUnavailable
		}
		if err != nil {
			return err
		}
		var member Member
		err = tx.Where("room_id = ? AND user_id = ?", roomID, userID).First(&member).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrUnavailable
		}
		if err != nil {
			return err
		}
		if item.StreamID != nil && *item.StreamID != "" && *item.StreamID != streamID {
			return ErrAlreadyStreaming
		}
		return tx.Model(&Room{}).Where("id = ?", roomID).Update("stream_id", streamID).Error
	})
}

func (r *Repository) DetachStream(ctx context.Context, streamID string) error {
	if streamID == "" {
		return nil
	}
	return r.db.WithContext(ctx).Model(&Room{}).
		Where("stream_id = ?", streamID).
		Update("stream_id", nil).Error
}

func (r *Repository) BroadcastsByStreamIDs(ctx context.Context, streamIDs []string) (map[string]BroadcastListing, error) {
	listings := map[string]BroadcastListing{}
	if len(streamIDs) == 0 {
		return listings, nil
	}
	var rooms []Room
	if err := r.db.WithContext(ctx).
		Where("stream_id IN ? AND status = ?", streamIDs, StatusActive).
		Find(&rooms).Error; err != nil {
		return nil, err
	}
	for _, item := range rooms {
		if item.StreamID == nil {
			continue
		}
		listed, err := getListedRoom(r.db.WithContext(ctx), item)
		if err != nil {
			return nil, err
		}
		listings[*item.StreamID] = BroadcastListing{
			StreamID: *item.StreamID, ID: listed.ID, Visibility: listed.Visibility,
			Members: listed.Members, MemberCount: listed.MemberCount, Capacity: listed.Capacity,
		}
	}
	return listings, nil
}

func (r *Repository) CanControlStream(ctx context.Context, streamID, userID string) (bool, error) {
	if streamID == "" || userID == "" {
		return false, nil
	}
	var item Room
	err := r.db.WithContext(ctx).
		Where("stream_id = ? AND status = ?", streamID, StatusActive).
		First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var member Member
	err = r.db.WithContext(ctx).Where("room_id = ? AND user_id = ?", item.ID, userID).First(&member).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func (r *Repository) Close(ctx context.Context, id string) error {
	now := time.Now().UTC()
	result := r.db.WithContext(ctx).Model(&Room{}).
		Where("id = ? AND status = ?", id, StatusActive).
		Updates(map[string]any{
			"status":    StatusClosed,
			"closed_at": now,
			"code_hash": nil,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
