package handler

import (
	"testing"
	"time"

	"github.com/edward-lemonade/dj-sim-backend/internal/domain/room"
)

func TestDelayedRoomEventSenderUsesFixedDelayWithoutBlockingEnqueue(t *testing.T) {
	const delay = 150 * time.Millisecond
	done := make(chan struct{})
	defer close(done)

	received := make(chan room.RoomEvent, 4)
	sender := newDelayedRoomEventSender(delay, func(event room.RoomEvent) error {
		received <- event
		return nil
	}, done, func(err error) {
		t.Errorf("delayed send error = %v", err)
	})

	startedAt := time.Now()
	for seq := uint64(1); seq <= 4; seq++ {
		if err := sender(room.RoomEvent{Seq: seq}); err != nil {
			t.Fatalf("enqueue event %d: %v", seq, err)
		}
	}
	enqueueTime := time.Since(startedAt)
	if enqueueTime >= delay {
		t.Fatalf("enqueuing events took %s; want less than the configured delay %s", enqueueTime, delay)
	}

	for wantSeq := uint64(1); wantSeq <= 4; wantSeq++ {
		select {
		case event := <-received:
			if event.Seq != wantSeq {
				t.Fatalf("received event sequence %d, want %d", event.Seq, wantSeq)
			}
		case <-time.After(2 * delay):
			t.Fatalf("timed out waiting for event %d", wantSeq)
		}
	}
	if elapsed := time.Since(startedAt); elapsed >= 3*delay {
		t.Fatalf("four events took %s to deliver; want a fixed delay, not one delay per event", elapsed)
	}
}
