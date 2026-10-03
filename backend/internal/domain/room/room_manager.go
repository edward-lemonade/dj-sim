package room

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	ErrInvalidRoomTicket = errors.New("invalid or expired room ticket")
	ErrRoomNotFound      = errors.New("room relay not found")
)

const (
	LeaseTimeout          = 30 * time.Second
	LeaseRenewalCadence   = 10 * time.Second
	MaxLeaseHoldTime      = 5 * time.Minute
	ExtrapolationHorizon  = 2 * time.Second
	CorrectionBlendSpeed  = 200 * time.Millisecond
	TrackAccessTokenTTL   = 15 * time.Minute
	RelayTicketTTL        = 5 * time.Minute
	S3URLExpiration       = 5 * time.Minute
	RecentEventWindow     = 100
	MaxRateWindow         = 10
	MaxRateWindowDuration = time.Minute
)

type RelayTicket struct {
	RoomID    string
	UserID    string
	Username  string
	AvatarURL string
	Expires   time.Time
}

type TrackAccessToken struct {
	RoomID    string
	UserID    string
	TrackID   string
	ExpiresAt time.Time
}

type RoomEvent struct {
	RoomID    string          `json:"roomId"`
	Type      string          `json:"type"`
	Seq       uint64          `json:"seq,omitempty"`
	T         float64         `json:"t,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
	UserID    string          `json:"userId,omitempty"`
	Username  string          `json:"username,omitempty"`
	AvatarURL string          `json:"avatarUrl,omitempty"`
}

type RoomMessage struct {
	Type    string          `json:"type"`
	T       float64         `json:"t"`
	Payload json.RawMessage `json:"payload"`
}

type RoomPresence struct {
	UserID    string `json:"userId"`
	Username  string `json:"username"`
	AvatarURL string `json:"avatarUrl"`
}

type JoinedState struct {
	Snapshot    json.RawMessage `json:"snapshot"`
	SnapshotSeq uint64          `json:"snapshotSeq"`
	LastSeq     uint64          `json:"lastSeq"`
	Members     []RoomPresence  `json:"members"`
	Leases      []ControlLease  `json:"leases"`
}

type RoomParticipant struct {
	UserID       string
	Username     string
	AvatarURL    string
	ConnectionID string
	Send         func(RoomEvent) error
	Close        func()
}

type roomRelay struct {
	mu           sync.Mutex
	ownerID      string
	seq          uint64
	snapshotSeq  uint64
	snapshotTime float64
	snapshot     json.RawMessage
	recent       []RoomEvent
	participants map[string]RoomParticipant
	rates        map[string]rateWindow
	leases       map[string]ControlLease
	trackOwners  map[string]string
}

type rateWindow struct {
	started time.Time
	count   int
}

type RoomManager struct {
	mu          sync.Mutex
	rooms       map[string]*roomRelay
	tickets     map[string]RelayTicket
	inviteCodes map[string]string
	trackTokens map[string]TrackAccessToken
}

func NewRoomManager() *RoomManager {
	return &RoomManager{
		rooms:       make(map[string]*roomRelay),
		tickets:     make(map[string]RelayTicket),
		inviteCodes: make(map[string]string),
		trackTokens: make(map[string]TrackAccessToken),
	}
}

func (m *RoomManager) Ensure(roomID string, ownerIDs ...string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.rooms[roomID] == nil {
		m.rooms[roomID] = &roomRelay{
			participants: make(map[string]RoomParticipant),
			rates:        make(map[string]rateWindow),
			leases:       make(map[string]ControlLease),
			trackOwners:  make(map[string]string),
		}
	}
	if len(ownerIDs) > 0 && ownerIDs[0] != "" {
		m.rooms[roomID].ownerID = ownerIDs[0]
	}
}

func (m *RoomManager) IsOwner(roomID, userID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	live := m.rooms[roomID]
	return live != nil && live.ownerID == userID
}

func (m *RoomManager) OwnerConnected(roomID string) bool {
	m.mu.Lock()
	live := m.rooms[roomID]
	ownerID := ""
	if live != nil {
		ownerID = live.ownerID
	}
	m.mu.Unlock()
	if live == nil || ownerID == "" {
		return false
	}
	live.mu.Lock()
	defer live.mu.Unlock()
	for _, participant := range live.participants {
		if participant.UserID == ownerID {
			return true
		}
	}
	return false
}

func (m *RoomManager) IssueTicket(roomID, userID, username string, avatarURLs ...string) (string, error) {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.rooms[roomID] == nil {
		return "", ErrRoomNotFound
	}
	for existingToken, ticket := range m.tickets {
		if time.Now().After(ticket.Expires) {
			delete(m.tickets, existingToken)
		}
	}
	avatarURL := ""
	if len(avatarURLs) > 0 {
		avatarURL = avatarURLs[0]
	}
	m.tickets[token] = RelayTicket{
		RoomID: roomID, UserID: userID, Username: username, AvatarURL: avatarURL, Expires: time.Now().Add(RelayTicketTTL),
	}
	return token, nil
}

func (m *RoomManager) RememberInviteCode(roomID, code string) {
	if roomID == "" || len(code) != 6 {
		return
	}
	for _, digit := range code {
		if digit < '0' || digit > '9' {
			return
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.rooms[roomID] == nil {
		return
	}
	m.inviteCodes[roomID] = code
}

func (m *RoomManager) InviteCode(roomID string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.inviteCodes[roomID]
}

func (m *RoomManager) RecordTrackLoad(roomID, trackID, userID string) {
	live := m.room(roomID)
	if live == nil {
		return
	}
	live.mu.Lock()
	live.trackOwners[trackID] = userID
	live.mu.Unlock()
}

func (m *RoomManager) RecordTrackEject(roomID, trackID string) {
	live := m.room(roomID)
	if live == nil {
		return
	}
	live.mu.Lock()
	delete(live.trackOwners, trackID)
	live.mu.Unlock()
}

func (m *RoomManager) room(roomID string) *roomRelay {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.rooms[roomID]
}

func (m *RoomManager) IssueTrackToken(roomID, userID, trackID string, ttl time.Duration) (string, error) {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.rooms[roomID] == nil {
		return "", ErrRoomNotFound
	}
	for existingToken, trackToken := range m.trackTokens {
		if time.Now().After(trackToken.ExpiresAt) {
			delete(m.trackTokens, existingToken)
		}
	}
	m.trackTokens[token] = TrackAccessToken{
		RoomID:    roomID,
		UserID:    userID,
		TrackID:   trackID,
		ExpiresAt: time.Now().Add(ttl),
	}
	return token, nil
}

func (m *RoomManager) ValidateTrackToken(token, roomID, trackID string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	trackToken, ok := m.trackTokens[token]
	delete(m.trackTokens, token)
	if !ok || trackToken.RoomID != roomID || trackToken.TrackID != trackID || time.Now().After(trackToken.ExpiresAt) {
		return "", errors.New("invalid or expired track access token")
	}
	return trackToken.UserID, nil
}

func (m *RoomManager) RevokeTrackTokens(roomID, userID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for token, trackToken := range m.trackTokens {
		if trackToken.RoomID == roomID && trackToken.UserID == userID {
			delete(m.trackTokens, token)
		}
	}
}

func (m *RoomManager) ConsumeTicket(token, roomID string) (RelayTicket, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ticket, ok := m.tickets[token]
	delete(m.tickets, token)
	if !ok || ticket.RoomID != roomID || time.Now().After(ticket.Expires) {
		return RelayTicket{}, ErrInvalidRoomTicket
	}
	if m.rooms[roomID] == nil {
		return RelayTicket{}, ErrRoomNotFound
	}
	return ticket, nil
}

func (m *RoomManager) Attach(roomID string, participant RoomParticipant) (func(), error) {
	m.mu.Lock()
	live := m.rooms[roomID]
	if live == nil {
		m.mu.Unlock()
		return nil, ErrRoomNotFound
	}
	live.mu.Lock()
	m.mu.Unlock()

	key := participant.ConnectionID
	if key == "" {
		live.mu.Unlock()
		return nil, errors.New("room connection ID is required")
	}
	snapshot := append(json.RawMessage(nil), live.snapshot...)
	snapshotSeq, snapshotTime := live.snapshotSeq, live.snapshotTime
	recent := append([]RoomEvent(nil), live.recent...)
	if len(snapshot) == 0 {
		snapshot = json.RawMessage("null")
	}
	alreadyConnected := false
	for _, existing := range live.participants {
		if existing.UserID == participant.UserID {
			alreadyConnected = true
			break
		}
	}
	leases := m.getLeasesLocked(live)
	joinedPayload, err := json.Marshal(JoinedState{
		Snapshot:    snapshot,
		SnapshotSeq: snapshotSeq,
		LastSeq:     live.seq,
		Members:     presenceWith(live.participants, participant),
		Leases:      leases,
	})
	if err != nil {
		live.mu.Unlock()
		return nil, err
	}
	if err := participant.Send(RoomEvent{RoomID: roomID, Type: "joined", Seq: snapshotSeq, T: snapshotTime, Payload: joinedPayload}); err != nil {
		live.mu.Unlock()
		return nil, err
	}
	for _, event := range recent {
		if event.Seq > snapshotSeq {
			if err := participant.Send(event); err != nil {
				live.mu.Unlock()
				return nil, err
			}
		}
	}
	live.participants[key] = participant
	if !alreadyConnected && participant.UserID != "" {
		joinedEvent := RoomEvent{
			RoomID: roomID, Type: "member-joined", UserID: participant.UserID,
			Username: participant.Username, AvatarURL: participant.AvatarURL,
		}
		for connectedKey, connected := range live.participants {
			if connectedKey == key {
				continue
			}
			if err := connected.Send(joinedEvent); err != nil {
				delete(live.participants, connectedKey)
				if connected.Close != nil {
					connected.Close()
				}
			}
		}
	}
	live.mu.Unlock()

	return func() {
		live.mu.Lock()
		_, attached := live.participants[key]
		delete(live.participants, key)
		stillConnected := false
		for _, existing := range live.participants {
			if existing.UserID == participant.UserID {
				stillConnected = true
				break
			}
		}
		if attached && !stillConnected && participant.UserID != "" {
			leftEvent := RoomEvent{RoomID: roomID, Type: "member-left", UserID: participant.UserID}
			for connectedKey, connected := range live.participants {
				if err := connected.Send(leftEvent); err != nil {
					delete(live.participants, connectedKey)
					if connected.Close != nil {
						connected.Close()
					}
				}
			}
		}
		live.mu.Unlock()
	}, nil
}

func (m *RoomManager) CoverArts(roomID string) [2]string {
	m.mu.Lock()
	live := m.rooms[roomID]
	m.mu.Unlock()
	if live == nil {
		return [2]string{}
	}
	live.mu.Lock()
	snapshot := append(json.RawMessage(nil), live.snapshot...)
	live.mu.Unlock()
	return snapshotCoverArts(snapshot)
}

func snapshotCoverArts(snapshot json.RawMessage) [2]string {
	if len(snapshot) == 0 {
		return [2]string{}
	}
	var current struct {
		Decks map[string]struct {
			Track *struct {
				CoverURL string `json:"coverUrl"`
			} `json:"track"`
		} `json:"decks"`
	}
	if json.Unmarshal(snapshot, &current) != nil {
		return [2]string{}
	}
	var covers [2]string
	if deck := current.Decks["A"]; deck.Track != nil {
		covers[0] = deck.Track.CoverURL
	}
	if deck := current.Decks["B"]; deck.Track != nil {
		covers[1] = deck.Track.CoverURL
	}
	return covers
}

func presenceWith(participants map[string]RoomParticipant, joining RoomParticipant) []RoomPresence {
	seen := map[string]RoomPresence{}
	for _, participant := range participants {
		if participant.UserID == "" {
			continue
		}
		seen[participant.UserID] = RoomPresence{
			UserID: participant.UserID, Username: participant.Username, AvatarURL: participant.AvatarURL,
		}
	}
	if joining.UserID != "" {
		seen[joining.UserID] = RoomPresence{
			UserID: joining.UserID, Username: joining.Username, AvatarURL: joining.AvatarURL,
		}
	}
	members := make([]RoomPresence, 0, len(seen))
	for _, member := range seen {
		members = append(members, member)
	}
	sort.Slice(members, func(i, j int) bool {
		if members[i].Username != members[j].Username {
			return members[i].Username < members[j].Username
		}
		return members[i].UserID < members[j].UserID
	})
	return members
}

func (m *RoomManager) getLeasesLocked(live *roomRelay) []ControlLease {
	leases := make([]ControlLease, 0, len(live.leases))
	now := time.Now()
	for controlID, lease := range live.leases {
		if now.Before(lease.ExpiresAt) {
			leases = append(leases, lease)
		} else {
			delete(live.leases, controlID)
		}
	}
	return leases
}

func (m *RoomManager) Publish(roomID, connectionID string, incoming RoomMessage) error {
	m.mu.Lock()
	live := m.rooms[roomID]
	m.mu.Unlock()
	if live == nil {
		return ErrRoomNotFound
	}
	live.mu.Lock()
	defer live.mu.Unlock()
	participant, ok := live.participants[connectionID]
	if !ok {
		return ErrInvalidRoomTicket
	}
	now := time.Now()
	rate := live.rates[participant.UserID]
	if now.Sub(rate.started) >= time.Second {
		rate = rateWindow{started: now}
	}
	rate.count++
	live.rates[participant.UserID] = rate
	if rate.count > 120 {
		return errors.New("room event rate exceeded")
	}
	if incoming.T < 0 || math.IsNaN(incoming.T) || math.IsInf(incoming.T, 0) || len(incoming.Payload) == 0 || len(incoming.Payload) > 256<<10 || !json.Valid(incoming.Payload) {
		return errors.New("invalid room event")
	}
	switch incoming.Type {
	case "snapshot":
		if !json.Valid(incoming.Payload) {
			return errors.New("invalid room snapshot")
		}
	case "event":
		if !json.Valid(incoming.Payload) {
			return errors.New("invalid room action")
		}
		controlID := extractControlIDFromAction(incoming.Payload)
		if controlID != "" {
			if !validateLeaseLocked(live, participant.UserID, controlID) {
				return errors.New("control not leased to this user")
			}
		}
		if trackID := extractTrackIDFromLoadAction(incoming.Payload); trackID != "" {
			live.trackOwners[trackID] = participant.UserID
		}
		if trackID := extractTrackIDFromEjectAction(incoming.Payload); trackID != "" {
			delete(live.trackOwners, trackID)
		}
	case "control-acquire":
		var payload struct {
			ControlID string `json:"controlId"`
		}
		if err := json.Unmarshal(incoming.Payload, &payload); err != nil {
			return errors.New("invalid control acquire payload")
		}
		if !acquireLeaseLocked(live, participant.UserID, participant.Username, payload.ControlID) {
			return errors.New("control already leased")
		}
	case "control-release":
		var payload struct {
			ControlID string `json:"controlId"`
		}
		if err := json.Unmarshal(incoming.Payload, &payload); err != nil {
			return errors.New("invalid control release payload")
		}
		releaseLeaseLocked(live, participant.UserID, payload.ControlID)
	case "control-cancel":
		var payload struct {
			ControlID string `json:"controlId"`
			Reason    string `json:"reason"`
		}
		if err := json.Unmarshal(incoming.Payload, &payload); err != nil {
			return errors.New("invalid control cancel payload")
		}
		releaseLeaseLocked(live, participant.UserID, payload.ControlID)
	default:
		return errors.New("unsupported room event type")
	}

	live.seq++
	event := RoomEvent{
		RoomID: roomID, Type: incoming.Type, Seq: live.seq, T: incoming.T, Payload: append(json.RawMessage(nil), incoming.Payload...),
		UserID: participant.UserID, Username: participant.Username,
	}
	if incoming.Type == "snapshot" {
		live.snapshot = append(live.snapshot[:0], incoming.Payload...)
		live.snapshotSeq = event.Seq
		live.snapshotTime = event.T
	} else {
		live.recent = append(live.recent, event)
		if len(live.recent) > 200 {
			live.recent = append([]RoomEvent(nil), live.recent[len(live.recent)-200:]...)
		}
	}

	if strings.HasPrefix(incoming.Type, "control-") {
		leases := m.getLeasesLocked(live)
		leasesPayload, _ := json.Marshal(leases)
		live.seq++
		leaseEvent := RoomEvent{
			RoomID: roomID, Type: "leases", Seq: live.seq, T: incoming.T, Payload: leasesPayload,
		}
		for _, connected := range live.participants {
			_ = connected.Send(leaseEvent)
		}
	}
	for key, connected := range live.participants {
		if key == connectionID {
			continue
		}
		if err := connected.Send(event); err != nil {
			delete(live.participants, key)
			if connected.Close != nil {
				connected.Close()
			}
		}
	}
	return nil
}

func (m *RoomManager) RemoveMember(roomID, userID string) {
	m.mu.Lock()
	live := m.rooms[roomID]
	for token, ticket := range m.tickets {
		if ticket.RoomID == roomID && ticket.UserID == userID {
			delete(m.tickets, token)
		}
	}
	for token, trackToken := range m.trackTokens {
		if trackToken.RoomID == roomID && trackToken.UserID == userID {
			delete(m.trackTokens, token)
		}
	}
	m.mu.Unlock()
	if live == nil {
		return
	}
	live.mu.Lock()
	ejectEvents := ejectTracksForUserLocked(roomID, live, userID)
	var departing []RoomParticipant
	for key, participant := range live.participants {
		if participant.UserID == userID {
			delete(live.participants, key)
			departing = append(departing, participant)
		}
	}
	event := RoomEvent{RoomID: roomID, Type: "member-left", UserID: userID}
	for key, participant := range live.participants {
		if err := participant.Send(event); err != nil {
			delete(live.participants, key)
			if participant.Close != nil {
				participant.Close()
			}
		}
		for _, ejectEvent := range ejectEvents {
			_ = participant.Send(ejectEvent)
		}
	}
	for _, participant := range departing {
		_ = participant.Send(event)
		for _, ejectEvent := range ejectEvents {
			_ = participant.Send(ejectEvent)
		}
		if participant.Close != nil {
			participant.Close()
		}
	}
	live.mu.Unlock()
}

func ejectTracksForUserLocked(roomID string, live *roomRelay, userID string) []RoomEvent {
	var events []RoomEvent
	var trackIDs []string
	for trackID, ownerID := range live.trackOwners {
		if ownerID == userID {
			trackIDs = append(trackIDs, trackID)
			delete(live.trackOwners, trackID)
		}
	}

	for _, trackID := range trackIDs {
		ejectPayload, _ := json.Marshal(map[string]any{
			"action":  "eject",
			"trackId": trackID,
		})
		events = append(events, RoomEvent{
			RoomID:  roomID,
			Type:    "event",
			Payload: json.RawMessage(ejectPayload),
		})
	}
	return events
}

func (m *RoomManager) ActiveConnections(roomID string) int {
	m.mu.Lock()
	live := m.rooms[roomID]
	m.mu.Unlock()
	if live == nil {
		return 0
	}
	live.mu.Lock()
	defer live.mu.Unlock()
	return len(live.participants)
}

func (m *RoomManager) Close(roomID string) {
	m.mu.Lock()
	live := m.rooms[roomID]
	delete(m.rooms, roomID)
	delete(m.inviteCodes, roomID)
	for token, ticket := range m.tickets {
		if ticket.RoomID == roomID {
			delete(m.tickets, token)
		}
	}
	for token, trackToken := range m.trackTokens {
		if trackToken.RoomID == roomID {
			delete(m.trackTokens, token)
		}
	}
	m.mu.Unlock()
	if live == nil {
		return
	}
	live.mu.Lock()
	for _, participant := range live.participants {
		_ = participant.Send(RoomEvent{RoomID: roomID, Type: "closed"})
		if participant.Close != nil {
			participant.Close()
		}
	}
	live.participants = make(map[string]RoomParticipant)
	live.leases = make(map[string]ControlLease)
	live.trackOwners = make(map[string]string)
	live.mu.Unlock()
}

const leaseTimeout = 30 * time.Second

func (m *RoomManager) AcquireLease(roomID, userID, username, controlID string) bool {
	live := m.room(roomID)
	if live == nil {
		return false
	}
	live.mu.Lock()
	defer live.mu.Unlock()
	return acquireLeaseLocked(live, userID, username, controlID)
}

func acquireLeaseLocked(live *roomRelay, userID, username, controlID string) bool {
	existing, ok := live.leases[controlID]
	if ok && time.Now().Before(existing.ExpiresAt) && existing.OwnerID != userID {
		return false
	}

	live.leases[controlID] = ControlLease{
		ControlID:     controlID,
		OwnerID:       userID,
		OwnerUsername: username,
		ExpiresAt:     time.Now().Add(leaseTimeout),
	}
	return true
}

func (m *RoomManager) RenewLease(roomID, userID, controlID string) bool {
	m.mu.Lock()
	live := m.rooms[roomID]
	m.mu.Unlock()
	if live == nil {
		return false
	}
	live.mu.Lock()
	defer live.mu.Unlock()

	existing, ok := live.leases[controlID]
	if !ok || existing.OwnerID != userID {
		return false
	}

	existing.ExpiresAt = time.Now().Add(leaseTimeout)
	live.leases[controlID] = existing
	return true
}

func (m *RoomManager) ReleaseLease(roomID, userID, controlID string) {
	live := m.room(roomID)
	if live == nil {
		return
	}
	live.mu.Lock()
	defer live.mu.Unlock()
	releaseLeaseLocked(live, userID, controlID)
}

func releaseLeaseLocked(live *roomRelay, userID, controlID string) {
	existing, ok := live.leases[controlID]
	if ok && existing.OwnerID == userID {
		delete(live.leases, controlID)
	}
}

func (m *RoomManager) ReleaseAllLeases(roomID, userID string) {
	m.mu.Lock()
	live := m.rooms[roomID]
	m.mu.Unlock()
	if live == nil {
		return
	}
	live.mu.Lock()
	defer live.mu.Unlock()

	for controlID, lease := range live.leases {
		if lease.OwnerID == userID {
			delete(live.leases, controlID)
		}
	}
}

func (m *RoomManager) GetLeases(roomID string) []ControlLease {
	live := m.room(roomID)
	if live == nil {
		return nil
	}
	live.mu.Lock()
	defer live.mu.Unlock()
	return m.getLeasesLocked(live)
}

func (m *RoomManager) validateLease(roomID, userID, controlID string) bool {
	live := m.room(roomID)
	if live == nil {
		return false
	}
	live.mu.Lock()
	defer live.mu.Unlock()
	return validateLeaseLocked(live, userID, controlID)
}

func validateLeaseLocked(live *roomRelay, userID, controlID string) bool {
	lease, ok := live.leases[controlID]
	if !ok {
		return false
	}
	now := time.Now()
	if now.After(lease.ExpiresAt) {
		delete(live.leases, controlID)
		return false
	}
	return lease.OwnerID == userID
}

func extractControlIDFromAction(payload json.RawMessage) string {
	var action struct {
		Action string `json:"action"`
		Deck   string `json:"deck"`
	}
	if err := json.Unmarshal(payload, &action); err != nil {
		return ""
	}

	deckID := action.Deck
	if deckID == "A" || deckID == "B" {
		switch action.Action {
		case "set-tempo":
			return "deck." + deckID + ".tempo"
		case "set-gain":
			return "channel." + deckID + ".gain"
		case "set-eq-high":
			return "channel." + deckID + ".eq.high"
		case "set-eq-mid":
			return "channel." + deckID + ".eq.mid"
		case "set-eq-low":
			return "channel." + deckID + ".eq.low"
		}
	}

	switch action.Action {
	case "set-master":
		return "master.volume"
	case "set-fx-wet":
		return "fx.wet"
	case "set-fx-division":
		return "fx.division"
	default:
		return ""
	}
}

func extractTrackIDFromLoadAction(payload json.RawMessage) string {
	var action struct {
		Action string `json:"action"`
		Track  *struct {
			ID string `json:"id"`
		} `json:"track"`
	}
	if err := json.Unmarshal(payload, &action); err != nil {
		return ""
	}
	if action.Action == "load" && action.Track != nil {
		return action.Track.ID
	}
	return ""
}

func extractTrackIDFromEjectAction(payload json.RawMessage) string {
	var action struct {
		Action  string `json:"action"`
		TrackID string `json:"trackId"`
	}
	if err := json.Unmarshal(payload, &action); err != nil {
		return ""
	}
	if action.Action == "eject" {
		return action.TrackID
	}
	return ""
}
