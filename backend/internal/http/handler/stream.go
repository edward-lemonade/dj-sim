package handler

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/edward-lemonade/dj-sim-backend/internal/domain/stream"
	"github.com/edward-lemonade/dj-sim-backend/internal/http/app_error"
	"github.com/edward-lemonade/dj-sim-backend/internal/http/middleware"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type StreamService interface {
	List(ctx context.Context) ([]stream.ListedSession, error)
	Create(ctx context.Context, input stream.CreateInput) (*stream.Connection, error)
	Join(ctx context.Context, id, userID string) (*stream.Connection, error)
	End(ctx context.Context, id, userID string) error
	TicketManager() *stream.Manager
}

type StreamHandler struct {
	Streams StreamService
	origin  string
}

func NewStreamHandler(service StreamService, origin string) *StreamHandler {
	return &StreamHandler{Streams: service, origin: origin}
}

func (h *StreamHandler) List(c *gin.Context) {
	sessions, err := h.Streams.List(c.Request.Context())
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	if sessions == nil {
		sessions = []stream.ListedSession{}
	}
	c.JSON(http.StatusOK, sessions)
}

func (h *StreamHandler) Create(c *gin.Context) {
	var req struct {
		Name      string `json:"name"`
		AvatarURL string `json:"avatarUrl"`
		RoomID    string `json:"roomId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "stream name is required"})
		return
	}
	u := middleware.CurrentUser(c)
	connection, err := h.Streams.Create(c.Request.Context(), stream.CreateInput{
		UserID: u.ID, Username: u.Username, AvatarURL: req.AvatarURL, Name: req.Name, RoomID: req.RoomID,
	})
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	c.JSON(http.StatusCreated, connection)
}

func (h *StreamHandler) Join(c *gin.Context) {
	u := middleware.CurrentUser(c)
	connection, err := h.Streams.Join(c.Request.Context(), c.Param("id"), u.ID)
	if err != nil {
		app_error.WriteError(c, err)
		return
	}
	c.JSON(http.StatusOK, connection)
}

func (h *StreamHandler) End(c *gin.Context) {
	u := middleware.CurrentUser(c)
	if err := h.Streams.End(c.Request.Context(), c.Param("id"), u.ID); err != nil {
		app_error.WriteError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *StreamHandler) EndOnExit(c *gin.Context) {
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, 128))
	if err != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	ticket, err := h.Streams.TicketManager().ConsumeExitTicket(string(body), c.Param("id"))
	if err != nil {
		c.Status(http.StatusUnauthorized)
		return
	}
	if err := h.Streams.End(c.Request.Context(), c.Param("id"), ticket.UserID); err != nil && !errors.Is(err, stream.ErrNotFound) {
		app_error.WriteError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *StreamHandler) Events(c *gin.Context) {
	manager := h.Streams.TicketManager()
	ticket, err := manager.ConsumeTicket(c.Query("ticket"), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "invalid or expired stream ticket"})
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
	streamID := c.Param("id")
	defer conn.Close()
	conn.SetReadLimit(256 << 10)
	_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	})

	var writeMu sync.Mutex
	send := func(event stream.Event) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		return conn.WriteJSON(event)
	}
	detach, err := manager.Attach(streamID, stream.Participant{
		UserID: ticket.UserID, ConnectionID: uuid.NewString(), Owner: ticket.Owner, Send: send,
	})
	if err != nil {
		return
	}
	defer func() {
		detach()
		if ticket.Owner {
			if err := h.Streams.End(context.Background(), streamID, ticket.UserID); err != nil && !errors.Is(err, stream.ErrNotFound) {
				log.Printf("end disconnected stream %s: %v", streamID, err)
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
		var event stream.Event
		if err := conn.ReadJSON(&event); err != nil {
			return
		}
		if !ticket.Owner {
			_ = send(stream.Event{Type: "error", Payload: []byte(`{"message":"viewer connections are read-only"}`)})
			return
		}
		if event.Type == "end" {
			if err := h.Streams.End(context.Background(), streamID, ticket.UserID); err != nil && !errors.Is(err, stream.ErrNotFound) {
				log.Printf("end stream %s from owner disconnect: %v", streamID, err)
			}
			return
		}
		if err := manager.Publish(streamID, ticket.UserID, event); err != nil {
			_ = send(stream.Event{Type: "error", Payload: []byte(`{"message":"invalid stream event"}`)})
			return
		}
		_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	}
}
