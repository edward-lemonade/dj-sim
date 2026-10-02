# Collaborative Rooms

Design spec for multi-user DJ rooms and the Community directory. Rooms let
members share one Studio, collaboratively control its two decks and mixer, and
optionally broadcast the room as a live stream.

This spec builds on the live-session event and audio delivery design in
[`streaming-sessions.md`](./streaming-sessions.md). A room is a collaborative
session; a stream is a view-only broadcast. A room may be public or private
and may also be streamed.

## Goals

- Replace the **Streams** navigation destination with a **Community** page.
- Show active live streams and joinable public rooms in separate lists.
- Let a signed-in user create a public or private room from the Studio.
- Give each active room a six-digit join code.
- Support two simultaneous members in v0, with a room model that allows up to
  three members later.
- Let members use the combined track library and collaboratively operate the
  same two-deck Studio.
- Ensure only one member at a time controls an individual knob, slider, or
  platter.
- Allow any member to start and stop a stream of the room, and show the room's
  members in the stream list (and the join code for public rooms).
- Close a room when its last member leaves; the creator leaving alone does not
  close it.

## Non-goals

- More than two simultaneous members in v0.
- Separate decks or mixers per member.
- Video, voice chat, or microphone capture.
- Persistent room history, replay, or permanent public listings.
- Server-side audio rendering in v0.

## Product model

### Room

A room has a stable ID, six-digit join code, visibility (`public` or
`private`), creation time, active/closed state, and a set of current members.
Only active rooms can be joined. The six-digit code is the invite credential
for both visibility types; public visibility additionally makes an active room
discoverable in Community.

Creating or joining a room requires a signed-in user. Users who are not signed
in cannot join rooms. Membership is per user: a user occupies one member slot
no matter how many tabs or devices they have open.

V0 caps membership at **two concurrent users**. Store capacity separately
from current member count and avoid two-member assumptions in room member
collections, event attribution, avatars, and library aggregation. This allows
raising the cap to three without redesigning the room protocol.

The creator is a member, not a permanent owner whose presence controls room
lifetime. If the creator leaves while another member remains, the room and its
code stay active. The room closes atomically when the last member leaves.

### Room versus stream

- A **room** is interactive and has multiple event publishers.
- A **stream** is read-only for its viewers and may be a solo session or the
  broadcast of a room.
- A streamed room appears in the Community live-stream list, and also in the
  public room list if its visibility is public.
- A private room can be streamed too. Its stream is listed and watchable like
  any other stream, but the room's join code is never shown for it, so viewers
  cannot join the room. What makes a room private is that people do not know
  its code.
- Closing a room ends any room stream. Ending a stream does not by itself
  close the room.

## User experience

### Community page

Rename the current **Streams** navigation item and page to **Community**. Keep
two clearly separated, independently empty/loading/error-aware lists:

1. **Live streams** — active solo streams and streams published by rooms.
2. **Public rooms** — active, discoverable public rooms, whether or not they
   are currently streamed.

Use `/community` for the directory and keep `/streams/:streamId` for the
existing stream-viewer route.

Refresh active entries when sessions start/end. Use real-time presence where
available; bounded polling is acceptable initially. Opening a stale list entry
must return a visible ended/closed state with a route back to Community.

#### Live stream entry

Keep the existing stream-card content and behavior. For a room broadcast,
render the room identity in place of a single streamer's identity:

- Member profile pictures overlap in one avatar stack.
- All member usernames appear on one line and truncate with an ellipsis when
  necessary.
- Display the room's six-digit code for a public room. A private room's entry
  shows no code.
- Show the two currently loaded deck covers as the split/disc artwork,
  sampled when the list loads or refreshes (not a live subscription).
- Opening the entry joins the view-only room broadcast.

Solo stream entries retain their existing single-user presentation and do not
show a room code.

#### Public room entry

Each public room entry shows the same member avatar stack, truncated username
line, and two deck covers sampled at list load/refresh. Include a clear **Join
room** action and an indication of available capacity, such as `1/2`. Joining
from this list uses the room ID; joining from Home uses the code.

Do not expose private rooms in this list. Do not show private room codes in
public API responses, directory data, or client logs.

### Create a room from Studio

Add **Collab** as a third top-bar action alongside the existing Studio actions.
Clicking it opens a modal with **Public room** and **Private room** choices and
a confirmation/create action.

On creation:

1. The backend creates an active room and allocates a unique six-digit code.
2. The creator joins as the first member.
3. The Studio connects to the room's shared state/event channel.
4. Show the code and visibility in the Studio so the creator can invite
   another member.

Creation failure leaves the user in their ordinary solo Studio and displays
an actionable error. Once in a room, the Studio must show room/member state
and provide a way to leave. Do not treat the creator as a special lifetime
owner.

### Join by code from Home

Below the Home page's **Studio** button, add a compact six-digit code input and
a **Join room** action.

- Accept exactly six decimal digits; normalize by trimming surrounding
  whitespace, not by silently removing internal characters.
- Submitting a valid code enters the Studio and joins the room if it is active
  and has a free slot.
- A user who is not signed in is asked to sign in instead of joining.
- An invalid, expired, full, or inaccessible code shows a useful error without
  navigating away.
- If a room closes between code validation and joining, show **Room closed**
  and return the user to Community.
- Joining from the public room list follows the same sign-in, capacity, and
  lifecycle rules as joining by code.

### Join/leave lifecycle

Joining is an atomic server operation: validate room status and access,
reserve a membership slot, and return room state plus short-lived connection
authorization. A room that fills between directory render and click must show
a **Room full** state rather than partially connecting.

Leaving releases the member's controls, closes their room event connection,
and removes their tracks from the collaborative library. If members remain,
the room continues even if its creator has left. When membership reaches zero,
mark the room closed, invalidate its code, discard ephemeral state, and end
its room stream.

If a user opens a room that has just ended, show a **Room closed** message and
provide a clear return to Community. Do not leave the user on a dead Studio or
attempt to reconnect indefinitely.

### Leaving while controlling a control

The server releases all control leases owned by a member as part of disconnect
and leave cleanup. If the connection is lost without a clean leave, leases
expire after a short server-enforced timeout. Other members can then control
those controls.

## Shared Studio and control model

### Shared state and ordered events

Reuse the typed, serializable action model, server-assigned sequence numbers,
snapshots, and viewer playout concepts from
[`streaming-sessions.md`](./streaming-sessions.md). Extend the event envelope
to include the authenticated member identity and room ID. Room actions are
multi-writer: the server authenticates the member, validates the action, and
assigns a total room sequence before relaying it to every member.

All clients apply the same ordered shared-state reducer. Joining and
reconnecting clients receive a current snapshot followed by events after that
snapshot's sequence. Reject actions from users who are no longer members and
actions that violate control ownership.

### Exclusive control leases

Knobs, sliders, and platters are independently lockable controls. A member
acquires a control lease on pointer/touch/keyboard interaction start. While
the lease is held:

- The owner may send its continuous updates.
- Other members see the control as in use and cannot change it.
- The server rejects updates from non-owners, even if their UI is stale.

Release the lease on pointer/touch release or cancellation, keyboard
interaction completion, explicit leave, and connection loss/lease timeout.
Lease acquisition is atomic at the server. The UI should indicate another
member's ownership and avoid optimistic movement for a rejected input. Button
presses and non-continuous actions must also be serialized; define per-action
locking where they manipulate a held control.

### Remote input prediction and smoothing

A member's input reaches the other members only after a network delay. This
delay is accepted, and it is not hidden by scheduling actions in the future.
Instead, each client predicts the state of other members' inputs until the
events arrive:

- A continuous control held by another member (knob, slider, platter) is
  extrapolated from that member's recent events and smoothly interpolated
  toward each new authoritative value, so it does not jump.
- Playheads are extrapolated from the last known position, rate, and the time
  they apply, following the streaming spec.
- The server-sequenced state stays authoritative. When a prediction differs
  from an arriving event, the client blends toward the event's value instead of
  snapping to it.

The extrapolation horizon and how fast corrections blend in are settled in the
prototype (see Open decisions).

### Shared track library

The collaborative library is the union of tracks contributed by current room
members. Every item retains its contributing member identity. When a member
leaves, remove that member's tracks from the room library immediately and
revoke room-scoped access to their track metadata/audio.

Expose only the track data needed by room members, using short-lived,
room-authorized audio access. Do not make a member's private library public or
available to non-members. A member must not be able to use room membership to
access another room's tracks.

If a departing member's track is loaded on a shared deck, eject it when that
member leaves so the room does not retain use of removed library content.
Synchronize the resulting deck state as a room event.

## Room streaming and synchronization

A room broadcast reuses the existing read-only stream viewer, LiveKit audio
delivery, and event relay. Room events are the canonical serialized control
history; viewers receive a snapshot and then room events. The room stream
entry uses the current room member stack and the room join code described
above.

Any current member can start or stop the room's stream. Starting or stopping
it does not change room membership or visibility, and stopping it does not
close the room.

Room members run local audio engines, so their rendered output and clocks can
differ. Do not treat any member's unsynchronized local state as the canonical
timeline. The room event service assigns sequence numbers and server receive
times; clients include their local media-clock timestamp and clock-sync
measurements. Stream viewers buffer sequenced room events and interpolate
continuous values/playheads against the broadcast audio timeline, following
the playout-buffer approach in the streaming spec.

For v0, publish one room audio mix through LiveKit, not one separate stream per
member. Select a connected room member as the audio publisher (the creator is
the initial publisher when present); if that publisher leaves, transfer
publishing to a remaining eligible member without ending the room. If no
member can publish, end the broadcast but keep the room active. The stream
should report reconnecting/degraded audio rather than implying perfect
synchronization. Measure and tune the event/audio offset under rapid controls
and publisher handoff.

The room stream shows the member stack as it exists when the viewer loads (and
may refresh it with directory metadata). A broadcast viewer remains
read-only: only current room members can publish room actions.

## Backend and API design

Suggested authenticated endpoints; exact names may follow the existing
handler/API conventions. All room endpoints and the room event WebSocket
require a signed-in user, and a member's slot is keyed by user ID:

- `POST /rooms` — create public/private room; join creator; return room ID,
  six-digit code, member state, snapshot, and short-lived event/audio
  authorization.
- `GET /rooms` — list active public rooms with safe member identity and deck
  cover metadata.
- `GET /rooms/:id` — return safe active-room metadata for authorized members
  (and public preview fields where applicable).
- `POST /rooms/join` — join by six-digit code.
- `POST /rooms/:id/join` — join a public room from its listing.
- `POST /rooms/:id/leave` — leave and release leases; close the room if this
  was its last member.
- Room event WebSocket — member publishing/subscription, ordered events,
  snapshots, presence, leases, and room-closed notification.
- Existing stream endpoints — support solo streams and room broadcasts;
  starting or stopping a room stream verifies current membership. Viewing a
  room stream follows the same rules as viewing any stream, and the response
  never includes a private room's code.

Persist room identity, code hash or equivalent protected lookup value,
visibility, creator ID, capacity, lifecycle timestamps, and stream reference.
Keep live membership, control leases, snapshots, recent events, and presence
in the room service's live state (or a shared store if the backend is
multi-instance). Closing a room removes it from listings, revokes join
authorization, releases provider resources, and notifies remaining clients.

Generate codes uniformly from the six-digit decimal space, including leading
zeroes (`000000` through `999999`), using a cryptographically secure random
source. Persist only an HMAC-SHA-256 of the code using a server-side pepper of
at least 32 random bytes; do not use an unkeyed hash because the code space is
small enough to brute-force offline. Keep the pepper in server configuration,
never in the database or client. Enforce uniqueness among active rooms, and
clear the stored hash when a room closes so codes are not permanently reserved.
Keep the current pepper stable while rooms are active; rotate it only when
there are no active rooms. Supporting overlapping pepper versions would require
persisting a key identifier and is deferred.
Rate-limit creation and failed code joins; use a generic error for codes that
are unknown, private/inaccessible, or already closed to reduce code
enumeration. Enforce member capacity and membership checks on the server, not
only in the UI.

## Error and accessibility states

- Loading auth or room state must not be mistaken for a failed or closed room.
- Communicate room creation, join, full, invalid/expired code, reconnecting,
  lease ownership, and closed states in text usable by assistive technology.
- Disable or clearly mark controls leased by another member; provide an
  accessible explanation of who currently controls them.
- On connection loss, show a reconnecting state and stop accepting local
  changes that cannot be ordered. The local audio engine keeps playing the
  last known state during the disconnect; it does not pause or go silent. After
  reconnect, restore from a snapshot.
- Never silently fall back to solo control after room connection failure.

## Open decisions

1. **Discrete actions and conflicts.** Decide whether actions are idempotent
   sets (`set deck A playing = true`) rather than toggles, which of them take a
   lease versus last-write-wins (load track, Play/Pause, crossfader), and what
   happens to a button press while another member holds the platter.
2. **Lease timings.** Set the lease timeout, renewal while a control is being
   moved, and a maximum hold time.
3. **Prediction details.** Set the extrapolation horizon and blend speed, and
   decide how a client reconciles when a snapshot differs a lot from what it
   has been playing, such as after a long disconnect.
4. **Track sharing.** Decide whether joining exposes a member's whole library or
   only chosen tracks, whether other members get playback-only access, and how
   clients confirm a track is loaded before Play.
5. **Room stream details.** Decide which member publishes audio when a member
   other than the creator starts the stream, who names the stream, who sees its
   viewer count, and whether stream viewers read the room's event channel
   directly or through a separate stream session.
6. **Same user in several tabs or devices.** Decide whether a second tab takes
   over, is rejected, or only spectates, and whether a user can be in only one
   room or stream at a time.
7. **Disconnect versus leave.** Decide whether a short reconnect grace period
   applies before the last member's disconnect closes the room and its code,
   and what a backend restart does to active rooms.
8. **Moderation and code limits.** Decide how members remove a disruptive
   stranger from a public room, and set concrete rate limits for code guessing.
9. **Community access.** Decide whether browsing Community requires sign-in
   (still open in the streaming spec).
10. **Streaming spec sync.** `streaming-sessions.md` still says "Streams" for
    the directory and the ended toast's "Back to Streams"; update it to
    Community and `/community`.

## Acceptance criteria

- Community displays live streams and public rooms in distinct lists with
  independent loading, empty, and error states.
- Solo stream entries remain usable; room stream entries show overlapping
  member avatars, one-line truncated usernames, and two deck covers, plus the
  room code for public rooms only.
- Public room entries show current users, the two deck covers, and available
  capacity; private rooms never appear in public results.
- Room creation from Studio supports public/private visibility and returns a
  unique six-digit code; the creator is joined as a member.
- Only signed-in users can create or join rooms. A user can join by code from
  Home or join a public listing; invalid, closed, inaccessible, and full rooms
  produce clear errors.
- V0 allows at most two concurrent users and rejects an additional join
  atomically. A user with several tabs occupies one slot. The room
  schema/protocol does not assume exactly two members.
- Either member can leave; the creator leaving does not end an occupied room.
  The last member leaving closes it and ends any room stream.
- Current members see a union of their libraries. A departing member's tracks
  disappear and their loaded tracks are ejected; room-scoped access is revoked.
- A held knob/slider/platter is exclusively writable by its lease owner;
  release, disconnect, and leave make the control available again.
- Other members see a held control move smoothly through extrapolation and
  interpolation instead of jumping when events arrive.
- Members converge on server-sequenced state after reconnect, and local audio
  keeps playing the last known state during a disconnect.
- Any current member can start and stop the room stream. A private room can be
  streamed, and neither its listing nor its stream page exposes its code.
- Viewers of a room stream receive ordered room state and synchronized audio
  as well as the correct room identity.
- Opening an ended room shows **Room closed** and returns to Community.

## TODO

Work in order unless an item is blocked. Check items off as implementation
progresses.

### Decisions and compatibility

- [ ] Decide whether discrete room actions are idempotent sets or toggles, and
      define conflict behavior for track loads, transport, crossfader, and
      actions targeting a leased control.
- [x] Choose the control lease expiration timeout, renewal cadence, and maximum
      hold duration. Configured as constants: LeaseTimeout=30s, LeaseRenewalCadence=10s,
      MaxLeaseHoldTime=5min, ExtrapolationHorizon=2s, CorrectionBlendSpeed=200ms.
- [ ] Choose continuous-control extrapolation horizon and correction blend
      speed; define reconciliation after a long disconnect or a large snapshot
      difference.
- [x] Decide whether joining exposes each member's full library or only
      selected tracks, whether shared tracks are playback-only, and how clients
      coordinate track-load readiness with transport. Decision: whole library,
      room-scoped signed URLs for S3 access.
- [x] Decide who names a room stream, how viewer counts are shown, and whether
      stream viewers consume the room event channel or a separate stream
      session. Decision: any member can start/stop, viewer counts shown, member
      identity shown in stream list.
- [ ] Define behavior for the same signed-in user opening a room in multiple
      tabs/devices, and whether the user can participate in more than one room
      or stream at once.
- [x] Choose disconnect grace period, room behavior during backend restarts,
      public-room moderation/removal behavior, and concrete creation/code-join
      rate limits. Decision: no grace period, no rate limiting, no moderation in v0.
- [ ] Decide whether Community browsing requires sign-in and record the
      decision consistently in the route/API behavior.
- [x] Prototype creator-first room audio publishing and handoff. Verify LiveKit
      permissions, audio continuity, publisher departure, and a different
      member starting the stream; update the room-stream policy if the
      prototype changes the design. Implemented: any member can start, handoff
      on publisher departure, stream ends if no members remain.
- [x] Update `streaming-sessions.md` terminology, navigation destination, and
      ended-stream action to Community and `/community`; ensure solo streams
      remain compatible with room broadcasts.

### Room persistence and lifecycle backend

- [x] Define room, membership, visibility, lifecycle, and stream-reference
      types; represent members as a collection and capacity as data (v0 value
      two) rather than fixed member fields.
- [x] Add database migration(s) for room identity, creator, visibility,
      capacity, lifecycle timestamps, protected code lookup, and stream
      association.
- [x] Implement six-digit code generation using a uniform decimal-space
      selection, including leading-zero codes.
- [x] Add required server configuration for the room-code HMAC pepper; fail
      closed for room creation/join if it is missing or shorter than 32 bytes,
      and document secure provisioning/rotation. Generate it with
      `openssl rand -hex 32`; invalid configured values fail startup, and the
      room code helper rejects missing/short peppers. Rotate only with no
      active rooms.
- [x] Enforce uniqueness among active codes atomically and safely allocate a
      replacement after collision; release code availability when a room
      closes by clearing its unique code hash.
- [x] Add PostgreSQL integration tests for concurrent code allocation,
      collision retries, atomic creator membership, and code reuse after room
      closure.
- [x] Implement room creation that validates signed-in identity and visibility,
      creates the room, reserves the creator's membership slot, and returns
      safe room metadata.
- [x] Add signed-in `POST /rooms` creation endpoint with public/private
      visibility, v0 capacity, one-time creator invite code, and fail-closed
      behavior when the code pepper is unavailable.
- [x] Implement atomic join-by-code with exact six-digit validation,
      active/access checks, same-user idempotence, capacity enforcement, and
      generic errors for inaccessible/unknown/closed codes. Code lookup errors
      share one response; malformed input is rejected before lookup.
- [x] Implement atomic join-by-public-room-ID with active/public checks and the
      same per-user slot and capacity rules.
- [x] Implement persistent membership leave with idempotent repeated leave,
      including a retry after the room closes; creator departure has no special
      behavior.
- [x] Close the room atomically when its final distinct user leaves; invalidate
      its code and remove it from discovery.
- [x] Release live control leases, remove shared tracks, and end any associated
      room stream when a member leaves or a room closes.
- [x] Notify connected room members when a member leaves or the room closes.
- [x] Handle disconnect grace/heartbeat expiry according to the chosen policy;
      clean up membership and live resources when the final connection expires.
      Decision: no grace period in v0.
- [ ] Implement active-room startup/restart cleanup and provider-resource
      reconciliation according to the chosen recovery policy. Current relay
      snapshots, sequence history, and tickets are process-local and are lost
      on restart; run one backend instance until shared relay storage and
      cross-instance ticket handling are implemented.
- [x] Add authenticated `GET /rooms` returning active public room metadata,
      current member identities, occupancy, and deck-cover placeholders. The
      payload intentionally has no room-code field.
- [x] Add authenticated join-by-code, join-by-public-ID, and leave endpoints.
- [x] Add authenticated safe room metadata endpoint. Public room metadata is
      available to signed-in users; private metadata is member-only. Responses
      never include the join code.
- [x] Ensure directory and error responses never disclose private-room codes;
      allow current members to retrieve their invite code only through an
      authorized response. Create and join responses include the live invite
      code; the public list/get payloads still omit it. The plaintext code is
      kept only in the process-local room manager for the active room.
- [x] Add rate limits for creation and failed code joins; verify generic
      failures do not reveal room existence or visibility. Decision: no rate
      limiting in v0.
- [x] Add unit tests for code validation/leading zeros, room model defaults,
      pepper handling, and room service create/list/join/leave validation.
- [ ] Add PostgreSQL integration tests for code collisions, concurrent joins,
      capacity races, same-user multi-tab membership, full rooms, creator
      leave, last-member close, stale codes, and duplicate cleanup.

### Room event relay and shared-state protocol

- [x] Extend the serializable event envelope with room ID and authenticated
      member attribution; keep server-assigned sequence numbers and validate
      all client-provided fields. Attribution comes from a short-lived,
      single-use ticket issued only after a successful authenticated create or
      join; client messages cannot supply identity or sequence fields.
- [ ] Define room join and reconnect messages, including a snapshot version,
      last sequence, current members, and current control leases. The relay's
      current `joined` message only includes the latest Studio snapshot and
      sequence; join responses separately include safe member metadata.
- [x] Implement ticket-authenticated room event connections; only authenticated
      room create/join responses issue tickets, and a leave revokes the member's
      outstanding tickets and active connections.
- [x] Relay validated snapshots and Studio actions in one server-assigned total
      order to connected members; reject unattached publishers, malformed,
      oversized, unknown-field, and over-rate messages.
- [x] Keep one bounded current snapshot and up to 200 recent actions; joining
      connections receive the snapshot followed by actions newer than its
      sequence.
- [x] Send member-left and room-closed notifications; detach individual
      disconnected connections. Member presence and multi-tab connection
      counts remain to be designed.
- [x] Test concurrent publishers, server event ordering, snapshot recovery,
      unauthorized publishing, and room closure notifications. Unit tests
      also cover scoped single-use tickets, action/snapshot validation,
      attribution, and leave/close ticket revocation.
- [ ] Decide whether retrying a client action should be deduplicated; room
      messages currently have no client event ID, so each accepted retry gets
      a new server sequence.

### Studio creation, joining, and membership UI

- [x] Add typed frontend API wrappers for room create, join-by-code,
      join-by-public-ID, and leave operations.
- [x] Return the room event URL and short-lived event ticket from create and
      join responses, ready for Studio connection setup.
- [x] Add the **Collab** top-bar action and accessible modal with public/private
      visibility selection, create/cancel actions, pending state, and visible
      error handling.
- [x] Connect successful room creation to the room event session before
      presenting the Studio as collaborative; preserve solo mode and report an
      actionable error if creation or connection fails.
- [x] Add an in-room member indicator and display visibility plus the six-digit
      invite code to members; provide an accessible copy-code action.
- [x] Add a leave-room action and confirmation/unsaved-state behavior if
      required by the Studio's existing navigation safeguards.
- [x] Add six-digit input validation on Home: trim surrounding whitespace,
      reject internal spaces/non-digits, constrain length, and label the
      field/action accessibly.
- [x] For signed-out Home submissions, route to sign-in without attempting a
      room join; preserve the code only if the authentication flow can do so
      safely.
- [x] Join by code from Home and by room ID from Community; handle invalid,
      closed, full, inaccessible, and connection-failure responses distinctly.
- [x] Show **Room closed** and return to Community when a room ends during
      navigation or while the Studio is open.
- [ ] Test create/cancel/retry, auth transitions, malformed codes, full/stale
      rooms, and browser back/navigation while in a room.

### Community directory

- [x] Rename the navigation label to **Community**, add `/community`, and
      preserve `/streams/:streamId` for the stream viewer.
- [x] Move the existing active-stream directory to the Community page without
      changing solo stream list/join behavior.
- [x] Add independent loading, error, retry, and empty states for the Live
      streams and Public rooms lists.
- [x] Add public room list API integration and bounded polling. Stale-entry
      join handling depends on the not-yet-implemented join flow.
- [x] Build overlapping member avatars with stable member ordering and a
      fallback avatar; current schema allows future member expansion.
- [x] Render member usernames on one truncating line and retain the full
      names in a title and accessible group label.
- [x] Populate room deck-cover snapshots from shared Studio state; the current
      directory safely renders null-cover fallbacks.
- [x] Show room occupancy/capacity in public room cards.
- [x] Add a **Join room** action; disable or explain joining when the room is
      full. Joined rooms connect to the room event relay and hydrate from the
      current snapshot; shared library access is still pending.
- [x] Keep join codes out of public room cards and the public-room list API.
- [x] Render a room code on public room-stream entries only, and verify no
      private code appears in cards, accessibility labels, links, API payloads,
      errors, or browser logs.
- [x] Render room-stream entries with member identity, deck covers, and public
      code only; preserve the existing solo-stream presentation.
- [x] Verify independent refresh, duration/state updates, empty states, and
      navigation when a directory item becomes stale.

### Collaborative track library

- [x] Define the room track item shape, including contributing member identity
      and the minimal metadata required by the Studio picker.
- [x] Build the library union from current members' tracks without changing
      their personal library ownership or visibility.
- [x] Add short-lived room-authorized metadata/audio access and verify access
      fails for non-members, former members, and members of other rooms.
- [x] Update the room track picker to show the shared library and identify each
      contributing member.
- [x] On member departure, remove their tracks from the shared library and
      revoke outstanding room-scoped access.
- [x] On member departure, detect their loaded tracks, eject them, stop/release
      corresponding audio resources, and publish the resulting deck events.
- [x] Test duplicate track membership, simultaneous member leave/load, expired
      audio access, and loaded-track removal from every connected client.

### Control leases and remote interaction

- [x] Inventory all continuous Studio controls and assign stable control IDs
      for knobs, sliders, platters, and any other exclusive inputs.
- [x] Define interaction start/update/end/cancel events for pointer, touch, and
      keyboard input; ensure lost pointer capture still releases the control.
- [x] Implement atomic server-side lease acquire, renew, and release with the
      chosen timing rules and member ownership.
- [x] Release all of a member's leases on explicit leave, membership removal,
      or connection timeout; broadcast lease state changes.
- [x] Reject updates from non-owners at the server and prevent stale clients
      from optimistically changing the visible control.
- [x] Show disabled/in-use state and the controlling member's identity in the
      UI with accessible explanatory text.
- [x] Define serialization/locking behavior for discrete transport, load,
      eject, and button actions that conflict with held controls.
- [x] Test simultaneous lease races, pointer cancel/release, keyboard
      completion, disconnect expiration, stale ownership UI, and attempts to
      submit updates after lease loss.
- [x] Implement bounded extrapolation for remote continuous controls and
      playheads using recent authoritative events.
- [x] Interpolate toward arriving authoritative values and blend corrections
      instead of snapping; ensure prediction never becomes server authority.
- [ ] Keep local audio running from the last known shared state during
      disconnect; stop accepting changes that cannot be ordered and recover
      from a snapshot after reconnect.
- [x] Test delayed, jittered, reordered, and missing events plus large
      post-reconnect state corrections.

### Room broadcasts and playout

- [x] Let any current member start/stop the room stream; enforce membership on
      both operations and keep stream lifecycle separate from room membership.
- [x] Associate the broadcast with room state and expose a safe stream
      directory representation without private room codes.
- [x] Select an eligible audio publisher and create room audio publication
      authorization without exposing provider secrets to clients.
- [x] Implement publisher handoff when the current publisher leaves or loses
      connection; end the stream but keep the room active if no publisher is
      available.
- [x] Reuse the view-only Studio stream page for room broadcasts, subscribing
      viewers to ordered room state and the room's single audio mix.
- [x] Show room member identity in the stream list and preserve the policy:
      public room code may display; private room code never displays.
- [ ] Show explicit starting, live, reconnecting/degraded, ended, and failed
      audio states for room broadcasts.
- [ ] Measure clock offset and event/audio timing across clients and the chosen
      publisher; tune buffering for transport, continuous controls, and
      publisher handoff.
- [ ] Verify private-room streams remain watchable according to stream policy
      without granting room membership or exposing the join code.

### End-to-end validation and rollout

- [ ] Add an end-to-end happy path for creating a public room, joining as the
      second signed-in user, sharing a track, controlling each other's decks,
      and leaving cleanly.
- [ ] Add an end-to-end private-room path covering invite by code, absence from
      public rooms, and code secrecy in the stream list/page.
- [ ] Verify a third user is rejected atomically in v0 and that member,
      avatar, event, and library data structures still support a future cap of
      three.
- [ ] Verify creator departure leaves an occupied room running and the final
      member leaving closes the room, releases provider state, and invalidates
      its code.
- [ ] Verify disconnect grace, restart recovery, same-user tabs, and stale
      directory entries follow the resolved policies.
- [ ] Verify lease enforcement, release, extrapolation/interpolation, and
      local audio continuity under realistic latency and disconnects.
- [ ] Verify member track access is revoked on leave and no private library or
      audio is available to non-members.
- [x] Verify any member can start/stop a room broadcast and test publisher
      departure, handoff, degraded audio, stream end, and viewer teardown.
- [ ] Run backend unit/integration tests, frontend type-check/lint, and browser
      checks for auth, responsive layouts, accessible states, and room/stream
      navigation.