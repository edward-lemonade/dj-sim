package room

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/edward-lemonade/dj-sim-backend/internal/domain/track"
	"github.com/edward-lemonade/dj-sim-backend/internal/storage"
)

type roomRepositoryStub struct {
	create           func(context.Context, *Room, string, string, string, []byte) (string, error)
	list             func(context.Context) ([]ListedRoom, error)
	get              func(context.Context, string, string) (*ListedRoom, error)
	getMemberUserIDs func(context.Context, string) ([]string, error)
	getStreamID      func(context.Context, string) (string, error)
	joinByCode       func(context.Context, string, string, string, string, []byte) (*JoinResult, error)
	joinPublic       func(context.Context, string, string, string, string) (*JoinResult, error)
	leave            func(context.Context, string, string) (*LeaveResult, error)
	associate        func(context.Context, string, string, string) error
	detach           func(context.Context, string) error
	broadcasts       func(context.Context, []string) (map[string]BroadcastListing, error)
	canControl       func(context.Context, string, string) (bool, error)
	closeNoMembers   func(context.Context) error
}

func (r roomRepositoryStub) CreateWithCode(ctx context.Context, item *Room, creatorID, username, avatarURL string, pepper []byte) (string, error) {
	return r.create(ctx, item, creatorID, username, avatarURL, pepper)
}

func (r roomRepositoryStub) ListPublic(ctx context.Context) ([]ListedRoom, error) {
	return r.list(ctx)
}

func (r roomRepositoryStub) Get(ctx context.Context, roomID, userID string) (*ListedRoom, error) {
	return r.get(ctx, roomID, userID)
}

func (r roomRepositoryStub) GetMemberUserIDs(ctx context.Context, roomID string) ([]string, error) {
	if r.getMemberUserIDs == nil {
		return []string{}, nil
	}
	return r.getMemberUserIDs(ctx, roomID)
}

func (r roomRepositoryStub) JoinByCode(ctx context.Context, code, userID, username, avatarURL string, pepper []byte) (*JoinResult, error) {
	return r.joinByCode(ctx, code, userID, username, avatarURL, pepper)
}

func (r roomRepositoryStub) JoinPublic(ctx context.Context, roomID, userID, username, avatarURL string) (*JoinResult, error) {
	return r.joinPublic(ctx, roomID, userID, username, avatarURL)
}

func (r roomRepositoryStub) Leave(ctx context.Context, roomID, userID string) (*LeaveResult, error) {
	return r.leave(ctx, roomID, userID)
}

func (r roomRepositoryStub) AssociateStream(ctx context.Context, roomID, userID, streamID string) error {
	if r.associate == nil {
		return nil
	}
	return r.associate(ctx, roomID, userID, streamID)
}

func (r roomRepositoryStub) DetachStream(ctx context.Context, streamID string) error {
	if r.detach == nil {
		return nil
	}
	return r.detach(ctx, streamID)
}

func (r roomRepositoryStub) BroadcastsByStreamIDs(ctx context.Context, streamIDs []string) (map[string]BroadcastListing, error) {
	if r.broadcasts == nil {
		return map[string]BroadcastListing{}, nil
	}
	return r.broadcasts(ctx, streamIDs)
}

func (r roomRepositoryStub) CanControlStream(ctx context.Context, streamID, userID string) (bool, error) {
	if r.canControl == nil {
		return false, nil
	}
	return r.canControl(ctx, streamID, userID)
}

func (r roomRepositoryStub) GetStreamID(ctx context.Context, roomID string) (string, error) {
	if r.getStreamID == nil {
		return "", nil
	}
	return r.getStreamID(ctx, roomID)
}

func (r roomRepositoryStub) CloseRoomsNoMembers(ctx context.Context) error {
	if r.closeNoMembers == nil {
		return nil
	}
	return r.closeNoMembers(ctx)
}

func newRoomRepositoryStub() roomRepositoryStub {
	return roomRepositoryStub{
		create:           func(context.Context, *Room, string, string, string, []byte) (string, error) { return "", nil },
		list:             func(context.Context) ([]ListedRoom, error) { return []ListedRoom{}, nil },
		get:              func(context.Context, string, string) (*ListedRoom, error) { return &ListedRoom{}, nil },
		getMemberUserIDs: func(context.Context, string) ([]string, error) { return []string{}, nil },
		getStreamID:      func(context.Context, string) (string, error) { return "", nil },
		joinByCode: func(context.Context, string, string, string, string, []byte) (*JoinResult, error) {
			return &JoinResult{Room: ListedRoom{ID: "room-1"}}, nil
		},
		joinPublic: func(context.Context, string, string, string, string) (*JoinResult, error) {
			return &JoinResult{Room: ListedRoom{ID: "room-1"}}, nil
		},
		leave: func(context.Context, string, string) (*LeaveResult, error) { return &LeaveResult{}, nil },
	}
}

func TestServiceCreate(t *testing.T) {
	pepper := []byte("0123456789abcdef0123456789abcdef")
	repository := newRoomRepositoryStub()
	repository.create = func(_ context.Context, item *Room, creatorID, username, avatarURL string, gotPepper []byte) (string, error) {
		if creatorID != "user-1" {
			t.Errorf("creatorID = %q, want user-1", creatorID)
		}
		if username != "dj" {
			t.Errorf("username = %q, want dj", username)
		}
		if item.Visibility != VisibilityPublic {
			t.Errorf("visibility = %q, want public", item.Visibility)
		}
		if item.Capacity != DefaultCapacity {
			t.Errorf("capacity = %d, want %d", item.Capacity, DefaultCapacity)
		}
		if string(gotPepper) != string(pepper) {
			t.Error("repository received different room-code pepper")
		}
		item.ID = "room-1"
		return "000042", nil
	}

	created, err := NewService(repository, pepper).Create(context.Background(), "user-1", "dj", "", VisibilityPublic)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if created.ID != "room-1" || created.Code != "000042" || created.Status != StatusActive {
		t.Errorf("Create() = %+v, unexpected room response", created)
	}
	if created.EventURL != "/rooms/room-1/events" || created.EventTicket == "" {
		t.Errorf("Create() relay credentials = (%q, %q), want room URL and non-empty ticket", created.EventURL, created.EventTicket)
	}
}

func TestServiceCreateRejectsInvalidVisibility(t *testing.T) {
	called := false
	repository := newRoomRepositoryStub()
	repository.create = func(context.Context, *Room, string, string, string, []byte) (string, error) {
		called = true
		return "", nil
	}
	_, err := NewService(repository, []byte("0123456789abcdef0123456789abcdef")).
		Create(context.Background(), "user-1", "dj", "", "unlisted")
	if !errors.Is(err, ErrInvalidVisibility) {
		t.Errorf("Create() error = %v, want ErrInvalidVisibility", err)
	}
	if called {
		t.Error("Create() called repository for invalid visibility")
	}
}

func TestServiceCreateRequiresPepper(t *testing.T) {
	called := false
	repository := newRoomRepositoryStub()
	repository.create = func(context.Context, *Room, string, string, string, []byte) (string, error) {
		called = true
		return "", nil
	}
	_, err := NewService(repository, nil).Create(context.Background(), "user-1", "dj", "", VisibilityPrivate)
	if !errors.Is(err, ErrCodeConfig) {
		t.Errorf("Create() error = %v, want ErrCodeConfig", err)
	}
	if called {
		t.Error("Create() called repository without a pepper")
	}
}

func TestServiceListPublic(t *testing.T) {
	want := []ListedRoom{{ID: "room-1", Members: []ListedMember{{Username: "dj"}}, MemberCount: 1, Capacity: 2}}
	repository := newRoomRepositoryStub()
	repository.list = func(context.Context) ([]ListedRoom, error) { return want, nil }
	got, err := NewService(repository, nil).ListPublic(context.Background())
	if err != nil {
		t.Fatalf("ListPublic() error = %v", err)
	}
	if len(got) != 1 || got[0].ID != want[0].ID || got[0].MemberCount != 1 {
		t.Errorf("ListPublic() = %+v, want %+v", got, want)
	}
}

func TestServiceGetRequiresUser(t *testing.T) {
	repository := newRoomRepositoryStub()
	called := false
	repository.get = func(context.Context, string, string) (*ListedRoom, error) {
		called = true
		return nil, nil
	}
	_, err := NewService(repository, nil).Get(context.Background(), "room-1", "")
	if err == nil {
		t.Error("Get() without user should fail")
	}
	if called {
		t.Error("Get() called repository without user")
	}
}

func TestServiceJoinByCodeRequiresPepper(t *testing.T) {
	repository := newRoomRepositoryStub()
	called := false
	repository.joinByCode = func(context.Context, string, string, string, string, []byte) (*JoinResult, error) {
		called = true
		return nil, nil
	}
	_, err := NewService(repository, nil).JoinByCode(context.Background(), "123456", "user-1", "dj", "")
	if !errors.Is(err, ErrCodeConfig) {
		t.Errorf("JoinByCode() error = %v, want ErrCodeConfig", err)
	}
	if called {
		t.Error("JoinByCode() called repository without pepper")
	}
}

func TestServiceJoinByCodeRejectsInvalidCodeBeforeRepository(t *testing.T) {
	repository := newRoomRepositoryStub()
	called := false
	repository.joinByCode = func(context.Context, string, string, string, string, []byte) (*JoinResult, error) {
		called = true
		return nil, nil
	}
	service := NewService(repository, []byte("0123456789abcdef0123456789abcdef"))
	_, err := service.JoinByCode(context.Background(), "12 456", "user-1", "dj", "")
	if !errors.Is(err, ErrInvalidJoinCode) {
		t.Errorf("JoinByCode() error = %v, want ErrInvalidJoinCode", err)
	}
	if called {
		t.Error("JoinByCode() called repository for invalid code")
	}
}

func TestServiceJoinByCode(t *testing.T) {
	pepper := []byte("0123456789abcdef0123456789abcdef")
	repository := newRoomRepositoryStub()
	called := false
	repository.joinByCode = func(_ context.Context, code, userID, username, avatarURL string, gotPepper []byte) (*JoinResult, error) {
		called = true
		if code != "000042" || userID != "user-2" || username != "dj2" || avatarURL != "https://example.com/avatar.png" {
			t.Errorf("JoinByCode args = (%q, %q, %q, %q)", code, userID, username, avatarURL)
		}
		if string(gotPepper) != string(pepper) {
			t.Error("JoinByCode received a different pepper")
		}
		return &JoinResult{Room: ListedRoom{ID: "room-1"}, AlreadyMember: true}, nil
	}

	joined, err := NewService(repository, pepper).JoinByCode(
		context.Background(), "000042", "user-2", "dj2", " https://example.com/avatar.png ",
	)
	if err != nil {
		t.Fatalf("JoinByCode() error = %v", err)
	}
	if !called || !joined.AlreadyMember {
		t.Errorf("JoinByCode() = %+v, repository called = %t", joined, called)
	}
	if joined.EventURL != "/rooms/room-1/events" || joined.EventTicket == "" {
		t.Errorf("JoinByCode() relay credentials = (%q, %q), want room URL and non-empty ticket", joined.EventURL, joined.EventTicket)
	}
	if joined.Code != "000042" {
		t.Errorf("JoinByCode() code = %q, want the invite code used to join", joined.Code)
	}
}

func TestServiceJoinPublicReturnsRememberedInviteCode(t *testing.T) {
	pepper := []byte("0123456789abcdef0123456789abcdef")
	repository := newRoomRepositoryStub()
	repository.joinByCode = func(context.Context, string, string, string, string, []byte) (*JoinResult, error) {
		return &JoinResult{Room: ListedRoom{ID: "room-1"}}, nil
	}
	repository.joinPublic = func(context.Context, string, string, string, string) (*JoinResult, error) {
		return &JoinResult{Room: ListedRoom{ID: "room-1", Visibility: VisibilityPublic}}, nil
	}
	service := NewService(repository, pepper)
	if _, err := service.JoinByCode(context.Background(), "000042", "user-2", "dj2", ""); err != nil {
		t.Fatalf("JoinByCode() error = %v", err)
	}
	joined, err := service.JoinPublic(context.Background(), "room-1", "user-3", "dj3", "")
	if err != nil {
		t.Fatalf("JoinPublic() error = %v", err)
	}
	if joined.Code != "000042" {
		t.Errorf("JoinPublic() code = %q, want remembered invite code", joined.Code)
	}
}

func TestServiceJoinPublicRejectsInvalidAvatar(t *testing.T) {
	repository := newRoomRepositoryStub()
	called := false
	repository.joinPublic = func(context.Context, string, string, string, string) (*JoinResult, error) {
		called = true
		return nil, nil
	}
	_, err := NewService(repository, nil).JoinPublic(
		context.Background(), "room-1", "user-2", "dj2", "http://example.com/avatar.png",
	)
	if !errors.Is(err, ErrInvalidAvatar) {
		t.Errorf("JoinPublic() error = %v, want ErrInvalidAvatar", err)
	}
	if called {
		t.Error("JoinPublic() called repository with an invalid avatar URL")
	}
}

func TestServiceLeave(t *testing.T) {
	manager := NewRoomManager()
	manager.Ensure("room-1", "user-1")
	var events []RoomEvent
	closed := false
	_, err := manager.Attach("room-1", RoomParticipant{
		UserID: "user-2", ConnectionID: "connection-2",
		Send: func(event RoomEvent) error {
			events = append(events, event)
			return nil
		},
		Close: func() { closed = true },
	})
	if err != nil {
		t.Fatal(err)
	}
	repository := newRoomRepositoryStub()
	repository.leave = func(_ context.Context, roomID, userID string) (*LeaveResult, error) {
		if roomID != "room-1" || userID != "user-1" {
			t.Errorf("Leave() args = (%q, %q)", roomID, userID)
		}
		return &LeaveResult{RoomClosed: true}, nil
	}
	result, err := NewService(repository, nil, manager).Leave(context.Background(), "room-1", "user-1")
	if err != nil {
		t.Fatalf("Leave() error = %v", err)
	}
	if !result.RoomClosed {
		t.Errorf("Leave() = %+v, want closed room", result)
	}
	if len(events) < 2 || events[len(events)-1].Type != "closed" || !closed {
		t.Errorf("room close did not notify and disconnect participants: events=%+v closed=%v", events, closed)
	}
}

func TestInMemoryRepositoryOwnerLeaveClosesOccupiedRoom(t *testing.T) {
	ctx := context.Background()
	pepper := []byte("0123456789abcdef0123456789abcdef")
	repository := NewInMemoryRepository()
	item := &Room{CreatorUserID: "owner", Visibility: VisibilityPublic, Capacity: 2}
	code, err := repository.CreateWithCode(ctx, item, "owner", "owner", "", pepper)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repository.JoinByCode(ctx, code, "member", "member", "", pepper); err != nil {
		t.Fatal(err)
	}
	if err := repository.AssociateStream(ctx, item.ID, "owner", "stream-1"); err != nil {
		t.Fatal(err)
	}

	result, err := repository.Leave(ctx, item.ID, "owner")
	if err != nil {
		t.Fatal(err)
	}
	if !result.RoomClosed || result.StreamID != "stream-1" {
		t.Fatalf("Leave() = %+v, want closed room and associated stream", result)
	}
	if _, err := repository.JoinByCode(ctx, code, "late-joiner", "late-joiner", "", pepper); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("JoinByCode() error = %v, want ErrUnavailable", err)
	}
}

func TestServiceListPublicIncludesSnapshotCoverArts(t *testing.T) {
	manager := NewRoomManager()
	manager.Ensure("room-1")
	_, err := manager.Attach("room-1", RoomParticipant{
		UserID: "user-1", ConnectionID: "connection-a", Send: func(RoomEvent) error { return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	snapshot := json.RawMessage(`{"version":1,"mixer":{"channelState":{},"fx":{"type":"echo","division":1,"wet":0,"assign":{}},"tempoMaster":null,"master":0.9},"decks":{"A":{"track":{"id":"a","title":"A","artist":"x","bpm":1,"beatOffset":0,"key":"C","durationSeconds":1,"cues":[],"waveformOverview":null,"coverUrl":"https://cdn.example/a.jpg"},"playing":false,"positionSeconds":0,"durationSeconds":0,"rate":1},"B":{"track":null,"playing":false,"positionSeconds":0,"durationSeconds":0,"rate":1}},"beatsPerView":32,"pointer":null,"popup":null,"capturedAt":0}`)
	if err := manager.Publish("room-1", "connection-a", RoomMessage{Type: "snapshot", T: 1, Payload: snapshot}); err != nil {
		t.Fatal(err)
	}
	repository := newRoomRepositoryStub()
	repository.list = func(context.Context) ([]ListedRoom, error) {
		return []ListedRoom{ToListed(Room{ID: "room-1", Visibility: VisibilityPublic, Capacity: 2}, nil, 1)}, nil
	}
	got, err := NewService(repository, nil, manager).ListPublic(context.Background())
	if err != nil {
		t.Fatalf("ListPublic() error = %v", err)
	}
	if len(got) != 1 || got[0].CoverArts[0] == nil || *got[0].CoverArts[0] != "https://cdn.example/a.jpg" || got[0].CoverArts[1] != nil {
		t.Fatalf("ListPublic covers = %+v", got)
	}
}

func TestServiceBroadcastsOmitPrivateCodes(t *testing.T) {
	manager := NewRoomManager()
	manager.Ensure("public-room")
	manager.Ensure("private-room")
	manager.RememberInviteCode("public-room", "111111")
	manager.RememberInviteCode("private-room", "222222")
	repository := newRoomRepositoryStub()
	repository.broadcasts = func(context.Context, []string) (map[string]BroadcastListing, error) {
		return map[string]BroadcastListing{
			"stream-public":  {StreamID: "stream-public", ID: "public-room", Visibility: VisibilityPublic},
			"stream-private": {StreamID: "stream-private", ID: "private-room", Visibility: VisibilityPrivate},
		}, nil
	}
	got, err := NewService(repository, nil, manager).BroadcastsByStreamIDs(context.Background(), []string{"stream-public", "stream-private"})
	if err != nil {
		t.Fatalf("BroadcastsByStreamIDs() error = %v", err)
	}
	if got["stream-public"].Code != "111111" {
		t.Errorf("public broadcast code = %q, want 111111", got["stream-public"].Code)
	}
	if got["stream-private"].Code != "" {
		t.Errorf("private broadcast code = %q, want empty", got["stream-private"].Code)
	}
}

func TestServiceLeaveEndsAssociatedStream(t *testing.T) {
	ended := ""
	repository := newRoomRepositoryStub()
	repository.leave = func(context.Context, string, string) (*LeaveResult, error) {
		return &LeaveResult{RoomClosed: true, StreamID: "stream-1"}, nil
	}
	service := NewService(repository, nil)
	service.SetStreamTerminator(streamTerminatorFunc(func(_ context.Context, streamID string) error {
		ended = streamID
		return nil
	}))
	result, err := service.Leave(context.Background(), "room-1", "user-1")
	if err != nil {
		t.Fatalf("Leave() error = %v", err)
	}
	if !result.RoomClosed || ended != "stream-1" {
		t.Fatalf("Leave() = %+v ended = %q", result, ended)
	}
}

func TestGetTrackAudioURLAllowsTracksFromOtherRoomMembers(t *testing.T) {
	manager := NewRoomManager()
	manager.Ensure("room-1")
	token, err := manager.IssueTrackToken("room-1", "requester", "owner-track", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	repository := newRoomRepositoryStub()
	repository.get = func(context.Context, string, string) (*ListedRoom, error) {
		return &ListedRoom{ID: "room-1"}, nil
	}
	repository.getMemberUserIDs = func(context.Context, string) ([]string, error) {
		return []string{"owner", "requester"}, nil
	}
	service := NewService(repository, nil, manager)
	service.SetTrackDirectory(roomTrackDirectoryFunc(func(_ context.Context, userIDs []string) ([]track.Track, error) {
		if len(userIDs) != 2 || userIDs[0] != "owner" || userIDs[1] != "requester" {
			t.Fatalf("ListByUserIDs() IDs = %v, want room members", userIDs)
		}
		return []track.Track{{ID: "owner-track", UserID: "owner", ObjectKey: "tracks/owner.mp3"}}, nil
	}))
	service.SetS3Store(roomAudioStoreFunc(func(_ context.Context, objectKey string) (*storage.S3Object, error) {
		if objectKey != "tracks/owner.mp3" {
			t.Fatalf("GetObject() key = %q, want owner track", objectKey)
		}
		body := "shared audio"
		return &storage.S3Object{
			Body: io.NopCloser(strings.NewReader(body)), ContentType: "audio/mpeg", ContentLength: int64(len(body)),
		}, nil
	}))

	object, err := service.GetTrackAudio(context.Background(), "room-1", "owner-track", token)
	if err != nil {
		t.Fatalf("GetTrackAudio() error = %v", err)
	}
	defer object.Body.Close()
	if object.ContentType != "audio/mpeg" || object.ContentLength != int64(len("shared audio")) {
		t.Fatalf("GetTrackAudio() object = %+v", object)
	}
}

type roomTrackDirectoryFunc func(context.Context, []string) ([]track.Track, error)

func (f roomTrackDirectoryFunc) ListByUserIDs(ctx context.Context, userIDs []string) ([]track.Track, error) {
	return f(ctx, userIDs)
}

type roomAudioStoreFunc func(context.Context, string) (*storage.S3Object, error)

func (f roomAudioStoreFunc) GetObject(ctx context.Context, objectKey string) (*storage.S3Object, error) {
	return f(ctx, objectKey)
}

type streamTerminatorFunc func(context.Context, string) error

func (f streamTerminatorFunc) EndForced(ctx context.Context, streamID string) error {
	return f(ctx, streamID)
}
