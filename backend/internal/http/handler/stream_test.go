package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/edward-lemonade/dj-sim-backend/internal/domain/stream"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type streamJoinStub struct {
	StreamService
	userID string
}

func (s *streamJoinStub) Join(_ context.Context, _, userID string) (*stream.Connection, error) {
	s.userID = userID
	return &stream.Connection{}, nil
}

func TestJoinAllowsAnonymousViewerWithGuestIdentity(t *testing.T) {
	gin.SetMode(gin.TestMode)
	service := &streamJoinStub{}
	router := gin.New()
	router.POST("/streams/:id/join", NewStreamHandler(service, "").Join)

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/streams/stream-1/join", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if _, err := uuid.Parse(service.userID); err != nil {
		t.Fatalf("guest identity = %q, want UUID: %v", service.userID, err)
	}
}
