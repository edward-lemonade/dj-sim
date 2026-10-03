package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/edward-lemonade/dj-sim-backend/internal/domain/room"
	"github.com/edward-lemonade/dj-sim-backend/internal/http/app_error"
	"github.com/edward-lemonade/dj-sim-backend/internal/http/middleware"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type RoomCreator interface {
	Create(ctx context.Context, creatorID, username, avatarURL, visibility string) (*room.CreatedRoom, error)
	ListPublic(ctx context.Context) ([]room.ListedRoom, error)
	Get(ctx context.Context, roomID, userID string) (*room.ListedRoom, error)
	GetRoomLibrary(ctx context.Context, roomID, requestingUserID string) ([]room.RoomTrack, error)
	JoinByCode(ctx context.Context, code, userID, username, avatarURL string) (*room.JoinResult, error)
	JoinPublic(ctx context.Context, roomID, userID, username, avatarURL string) (*room.JoinResult, error)
	Leave(ctx context.Context, roomID, userID string) (*room.LeaveResult, error)
	RelayManager() *room.RoomManager
	IssueTrackAccessToken(ctx context.Context, roomID, userID, trackID string) (string, error)
	GetTrackAudioURL(ctx context.Context, roomID, trackID, token string) (string, error)
	CleanupRoomsNoMembers(ctx context.Context) error
}

type RoomHandler struct {
	Rooms  RoomCreator
	origin string
}

func NewRoomHandler(service RoomCreator, origin string) *RoomHandler {
	return &RoomHandler{Rooms: service, origin: origin}
}

func (h *RoomHandler) ListPublic(c *gin.Context) {
	go func() {
		_ = h.Rooms.CleanupRoomsNoMembers(c.Request.Context())
	}()
	rooms, err := h.Rooms.ListPublic(c.Request.Context())
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	if rooms == nil {
		rooms = []room.ListedRoom{}
	}
	c.JSON(http.StatusOK, rooms)
}

func (h *RoomHandler) Get(c *gin.Context) {
	currentUser := middleware.CurrentUser(c)
	if currentUser == nil {
		c.JSON(http.StatusForbidden, gin.H{"message": "user not registered"})
		return
	}
	item, err := h.Rooms.Get(c.Request.Context(), c.Param("id"), currentUser.ID)
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *RoomHandler) Create(c *gin.Context) {
	var request struct {
		Visibility string `json:"visibility"`
		AvatarURL  string `json:"avatarUrl"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "visibility must be public or private"})
		return
	}

	currentUser := middleware.CurrentUser(c)
	if currentUser == nil {
		c.JSON(http.StatusForbidden, gin.H{"message": "user not registered"})
		return
	}
	created, err := h.Rooms.Create(
		c.Request.Context(), currentUser.ID, currentUser.Username, request.AvatarURL, request.Visibility,
	)
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	c.JSON(http.StatusCreated, created)
}

func (h *RoomHandler) JoinByCode(c *gin.Context) {
	var request struct {
		Code      string `json:"code"`
		AvatarURL string `json:"avatarUrl"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "a six-digit room code is required"})
		return
	}
	currentUser := middleware.CurrentUser(c)
	if currentUser == nil {
		c.JSON(http.StatusForbidden, gin.H{"message": "user not registered"})
		return
	}
	joined, err := h.Rooms.JoinByCode(
		c.Request.Context(), request.Code, currentUser.ID, currentUser.Username, request.AvatarURL,
	)
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	c.JSON(http.StatusOK, joined)
}

func (h *RoomHandler) JoinPublic(c *gin.Context) {
	var request struct {
		AvatarURL string `json:"avatarUrl"`
	}
	if c.Request.ContentLength != 0 {
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"message": "invalid room join request"})
			return
		}
	}
	currentUser := middleware.CurrentUser(c)
	if currentUser == nil {
		c.JSON(http.StatusForbidden, gin.H{"message": "user not registered"})
		return
	}
	joined, err := h.Rooms.JoinPublic(
		c.Request.Context(), c.Param("id"), currentUser.ID, currentUser.Username, request.AvatarURL,
	)
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	c.JSON(http.StatusOK, joined)
}

func (h *RoomHandler) Leave(c *gin.Context) {
	currentUser := middleware.CurrentUser(c)
	if currentUser == nil {
		c.JSON(http.StatusForbidden, gin.H{"message": "user not registered"})
		return
	}
	result, err := h.Rooms.Leave(c.Request.Context(), c.Param("id"), currentUser.ID)
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *RoomHandler) GetLibrary(c *gin.Context) {
	currentUser := middleware.CurrentUser(c)
	if currentUser == nil {
		c.JSON(http.StatusForbidden, gin.H{"message": "user not registered"})
		return
	}
	tracks, err := h.Rooms.GetRoomLibrary(c.Request.Context(), c.Param("id"), currentUser.ID)
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	c.JSON(http.StatusOK, tracks)
}

func (h *RoomHandler) IssueTrackToken(c *gin.Context) {
	var request struct {
		TrackID string `json:"trackId"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "track ID is required"})
		return
	}
	currentUser := middleware.CurrentUser(c)
	if currentUser == nil {
		c.JSON(http.StatusForbidden, gin.H{"message": "user not registered"})
		return
	}
	token, err := h.Rooms.IssueTrackAccessToken(
		c.Request.Context(), c.Param("id"), currentUser.ID, request.TrackID,
	)
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"token": token})
}

func (h *RoomHandler) GetTrackAudio(c *gin.Context) {
	currentUser := middleware.CurrentUser(c)
	if currentUser == nil {
		c.JSON(http.StatusForbidden, gin.H{"message": "user not registered"})
		return
	}
	token := c.Query("token")
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "access token is required"})
		return
	}
	url, err := h.Rooms.GetTrackAudioURL(
		c.Request.Context(), c.Param("id"), c.Param("trackId"), token,
	)
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"url": url})
}

func (h *RoomHandler) Events(c *gin.Context) {
	manager := h.Rooms.RelayManager()
	roomID := c.Param("id")
	ticket, err := manager.ConsumeTicket(c.Query("ticket"), roomID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "invalid or expired room ticket"})
		return
	}
	if !websocket.IsWebSocketUpgrade(c.Request) {
		c.JSON(http.StatusBadRequest, gin.H{"message": "websocket upgrade required"})
		return
	}
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool {
		if h.origin == "" || h.origin == "*" {
			return true
		}
		return strings.TrimRight(r.Header.Get("Origin"), "/") == strings.TrimRight(h.origin, "/")
	}}
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(256 << 10)
	_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	})

	var writeMu sync.Mutex
	send := func(event room.RoomEvent) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		return conn.WriteJSON(event)
	}
	connectionID := uuid.NewString()
	detach, err := manager.Attach(roomID, room.RoomParticipant{
		UserID: ticket.UserID, Username: ticket.Username, ConnectionID: connectionID, Send: send,
		Close: func() { _ = conn.Close() },
	})
	if err != nil {
		return
	}
	isOwner := manager.IsOwner(roomID, ticket.UserID)
	defer func() {
		detach()
		if isOwner && !manager.OwnerConnected(roomID) {
			if _, err := h.Rooms.Leave(context.Background(), roomID, ticket.UserID); err != nil {
				log.Printf("end room after owner disconnect %s: %v", roomID, err)
			}
		}
	}()

	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(25 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				writeMu.Lock()
				_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
				err := conn.WriteMessage(websocket.PingMessage, nil)
				writeMu.Unlock()
				if err != nil {
					return
				}
			}
		}
	}()
	defer close(done)

	for {
		_, message, err := conn.NextReader()
		if err != nil {
			return
		}
		decoder := json.NewDecoder(message)
		decoder.DisallowUnknownFields()
		var event room.RoomMessage
		if err := decoder.Decode(&event); err != nil {
			_ = send(room.RoomEvent{RoomID: roomID, Type: "error", Payload: []byte(`{"message":"invalid room event"}`)})
			return
		}
		var trailing any
		if err := decoder.Decode(&trailing); err != io.EOF {
			_ = send(room.RoomEvent{RoomID: roomID, Type: "error", Payload: []byte(`{"message":"invalid room event"}`)})
			return
		}
		if err := manager.Publish(roomID, connectionID, event); err != nil {
			if errors.Is(err, room.ErrRoomNotFound) {
				_ = send(room.RoomEvent{RoomID: roomID, Type: "closed"})
			} else {
				_ = send(room.RoomEvent{RoomID: roomID, Type: "error", Payload: []byte(`{"message":"invalid room event"}`)})
			}
			log.Printf("reject room event for %s from %s: %v", roomID, ticket.UserID, err)
			return
		}
		_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	}
}
