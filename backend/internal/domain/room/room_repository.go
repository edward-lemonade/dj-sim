package room

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const codeAllocationAttempts = 8

type Repository struct {
	db        *gorm.DB
	mu        sync.RWMutex
	rooms     map[string]*Room
	members   map[string]map[string]Member
	codeIndex map[string]string
}

func NewRepository(db *gorm.DB) *Repository {
	if db == nil {
		return NewInMemoryRepository()
	}
	return &Repository{db: db}
}

func NewInMemoryRepository() *Repository {
	return &Repository{
		rooms:     make(map[string]*Room),
		members:   make(map[string]map[string]Member),
		codeIndex: make(map[string]string),
	}
}

func (r *Repository) Migrate(ctx context.Context) error {
	if r.db == nil {
		return nil
	}
	return r.db.WithContext(ctx).AutoMigrate(&Room{}, &Member{})
}

func (r *Repository) ListPublic(ctx context.Context) ([]ListedRoom, error) {
	if r.db != nil {
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

	r.mu.RLock()
	defer r.mu.RUnlock()
	ids := make([]string, 0, len(r.rooms))
	for id, room := range r.rooms {
		if room != nil && room.Status == StatusActive && room.Visibility == VisibilityPublic {
			ids = append(ids, id)
		}
	}
	sort.Slice(ids, func(i, j int) bool {
		left := r.rooms[ids[i]]
		right := r.rooms[ids[j]]
		if left.CreatedAt.Equal(right.CreatedAt) {
			return ids[i] < ids[j]
		}
		return left.CreatedAt.After(right.CreatedAt)
	})
	result := make([]ListedRoom, 0, len(ids))
	for _, id := range ids {
		item := *r.rooms[id]
		members := r.listMembersMemory(id)
		result = append(result, ToListed(item, members, len(members)))
	}
	return result, nil
}

func (r *Repository) CloseRoomsNoMembers(ctx context.Context) error {
	if r.db != nil {
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

	now := time.Now().UTC()
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, room := range r.rooms {
		if room == nil || room.Status != StatusActive {
			continue
		}
		if len(r.members[id]) == 0 {
			room.Status = StatusClosed
			room.ClosedAt = &now
			room.CodeHash = nil
			room.StreamID = nil
			for codeHash, roomID := range r.codeIndex {
				if roomID == id {
					delete(r.codeIndex, codeHash)
					break
				}
			}
		}
	}
	return nil
}

func (r *Repository) Get(ctx context.Context, roomID, userID string) (*ListedRoom, error) {
	if r.db != nil {
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

	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.rooms[roomID]
	if !ok || item == nil || item.Status != StatusActive {
		return nil, ErrUnavailable
	}
	if item.Visibility == VisibilityPrivate {
		if _, ok := r.members[roomID][userID]; !ok {
			return nil, ErrUnavailable
		}
	}
	listed := ToListed(*item, r.listMembersMemory(roomID), len(r.listMembersMemory(roomID)))
	return &listed, nil
}

func (r *Repository) GetMemberUserIDs(ctx context.Context, roomID string) ([]string, error) {
	if r.db != nil {
		var userIDs []string
		err := r.db.WithContext(ctx).
			Table("room_members").
			Where("room_id = ?", roomID).
			Pluck("user_id", &userIDs).Error
		return userIDs, err
	}

	r.mu.RLock()
	defer r.mu.RUnlock()
	members := r.members[roomID]
	ids := make([]string, 0, len(members))
	for userID := range members {
		ids = append(ids, userID)
	}
	sort.Strings(ids)
	return ids, nil
}

func (r *Repository) GetStreamID(ctx context.Context, roomID string) (string, error) {
	if r.db != nil {
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

	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.rooms[roomID]
	if !ok || item == nil || item.StreamID == nil {
		return "", nil
	}
	return *item.StreamID, nil
}

func (r *Repository) CreateWithCode(ctx context.Context, room *Room, creatorID, username, avatarURL string, pepper []byte) (string, error) {
	if r.db != nil {
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
	if creatorID == "" {
		return "", errors.New("room creator is required")
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

		r.mu.Lock()
		if _, exists := r.codeIndex[codeHash]; exists {
			r.mu.Unlock()
			continue
		}
		item := *room
		item.ID = stringsIfEmpty(item.ID, uuid.NewString())
		if _, exists := r.rooms[item.ID]; exists {
			item.ID = uuid.NewString()
		}
		if item.CreatedAt.IsZero() {
			item.CreatedAt = time.Now().UTC()
		}
		item.CreatorUserID = creatorID
		item.Status = StatusActive
		item.CodeHash = &codeHash
		item.Capacity = ensureCapacity(item.Capacity)
		if item.Visibility != VisibilityPublic && item.Visibility != VisibilityPrivate {
			r.mu.Unlock()
			return "", ErrInvalidVisibility
		}
		r.rooms[item.ID] = &item
		if r.members[item.ID] == nil {
			r.members[item.ID] = make(map[string]Member)
		}
		r.members[item.ID][creatorID] = Member{
			RoomID:    item.ID,
			UserID:    creatorID,
			Username:  username,
			AvatarURL: avatarURL,
			JoinedAt:  time.Now().UTC(),
		}
		r.codeIndex[codeHash] = item.ID
		*room = item
		r.mu.Unlock()
		return code, nil
	}
	return "", ErrCodeAllocation
}

func (r *Repository) JoinByCode(ctx context.Context, code, userID, username, avatarURL string, pepper []byte) (*JoinResult, error) {
	if r.db != nil {
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

	codeHash, err := HashJoinCode(code, pepper)
	if err != nil {
		return nil, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	roomID, ok := r.codeIndex[codeHash]
	if !ok {
		return nil, ErrUnavailable
	}
	item, ok := r.rooms[roomID]
	if !ok || item == nil || item.Status != StatusActive {
		delete(r.codeIndex, codeHash)
		return nil, ErrUnavailable
	}
	if item.Capacity <= 0 {
		item.Capacity = DefaultCapacity
	}
	members := r.members[roomID]
	if members == nil {
		members = make(map[string]Member)
		r.members[roomID] = members
	}
	if _, exists := members[userID]; exists {
		listed := ToListed(*item, r.listMembersMemory(roomID), len(members))
		return &JoinResult{Room: listed, AlreadyMember: true}, nil
	}
	if len(members) >= item.Capacity {
		return nil, ErrFull
	}
	members[userID] = Member{
		RoomID:    item.ID,
		UserID:    userID,
		Username:  username,
		AvatarURL: avatarURL,
		JoinedAt:  time.Now().UTC(),
	}
	listed := ToListed(*item, r.listMembersMemory(roomID), len(members))
	return &JoinResult{Room: listed, AlreadyMember: false}, nil
}

func (r *Repository) JoinPublic(ctx context.Context, roomID, userID, username, avatarURL string) (*JoinResult, error) {
	if r.db != nil {
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

	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.rooms[roomID]
	if !ok || item == nil || item.Status != StatusActive || item.Visibility != VisibilityPublic {
		return nil, ErrUnavailable
	}
	members := r.members[roomID]
	if members == nil {
		members = make(map[string]Member)
		r.members[roomID] = members
	}
	if _, exists := members[userID]; exists {
		listed := ToListed(*item, r.listMembersMemory(roomID), len(members))
		return &JoinResult{Room: listed, AlreadyMember: true}, nil
	}
	if len(members) >= item.Capacity {
		return nil, ErrFull
	}
	members[userID] = Member{
		RoomID:    item.ID,
		UserID:    userID,
		Username:  username,
		AvatarURL: avatarURL,
		JoinedAt:  time.Now().UTC(),
	}
	listed := ToListed(*item, r.listMembersMemory(roomID), len(members))
	return &JoinResult{Room: listed, AlreadyMember: false}, nil
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
	if r.db != nil {
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
			if item.CreatorUserID == userID || count == 0 {
				if item.CreatorUserID == userID {
					if err := tx.Where("room_id = ?", roomID).Delete(&Member{}).Error; err != nil {
						return err
					}
				}
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

	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.rooms[roomID]
	if !ok || item == nil {
		return &LeaveResult{}, nil
	}
	if item.Status != StatusActive {
		return &LeaveResult{RoomClosed: true}, nil
	}
	members := r.members[roomID]
	if members == nil {
		return &LeaveResult{}, nil
	}
	if _, exists := members[userID]; !exists {
		return &LeaveResult{}, nil
	}
	delete(members, userID)
	if item.CreatorUserID == userID || len(members) == 0 {
		now := time.Now().UTC()
		item.Status = StatusClosed
		item.ClosedAt = &now
		item.CodeHash = nil
		streamID := ""
		if item.StreamID != nil {
			streamID = *item.StreamID
			item.StreamID = nil
		}
		delete(r.members, roomID)
		for codeHash, roomIDMatch := range r.codeIndex {
			if roomIDMatch == roomID {
				delete(r.codeIndex, codeHash)
				break
			}
		}
		return &LeaveResult{RoomClosed: true, StreamID: streamID}, nil
	}
	return &LeaveResult{}, nil
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
	if r.db != nil {
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

	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.rooms[roomID]
	if !ok || item == nil || item.Status != StatusActive {
		return ErrUnavailable
	}
	if _, ok := r.members[roomID][userID]; !ok {
		return ErrUnavailable
	}
	if item.StreamID != nil && *item.StreamID != "" && *item.StreamID != streamID {
		return ErrAlreadyStreaming
	}
	item.StreamID = &streamID
	return nil
}

func (r *Repository) DetachStream(ctx context.Context, streamID string) error {
	if streamID == "" {
		return nil
	}
	if r.db != nil {
		return r.db.WithContext(ctx).Model(&Room{}).
			Where("stream_id = ?", streamID).
			Update("stream_id", nil).Error
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	for _, room := range r.rooms {
		if room != nil && room.StreamID != nil && *room.StreamID == streamID {
			room.StreamID = nil
		}
	}
	return nil
}

func (r *Repository) BroadcastsByStreamIDs(ctx context.Context, streamIDs []string) (map[string]BroadcastListing, error) {
	if r.db != nil {
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

	r.mu.RLock()
	defer r.mu.RUnlock()
	listings := make(map[string]BroadcastListing, len(streamIDs))
	for _, streamID := range streamIDs {
		for _, room := range r.rooms {
			if room == nil || room.Status != StatusActive || room.StreamID == nil || *room.StreamID != streamID {
				continue
			}
			listed := ToListed(*room, r.listMembersMemory(room.ID), len(r.listMembersMemory(room.ID)))
			listings[streamID] = BroadcastListing{
				StreamID:    streamID,
				ID:          listed.ID,
				Visibility:  listed.Visibility,
				Members:     listed.Members,
				MemberCount: listed.MemberCount,
				Capacity:    listed.Capacity,
			}
			break
		}
	}
	return listings, nil
}

func (r *Repository) CanControlStream(ctx context.Context, streamID, userID string) (bool, error) {
	if streamID == "" || userID == "" {
		return false, nil
	}
	if r.db != nil {
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

	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, room := range r.rooms {
		if room == nil || room.Status != StatusActive || room.StreamID == nil || *room.StreamID != streamID {
			continue
		}
		if _, ok := r.members[room.ID][userID]; ok {
			return true, nil
		}
		return false, nil
	}
	return false, nil
}

func (r *Repository) Close(ctx context.Context, id string) error {
	if r.db != nil {
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

	r.mu.Lock()
	defer r.mu.Unlock()
	room, ok := r.rooms[id]
	if !ok || room == nil || room.Status != StatusActive {
		return gorm.ErrRecordNotFound
	}
	now := time.Now().UTC()
	room.Status = StatusClosed
	room.ClosedAt = &now
	room.CodeHash = nil
	room.StreamID = nil
	delete(r.members, id)
	for codeHash, roomID := range r.codeIndex {
		if roomID == id {
			delete(r.codeIndex, codeHash)
			break
		}
	}
	return nil
}

func (r *Repository) listMembersMemory(roomID string) []ListedMember {
	members := make([]ListedMember, 0, len(r.members[roomID]))
	for _, member := range r.members[roomID] {
		members = append(members, ListedMember{UserID: member.UserID, Username: member.Username, AvatarURL: member.AvatarURL})
	}
	sort.Slice(members, func(i, j int) bool {
		return r.members[roomID][members[i].UserID].JoinedAt.Before(r.members[roomID][members[j].UserID].JoinedAt)
	})
	return members
}

func stringsIfEmpty(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func ensureCapacity(capacity int) int {
	if capacity == 0 {
		return DefaultCapacity
	}
	return capacity
}
