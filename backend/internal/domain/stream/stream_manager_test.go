package stream

import (
	"encoding/json"
	"testing"
)

func TestTicketsAreSingleUseAndScoped(t *testing.T) {
	manager := NewManager()
	manager.Start("stream-a", "owner-a")

	ticket, err := manager.IssueTicket("stream-a", "viewer-a", false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.ConsumeTicket(ticket, "stream-b"); err == nil {
		t.Fatal("ticket was accepted for another stream")
	}
	if _, err := manager.ConsumeTicket(ticket, "stream-a"); err == nil {
		t.Fatal("ticket was reusable after an unsuccessful consume")
	}
}

func TestExitTicketsAreOwnerOnlyAndSeparateFromEventTickets(t *testing.T) {
	manager := NewManager()
	manager.Start("stream-a", "owner-a")

	ticket, err := manager.IssueExitTicket("stream-a", "owner-a")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.ConsumeTicket(ticket, "stream-a"); err == nil {
		t.Fatal("exit ticket was accepted as an event ticket")
	}
	if _, err := manager.ConsumeExitTicket(ticket, "stream-b"); err == nil {
		t.Fatal("exit ticket was accepted for another stream")
	}
	if _, err := manager.ConsumeExitTicket(ticket, "stream-a"); err == nil {
		t.Fatal("exit ticket was reusable after an unsuccessful consume")
	}

	ticket, err = manager.IssueExitTicket("stream-a", "owner-a")
	if err != nil {
		t.Fatal(err)
	}
	consumed, err := manager.ConsumeExitTicket(ticket, "stream-a")
	if err != nil || !consumed.Owner || consumed.UserID != "owner-a" {
		t.Fatalf("consumed ticket = %#v, err = %v", consumed, err)
	}
	if _, err := manager.IssueExitTicket("stream-a", "viewer-a"); err == nil {
		t.Fatal("viewer was issued an exit ticket")
	}
}

func TestViewerCountDeduplicatesUsersAcrossConnections(t *testing.T) {
	manager := NewManager()
	manager.Start("stream-a", "owner-a")
	var ownerEvents []Event
	ownerDetach, err := manager.Attach("stream-a", Participant{
		UserID: "owner-a", ConnectionID: "owner-connection", Owner: true,
		Send: func(event Event) error {
			ownerEvents = append(ownerEvents, event)
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer ownerDetach()

	detachFirst, err := manager.Attach("stream-a", Participant{
		UserID: "viewer-a", ConnectionID: "viewer-tab-a", Send: func(Event) error { return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	detachSecond, err := manager.Attach("stream-a", Participant{
		UserID: "viewer-a", ConnectionID: "viewer-tab-b", Send: func(Event) error { return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	detachOther, err := manager.Attach("stream-a", Participant{
		UserID: "viewer-b", ConnectionID: "viewer-tab-c", Send: func(Event) error { return nil },
	})
	if err != nil {
		t.Fatal(err)
	}

	detachFirst()
	detachSecond()
	detachOther()
	if !manager.OwnerConnected("stream-a") {
		t.Fatal("owner was not connected")
	}
	if got := ownerEvents[len(ownerEvents)-1].Count; got != 0 {
		t.Fatalf("viewer count = %d, want 0", got)
	}
	var sawOneViewer bool
	for _, event := range ownerEvents {
		if event.Type == "viewer-count" && event.Count == 1 {
			sawOneViewer = true
		}
	}
	if !sawOneViewer {
		t.Fatal("expected two tabs for one user to count as one viewer")
	}
}

func TestLateViewerGetsCurrentSnapshotAndPublisherEventsAreOwnerOnly(t *testing.T) {
	manager := NewManager()
	manager.Start("stream-a", "owner-a")
	_, err := manager.Attach("stream-a", Participant{
		UserID: "owner-a", ConnectionID: "owner-connection", Owner: true, Send: func(Event) error { return nil },
	})
	if err != nil {
		t.Fatal(err)
	}

	snapshot := json.RawMessage(`{
		"version":1,
		"mixer":{
			"channelState":{"0":{"high":0,"mid":0,"low":0,"filter":0,"volume":0.8,"tempo":0},"1":{"high":0,"mid":0,"low":0,"filter":0,"volume":0.8,"tempo":0}},
			"fx":{"type":"echo","division":1,"wet":0,"assign":{"0":false,"1":false}},
			"tempoMaster":null,"master":0.9
		},
		"decks":{
			"A":{"track":null,"playing":false,"positionSeconds":0,"durationSeconds":0,"rate":1},
			"B":{"track":null,"playing":false,"positionSeconds":0,"durationSeconds":0,"rate":1}
		},
		"beatsPerView":32,"pointer":null,"popup":null,"capturedAt":0
	}`)
	if err := manager.Publish("stream-a", "owner-a", Event{Type: "snapshot", T: 1, Payload: snapshot}); err != nil {
		t.Fatal(err)
	}
	action := json.RawMessage(`{"action":"waveform-view","value":16}`)
	if err := manager.Publish("stream-a", "owner-a", Event{Type: "event", T: 1.25, Payload: action}); err != nil {
		t.Fatal(err)
	}
	if err := manager.Publish("stream-a", "viewer-a", Event{Type: "snapshot", Payload: snapshot}); err == nil {
		t.Fatal("non-owner published an event")
	}

	var received []Event
	detach, err := manager.Attach("stream-a", Participant{
		UserID: "viewer-b", ConnectionID: "viewer-connection", Send: func(event Event) error {
			received = append(received, event)
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer detach()
	if len(received) != 2 || received[0].Type != "joined" || received[0].Seq != 1 || received[0].T != 1 ||
		received[1].Type != "event" || received[1].Seq != 2 || received[1].T != 1.25 {
		t.Fatalf("late join events = %#v, want snapshot followed by sequenced action", received)
	}
	if string(received[0].Payload) != string(snapshot) {
		t.Fatalf("snapshot = %s, want %s", received[0].Payload, snapshot)
	}
	if string(received[1].Payload) != string(action) {
		t.Fatalf("replayed action = %s, want %s", received[1].Payload, action)
	}
}

func TestSnapshotRejectsUnknownFields(t *testing.T) {
	payload := json.RawMessage(`{
		"version":1,
		"mixer":{
			"channelState":{"0":{"high":0,"mid":0,"low":0,"filter":0,"volume":0.8,"tempo":0},"1":{"high":0,"mid":0,"low":0,"filter":0,"volume":0.8,"tempo":0}},
			"fx":{"type":"echo","division":1,"wet":0,"assign":{"0":false,"1":false}},
			"tempoMaster":null,"master":0.9
		},
		"decks":{
			"A":{"track":null,"playing":false,"positionSeconds":0,"durationSeconds":0,"rate":1},
			"B":{"track":null,"playing":false,"positionSeconds":0,"durationSeconds":0,"rate":1}
		},
		"beatsPerView":32,"pointer":null,"popup":null,"capturedAt":0,
		"privateAudioUrl":"https://example.invalid/audio.mp3"
	}`)
	if validateSnapshot(payload) {
		t.Fatal("snapshot with an unapproved private field was accepted")
	}
}

func TestEventValidationRejectsUnknownFieldsAndInvalidValues(t *testing.T) {
	tests := []struct {
		name    string
		payload string
		valid   bool
	}{
		{name: "valid track load", payload: `{"action":"track-load","deck":"A","value":null}`, valid: true},
		{name: "valid transport", payload: `{"action":"transport","deck":"B","value":{"playing":true,"positionSeconds":12.5,"durationSeconds":240,"rate":1.1}}`, valid: true},
		{name: "valid waveform", payload: `{"action":"waveform-view","value":16}`, valid: true},
		{name: "valid popup close", payload: `{"action":"popup","value":null}`, valid: true},
		{name: "unknown action field", payload: `{"action":"waveform-view","value":16,"privateAudioUrl":"https://example.invalid/a.mp3"}`},
		{name: "invalid deck", payload: `{"action":"track-load","deck":"C","value":null}`},
		{name: "invalid playback rate", payload: `{"action":"transport","deck":"A","value":{"playing":true,"positionSeconds":0,"durationSeconds":20,"rate":0}}`},
		{name: "invalid waveform range", payload: `{"action":"waveform-view","value":-1}`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := validateAction(json.RawMessage(test.payload)); got != test.valid {
				t.Fatalf("validateAction() = %v, want %v", got, test.valid)
			}
		})
	}
}

func TestTrackLoadEventAcceptsSafeWaveformPayload(t *testing.T) {
	peaks := make([]float64, 1600)
	payload, err := json.Marshal(map[string]any{
		"action": "track-load",
		"deck":   "A",
		"value": map[string]any{
			"id": "track-1", "title": "Track", "artist": "Artist", "bpm": 120,
			"beatOffset": 0, "key": "C", "durationSeconds": 180, "cues": []any{},
			"waveformOverview": map[string]any{"lows": peaks, "mids": peaks, "highs": peaks, "durationSeconds": 180},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(payload) <= 8<<10 || len(payload) > 256<<10 {
		t.Fatalf("waveform action size = %d bytes, want between 8 KiB and 256 KiB", len(payload))
	}
	manager := NewManager()
	manager.Start("stream-a", "owner-a")
	if err := manager.Publish("stream-a", "owner-a", Event{Type: "event", Payload: payload}); err != nil {
		t.Fatalf("publish safe track metadata and waveform: %v", err)
	}
}
