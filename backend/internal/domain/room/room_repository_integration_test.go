package room

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	dsn := "postgres://postgres:postgres@localhost:5432/dj_sim_test?sslmode=disable"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Skipf("Skipping integration test: cannot connect to test database: %v", err)
	}

	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(25)
	sqlDB.SetMaxIdleConns(25)
	sqlDB.SetConnMaxLifetime(5 * time.Minute)

	if err := db.AutoMigrate(&Room{}, &Member{}); err != nil {
		t.Fatalf("Migration failed: %v", err)
	}

	if err := db.Exec("TRUNCATE TABLE rooms, room_members CASCADE").Error; err != nil {
		t.Fatalf("Cleanup failed: %v", err)
	}

	return db
}

func TestRepositoryConcurrentCodeAllocation(t *testing.T) {
	db := setupTestDB(t)
	repo := NewRepository(db)
	pepper := []byte("0123456789abcdef0123456789abcdef")

	const numGoroutines = 20
	var wg sync.WaitGroup
	createdCodes := make(chan string, numGoroutines)
	errors := make(chan error, numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(userID string) {
			defer wg.Done()
			room := &Room{
				CreatorUserID: userID,
				Visibility:    VisibilityPublic,
				Capacity:      DefaultCapacity,
				Status:        StatusActive,
			}
			code, err := repo.CreateWithCode(context.Background(), room, userID, "user", "", pepper)
			if err != nil {
				errors <- err
				return
			}
			createdCodes <- code
		}("user-" + string(rune('a'+i)))
	}

	wg.Wait()
	close(createdCodes)
	close(errors)

	for err := range errors {
		t.Errorf("CreateWithCode error: %v", err)
	}

	codes := make(map[string]bool)
	for code := range createdCodes {
		if codes[code] {
			t.Errorf("Duplicate code allocated: %s", code)
		}
		codes[code] = true
	}

	if len(codes) != numGoroutines {
		t.Errorf("Expected %d unique codes, got %d", numGoroutines, len(codes))
	}
}

func TestRepositoryCollisionRetry(t *testing.T) {
	db := setupTestDB(t)
	repo := NewRepository(db)
	pepper := []byte("0123456789abcdef0123456789abcdef")

	hash, _ := HashJoinCode("000000", pepper)

	existingRoom := &Room{
		CreatorUserID: "user-1",
		Visibility:    VisibilityPublic,
		Capacity:      DefaultCapacity,
		Status:        StatusActive,
		CodeHash:      &hash,
	}
	db.Create(existingRoom)

	room := &Room{
		CreatorUserID: "user-2",
		Visibility:    VisibilityPublic,
		Capacity:      DefaultCapacity,
		Status:        StatusActive,
	}

	code, err := repo.CreateWithCode(context.Background(), room, "user-2", "user", "", pepper)
	if err != nil {
		t.Fatalf("CreateWithCode failed after collision: %v", err)
	}
	if code == "000000" {
		t.Error("CreateWithCode returned the colliding code")
	}
	if code == "" {
		t.Error("CreateWithCode returned empty code")
	}
}

func TestRepositoryAtomicCreatorMembership(t *testing.T) {
	db := setupTestDB(t)
	repo := NewRepository(db)
	pepper := []byte("0123456789abcdef0123456789abcdef")

	room := &Room{
		CreatorUserID: "user-1",
		Visibility:    VisibilityPublic,
		Capacity:      DefaultCapacity,
		Status:        StatusActive,
	}

	code, err := repo.CreateWithCode(context.Background(), room, "user-1", "creator", "", pepper)
	if err != nil {
		t.Fatalf("CreateWithCode error: %v", err)
	}

	var memberCount int64
	db.Model(&Member{}).Where("room_id = ?", room.ID).Count(&memberCount)
	if memberCount != 1 {
		t.Errorf("Expected 1 member after creation, got %d", memberCount)
	}

	var member Member
	if err := db.Where("room_id = ? AND user_id = ?", room.ID, "user-1").First(&member).Error; err != nil {
		t.Errorf("Creator not found as member: %v", err)
	}
	if member.Username != "creator" {
		t.Errorf("Member username = %q, want creator", member.Username)
	}

	if code == "" {
		t.Error("CreateWithCode returned empty code")
	}
}

func TestRepositoryCodeReuseAfterClosure(t *testing.T) {
	db := setupTestDB(t)
	repo := NewRepository(db)
	pepper := []byte("0123456789abcdef0123456789abcdef")

	room1 := &Room{
		CreatorUserID: "user-1",
		Visibility:    VisibilityPublic,
		Capacity:      DefaultCapacity,
		Status:        StatusActive,
	}
	code1, err := repo.CreateWithCode(context.Background(), room1, "user-1", "user", "", pepper)
	if err != nil {
		t.Fatalf("First CreateWithCode error: %v", err)
	}

	result, err := repo.Leave(context.Background(), room1.ID, "user-1")
	if err != nil {
		t.Fatalf("Leave error: %v", err)
	}
	if !result.RoomClosed {
		t.Error("Room should be closed after last member leaves")
	}

	room2 := &Room{
		CreatorUserID: "user-2",
		Visibility:    VisibilityPublic,
		Capacity:      DefaultCapacity,
		Status:        StatusActive,
	}
	code2, err := repo.CreateWithCode(context.Background(), room2, "user-2", "user", "", pepper)
	if err != nil {
		t.Fatalf("Second CreateWithCode error: %v", err)
	}

	if code1 == code2 {
		t.Error("Code should be reusable after room closure")
	}
}

func TestRepositoryConcurrentJoins(t *testing.T) {
	db := setupTestDB(t)
	repo := NewRepository(db)
	pepper := []byte("0123456789abcdef0123456789abcdef")

	room := &Room{
		CreatorUserID: "user-1",
		Visibility:    VisibilityPublic,
		Capacity:      2,
		Status:        StatusActive,
	}
	code, err := repo.CreateWithCode(context.Background(), room, "user-1", "creator", "", pepper)
	if err != nil {
		t.Fatalf("CreateWithCode error: %v", err)
	}

	const numGoroutines = 10
	var wg sync.WaitGroup
	successCount := 0
	var mu sync.Mutex

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(userID string) {
			defer wg.Done()
			_, err := repo.JoinByCode(context.Background(), code, userID, "user", "", pepper)
			if err == nil {
				mu.Lock()
				successCount++
				mu.Unlock()
			}
		}("user-" + string(rune('a'+i)))
	}

	wg.Wait()

	if successCount != 2 {
		t.Errorf("Expected 2 successful joins, got %d", successCount)
	}

	var memberCount int64
	db.Model(&Member{}).Where("room_id = ?", room.ID).Count(&memberCount)
	if memberCount != 2 {
		t.Errorf("Expected 2 members in database, got %d", memberCount)
	}
}

func TestRepositoryCapacityEnforcement(t *testing.T) {
	db := setupTestDB(t)
	repo := NewRepository(db)
	pepper := []byte("0123456789abcdef0123456789abcdef")

	room := &Room{
		CreatorUserID: "user-1",
		Visibility:    VisibilityPublic,
		Capacity:      2,
		Status:        StatusActive,
	}
	code, err := repo.CreateWithCode(context.Background(), room, "user-1", "creator", "", pepper)
	if err != nil {
		t.Fatalf("CreateWithCode error: %v", err)
	}

	_, err = repo.JoinByCode(context.Background(), code, "user-2", "user2", "", pepper)
	if err != nil {
		t.Fatalf("First join failed: %v", err)
	}

	_, err = repo.JoinByCode(context.Background(), code, "user-3", "user3", "", pepper)
	if !errors.Is(err, ErrFull) {
		t.Errorf("Third join should fail with ErrFull, got: %v", err)
	}
}

func TestRepositorySameUserMultiTab(t *testing.T) {
	db := setupTestDB(t)
	repo := NewRepository(db)
	pepper := []byte("0123456789abcdef0123456789abcdef")

	room := &Room{
		CreatorUserID: "user-1",
		Visibility:    VisibilityPublic,
		Capacity:      2,
		Status:        StatusActive,
	}
	code, err := repo.CreateWithCode(context.Background(), room, "user-1", "creator", "", pepper)
	if err != nil {
		t.Fatalf("CreateWithCode error: %v", err)
	}

	result1, err := repo.JoinByCode(context.Background(), code, "user-1", "creator", "", pepper)
	if err != nil {
		t.Fatalf("First join failed: %v", err)
	}
	if !result1.AlreadyMember {
		t.Error("Creator should be marked as already member")
	}

	result2, err := repo.JoinByCode(context.Background(), code, "user-1", "creator", "", pepper)
	if err != nil {
		t.Fatalf("Second join failed: %v", err)
	}
	if !result2.AlreadyMember {
		t.Error("Second join should also mark as already member")
	}

	var memberCount int64
	db.Model(&Member{}).Where("room_id = ?", room.ID).Count(&memberCount)
	if memberCount != 1 {
		t.Errorf("Expected 1 member despite multiple joins, got %d", memberCount)
	}
}

func TestRepositoryCreatorLeaveClosesOccupiedRoom(t *testing.T) {
	db := setupTestDB(t)
	repo := NewRepository(db)
	pepper := []byte("0123456789abcdef0123456789abcdef")

	room := &Room{
		CreatorUserID: "user-1",
		Visibility:    VisibilityPublic,
		Capacity:      2,
		Status:        StatusActive,
	}
	code, err := repo.CreateWithCode(context.Background(), room, "user-1", "creator", "", pepper)
	if err != nil {
		t.Fatalf("CreateWithCode error: %v", err)
	}

	_, err = repo.JoinByCode(context.Background(), code, "user-2", "user2", "", pepper)
	if err != nil {
		t.Fatalf("Join failed: %v", err)
	}

	result, err := repo.Leave(context.Background(), room.ID, "user-1")
	if err != nil {
		t.Fatalf("Leave error: %v", err)
	}
	if !result.RoomClosed {
		t.Error("Room should close when creator leaves with other members")
	}

	var checkRoom Room
	if err := db.Where("id = ?", room.ID).First(&checkRoom).Error; err != nil {
		t.Errorf("Room should still exist: %v", err)
	}
	if checkRoom.Status != StatusClosed {
		t.Errorf("Room status = %q, want closed", checkRoom.Status)
	}
	var memberCount int64
	if err := db.Model(&Member{}).Where("room_id = ?", room.ID).Count(&memberCount).Error; err != nil {
		t.Fatal(err)
	}
	if memberCount != 0 {
		t.Errorf("room has %d remaining members, want 0", memberCount)
	}
}

func TestRepositoryLastMemberClosesRoom(t *testing.T) {
	db := setupTestDB(t)
	repo := NewRepository(db)
	pepper := []byte("0123456789abcdef0123456789abcdef")

	room := &Room{
		CreatorUserID: "user-1",
		Visibility:    VisibilityPublic,
		Capacity:      2,
		Status:        StatusActive,
	}
	code, err := repo.CreateWithCode(context.Background(), room, "user-1", "creator", "", pepper)
	if err != nil {
		t.Fatalf("CreateWithCode error: %v", err)
	}

	_, err = repo.JoinByCode(context.Background(), code, "user-2", "user2", "", pepper)
	if err != nil {
		t.Fatalf("Join failed: %v", err)
	}

	_, err = repo.Leave(context.Background(), room.ID, "user-1")
	if err != nil {
		t.Fatalf("First leave error: %v", err)
	}

	result, err := repo.Leave(context.Background(), room.ID, "user-2")
	if err != nil {
		t.Fatalf("Second leave error: %v", err)
	}
	if !result.RoomClosed {
		t.Error("Room should close when last member leaves")
	}

	var checkRoom Room
	err = db.Where("id = ?", room.ID).First(&checkRoom).Error
	if err == nil {
		t.Error("Room should be closed and not queryable as active")
	}
}

func TestRepositoryStaleCodeJoin(t *testing.T) {
	db := setupTestDB(t)
	repo := NewRepository(db)
	pepper := []byte("0123456789abcdef0123456789abcdef")

	room := &Room{
		CreatorUserID: "user-1",
		Visibility:    VisibilityPublic,
		Capacity:      2,
		Status:        StatusActive,
	}
	code, err := repo.CreateWithCode(context.Background(), room, "user-1", "creator", "", pepper)
	if err != nil {
		t.Fatalf("CreateWithCode error: %v", err)
	}

	_, err = repo.Leave(context.Background(), room.ID, "user-1")
	if err != nil {
		t.Fatalf("Leave error: %v", err)
	}

	_, err = repo.JoinByCode(context.Background(), code, "user-2", "user2", "", pepper)
	if !errors.Is(err, ErrUnavailable) {
		t.Errorf("Join with stale code should fail with ErrUnavailable, got: %v", err)
	}
}
