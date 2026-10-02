package stream

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"sync"
	"time"
)

var ErrInvalidTicket = errors.New("invalid or expired stream ticket")

type Ticket struct {
	StreamID string
	UserID   string
	Owner    bool
	ExitOnly bool
	Expires  time.Time
}

type Event struct {
	Type    string          `json:"type"`
	Seq     uint64          `json:"seq,omitempty"`
	T       float64         `json:"t,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
	Count   int             `json:"count,omitempty"`
}

type Participant struct {
	UserID       string
	ConnectionID string
	Owner        bool
	Send         func(Event) error
}

type liveSession struct {
	mu           sync.Mutex
	ownerID      string
	seq          uint64
	snapshotSeq  uint64
	snapshot     json.RawMessage
	recentEvents []Event
	participants map[string]Participant
	viewers      map[string]int
	rateStarted  time.Time
	rateCount    int
}

type Manager struct {
	mu       sync.Mutex
	sessions map[string]*liveSession
	tickets  map[string]Ticket
}

func NewManager() *Manager {
	return &Manager{sessions: make(map[string]*liveSession), tickets: make(map[string]Ticket)}
}

func (m *Manager) Start(id, ownerID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[id] = &liveSession{
		ownerID: ownerID, participants: make(map[string]Participant),
		viewers: make(map[string]int),
	}
}

func (m *Manager) IssueTicket(streamID, userID string, owner bool) (string, error) {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", err
	}
	ticket := base64.RawURLEncoding.EncodeToString(tokenBytes)
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.sessions[streamID]; !ok {
		return "", ErrNotFound
	}
	m.tickets[ticket] = Ticket{StreamID: streamID, UserID: userID, Owner: owner, Expires: time.Now().Add(2 * time.Minute)}
	return ticket, nil
}

func (m *Manager) IssueExitTicket(streamID, userID string) (string, error) {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	m.mu.Lock()
	defer m.mu.Unlock()
	live, ok := m.sessions[streamID]
	if !ok || live.ownerID != userID {
		return "", ErrNotFound
	}
	m.tickets[token] = Ticket{StreamID: streamID, UserID: userID, Owner: true, ExitOnly: true}
	return token, nil
}

func (m *Manager) ConsumeTicket(token, streamID string) (Ticket, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ticket, ok := m.tickets[token]
	delete(m.tickets, token)
	if !ok || ticket.ExitOnly || ticket.StreamID != streamID || time.Now().After(ticket.Expires) {
		return Ticket{}, ErrInvalidTicket
	}
	if _, ok := m.sessions[streamID]; !ok {
		return Ticket{}, ErrNotFound
	}
	return ticket, nil
}

func (m *Manager) ConsumeExitTicket(token, streamID string) (Ticket, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ticket, ok := m.tickets[token]
	delete(m.tickets, token)
	if !ok || !ticket.ExitOnly || !ticket.Owner || ticket.StreamID != streamID {
		return Ticket{}, ErrInvalidTicket
	}
	if _, ok := m.sessions[streamID]; !ok {
		return Ticket{}, ErrNotFound
	}
	return ticket, nil
}

func (m *Manager) Attach(streamID string, p Participant) (func(), error) {
	m.mu.Lock()
	live, ok := m.sessions[streamID]
	if !ok {
		m.mu.Unlock()
		return nil, ErrNotFound
	}
	live.mu.Lock()
	m.mu.Unlock()
	if p.Owner && p.UserID != live.ownerID {
		live.mu.Unlock()
		return nil, ErrNotFound
	}
	key := p.ConnectionID
	if key == "" {
		key = p.UserID
	}
	if !p.Owner {
		live.viewers[p.UserID]++
	}
	live.participants[key] = p
	snapshot := append(json.RawMessage(nil), live.snapshot...)
	snapshotSeq := live.snapshotSeq
	recent := append([]Event(nil), live.recentEvents...)
	count := len(live.viewers)
	live.mu.Unlock()

	if p.Owner {
		_ = p.Send(Event{Type: "viewer-count", Count: count})
	} else {
		_ = p.Send(Event{Type: "joined", Seq: snapshotSeq, Payload: snapshot})
		for _, event := range recent {
			if event.Seq > snapshotSeq {
				_ = p.Send(event)
			}
		}
		m.broadcastCount(streamID, count)
	}

	return func() {
		live.mu.Lock()
		delete(live.participants, key)
		if !p.Owner {
			live.viewers[p.UserID]--
			if live.viewers[p.UserID] <= 0 {
				delete(live.viewers, p.UserID)
			}
		}
		count := len(live.viewers)
		live.mu.Unlock()
		if !p.Owner {
			m.broadcastCount(streamID, count)
		}
	}, nil
}

func (m *Manager) Publish(streamID, userID string, incoming Event) error {
	m.mu.Lock()
	live, ok := m.sessions[streamID]
	m.mu.Unlock()
	if !ok {
		return ErrNotFound
	}
	live.mu.Lock()
	defer live.mu.Unlock()
	if userID != live.ownerID {
		return ErrNotFound
	}
	now := time.Now()
	if now.Sub(live.rateStarted) >= time.Second {
		live.rateStarted = now
		live.rateCount = 0
	}
	live.rateCount++
	if live.rateCount > 30 {
		return errors.New("stream event rate exceeded")
	}
	switch incoming.Type {
	case "snapshot":
		if !validTimestamp(incoming.T) || len(incoming.Payload) == 0 || len(incoming.Payload) > 256<<10 || !validateSnapshot(incoming.Payload) {
			return errors.New("invalid stream snapshot")
		}
		live.seq++
		live.snapshot = append(live.snapshot[:0], incoming.Payload...)
		live.snapshotSeq = live.seq
		incoming.Seq = live.seq
	case "event", "pointer":
		maxPayload := 256 << 10
		if incoming.Type == "pointer" {
			maxPayload = 8 << 10
		}
		if !validTimestamp(incoming.T) || len(incoming.Payload) > maxPayload || !json.Valid(incoming.Payload) {
			return errors.New("invalid stream event")
		}
		if incoming.Type == "event" && !validateAction(incoming.Payload) {
			return errors.New("unsupported stream action")
		}
		if incoming.Type == "pointer" && !validatePointer(incoming.Payload) {
			return errors.New("invalid stream pointer")
		}
		live.seq++
		incoming.Seq = live.seq
		if incoming.Type == "event" {
			live.recentEvents = append(live.recentEvents, incoming)
			if len(live.recentEvents) > 200 {
				live.recentEvents = append([]Event(nil), live.recentEvents[len(live.recentEvents)-200:]...)
			}
		}
	default:
		return errors.New("unsupported stream event type")
	}
	for key, participant := range live.participants {
		if participant.Owner {
			continue
		}
		if err := participant.Send(incoming); err != nil {
			delete(live.participants, key)
		}
	}
	return nil
}

func validateSnapshot(payload json.RawMessage) bool {
	root, ok := objectWithFields(payload, "version", "mixer", "decks", "beatsPerView", "pointer", "popup", "capturedAt")
	if !ok || !hasRequired(root, "version", "mixer", "decks", "beatsPerView", "pointer", "popup", "capturedAt") ||
		!numberInRange(root["beatsPerView"], 0.000001, 65536) || !numberInRange(root["capturedAt"], 0, math.MaxFloat64) {
		return false
	}
	var version int
	if json.Unmarshal(root["version"], &version) != nil || version != 1 {
		return false
	}
	if !validateMixer(root["mixer"]) {
		return false
	}
	decks, ok := objectWithFields(root["decks"], "A", "B")
	if !ok || len(decks) != 2 {
		return false
	}
	for _, id := range []string{"A", "B"} {
		deck, ok := objectWithFields(decks[id], "track", "playing", "positionSeconds", "durationSeconds", "rate")
		if !ok || len(deck) != 5 || !validateTransportFields(deck) {
			return false
		}
		if string(deck["track"]) != "null" {
			if !validateTrackOrNull(deck["track"]) {
				return false
			}
		}
	}
	if len(root["pointer"]) > 0 && string(root["pointer"]) != "null" {
		if !validatePointer(root["pointer"]) {
			return false
		}
	}
	if len(root["popup"]) > 0 && string(root["popup"]) != "null" {
		if !validatePopup(root["popup"]) {
			return false
		}
	}
	return true
}

func validateAction(payload json.RawMessage) bool {
	action, ok := objectWithFields(payload, "action", "deck", "value")
	if !ok {
		return false
	}
	var name string
	if json.Unmarshal(action["action"], &name) != nil || len(action) == 0 {
		return false
	}
	switch name {
	case "mixer-change", "track-load", "transport", "waveform-view", "popup":
		switch name {
		case "mixer-change":
			return len(action) == 2 && len(action["value"]) > 0 && validateMixer(action["value"])
		case "track-load":
			return len(action) == 3 && validDeck(action["deck"]) && validateTrackOrNull(action["value"])
		case "transport":
			return len(action) == 3 && validDeck(action["deck"]) && validateTransport(action["value"])
		case "waveform-view":
			var value float64
			return len(action) == 2 && json.Unmarshal(action["value"], &value) == nil && value > 0 && !math.IsInf(value, 0)
		case "popup":
			return len(action) == 2 && validatePopup(action["value"])
		}
	default:
		return false
	}
	return false
}

func validTimestamp(value float64) bool {
	return value >= 0 && !math.IsNaN(value) && !math.IsInf(value, 0)
}

func validDeck(payload json.RawMessage) bool {
	var deck string
	return json.Unmarshal(payload, &deck) == nil && (deck == "A" || deck == "B")
}

func validatePointer(payload json.RawMessage) bool {
	pointer, ok := objectWithFields(payload, "x", "y")
	if !ok || len(pointer) != 2 {
		return false
	}
	var x, y float64
	return json.Unmarshal(pointer["x"], &x) == nil && json.Unmarshal(pointer["y"], &y) == nil &&
		validTimestamp(x) && validTimestamp(y) && x <= 1 && y <= 1
}

func validatePopup(payload json.RawMessage) bool {
	if string(payload) == "null" {
		return true
	}
	popup, ok := objectWithFields(payload, "kind", "deck")
	if !ok || len(popup) != 2 {
		return false
	}
	var kind string
	if json.Unmarshal(popup["kind"], &kind) != nil || kind != "track-picker" {
		return false
	}
	return validDeck(popup["deck"])
}

func validateTransport(payload json.RawMessage) bool {
	transport, ok := objectWithFields(payload, "playing", "positionSeconds", "durationSeconds", "rate")
	return ok && validateTransportFields(transport)
}

func validateTransportFields(transport map[string]json.RawMessage) bool {
	if !hasRequired(transport, "playing", "positionSeconds", "durationSeconds", "rate") {
		return false
	}
	var playing bool
	var position, duration, rate float64
	return json.Unmarshal(transport["playing"], &playing) == nil &&
		json.Unmarshal(transport["positionSeconds"], &position) == nil &&
		json.Unmarshal(transport["durationSeconds"], &duration) == nil &&
		json.Unmarshal(transport["rate"], &rate) == nil &&
		validTimestamp(position) && validTimestamp(duration) && rate > 0 && !math.IsInf(rate, 0)
}

func validateMixer(payload json.RawMessage) bool {
	mixer, ok := objectWithFields(payload, "channelState", "fx", "tempoMaster", "master")
	if !ok || len(mixer) != 4 || !hasRequired(mixer, "channelState", "fx", "tempoMaster", "master") {
		return false
	}
	channels, ok := objectWithFields(mixer["channelState"], "0", "1")
	if !ok || len(channels) != 2 {
		return false
	}
	for _, id := range []string{"0", "1"} {
		channel, ok := objectWithFields(channels[id], "high", "mid", "low", "filter", "volume", "tempo")
		if !ok || len(channel) != 6 ||
			!numberInRange(channel["high"], -1, 1) ||
			!numberInRange(channel["mid"], -1, 1) ||
			!numberInRange(channel["low"], -1, 1) ||
			!numberInRange(channel["filter"], -1, 1) ||
			!numberInRange(channel["volume"], 0, 1) ||
			!numberInRange(channel["tempo"], -50, 50) {
			return false
		}
	}
	fx, ok := objectWithFields(mixer["fx"], "type", "division", "wet", "assign")
	if !ok || len(fx) != 4 || !numberInRange(fx["division"], 0.000001, 1024) || !numberInRange(fx["wet"], 0, 1) {
		return false
	}
	var fxType string
	if json.Unmarshal(fx["type"], &fxType) != nil || (fxType != "echo" && fxType != "reverb" && fxType != "flanger") {
		return false
	}
	assign, ok := objectWithFields(fx["assign"], "0", "1")
	if !ok || len(assign) != 2 {
		return false
	}
	for _, id := range []string{"0", "1"} {
		var enabled bool
		if json.Unmarshal(assign[id], &enabled) != nil {
			return false
		}
	}
	var tempoMaster *int
	if string(mixer["tempoMaster"]) != "null" &&
		(json.Unmarshal(mixer["tempoMaster"], &tempoMaster) != nil || tempoMaster == nil || (*tempoMaster != 0 && *tempoMaster != 1)) {
		return false
	}
	if !numberInRange(mixer["master"], 0, 1) {
		return false
	}
	return true
}

func numberInRange(payload json.RawMessage, min, max float64) bool {
	var value float64
	return json.Unmarshal(payload, &value) == nil && !math.IsNaN(value) && !math.IsInf(value, 0) && value >= min && value <= max
}

func validateTrackOrNull(payload json.RawMessage) bool {
	if string(payload) == "null" {
		return true
	}
	track, ok := objectWithFields(payload, "id", "title", "artist", "bpm", "beatOffset", "key", "durationSeconds", "cues", "waveformOverview")
	if !ok || len(track) != 9 || !hasRequired(track, "id", "title", "artist", "bpm", "beatOffset", "key", "durationSeconds", "cues", "waveformOverview") {
		return false
	}
	if string(track["waveformOverview"]) != "null" {
		waveform, ok := objectWithFields(track["waveformOverview"], "lows", "mids", "highs", "durationSeconds")
		if !ok || len(waveform) == 0 {
			return false
		}
	}
	return json.Valid(track["cues"])
}

func objectWithFields(payload json.RawMessage, fields ...string) (map[string]json.RawMessage, bool) {
	var object map[string]json.RawMessage
	if json.Unmarshal(payload, &object) != nil || object == nil {
		return nil, false
	}
	allowed := make(map[string]struct{}, len(fields))
	for _, field := range fields {
		allowed[field] = struct{}{}
	}
	for key := range object {
		if _, ok := allowed[key]; !ok {
			return nil, false
		}
	}
	return object, true
}

func hasRequired(object map[string]json.RawMessage, fields ...string) bool {
	for _, field := range fields {
		if len(object[field]) == 0 {
			return false
		}
	}
	return true
}

func (m *Manager) broadcastCount(streamID string, count int) {
	m.mu.Lock()
	live := m.sessions[streamID]
	m.mu.Unlock()
	if live == nil {
		return
	}
	live.mu.Lock()
	defer live.mu.Unlock()
	for _, participant := range live.participants {
		if participant.Owner {
			_ = participant.Send(Event{Type: "viewer-count", Count: count})
		}
	}
}

func (m *Manager) OwnerConnected(streamID string) bool {
	m.mu.Lock()
	live := m.sessions[streamID]
	m.mu.Unlock()
	if live == nil {
		return false
	}
	live.mu.Lock()
	defer live.mu.Unlock()
	for _, participant := range live.participants {
		if participant.Owner {
			return true
		}
	}
	return false
}

func (m *Manager) End(streamID string) {
	m.mu.Lock()
	live := m.sessions[streamID]
	delete(m.sessions, streamID)
	for token, ticket := range m.tickets {
		if ticket.StreamID == streamID {
			delete(m.tickets, token)
		}
	}
	m.mu.Unlock()
	if live == nil {
		return
	}
	live.mu.Lock()
	defer live.mu.Unlock()
	for _, participant := range live.participants {
		_ = participant.Send(Event{Type: "ended"})
	}
}
