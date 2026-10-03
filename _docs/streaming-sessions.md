# Streaming Sessions

Feature spec for live, watch-only DJ studio sessions. Show active streams in
the Community directory, let a viewer open an active stream, and show the
streamer's studio rebuilt from the streamer's control events, with the
streamer's audio.

Viewers do not receive video. The streamer's client sends a stream of control
events, the backend sequences and relays them, and each viewer renders a
read-only Studio from those events. Audio travels separately as an audio-only
WebRTC track. Collaboration (multiple users controlling the same decks) is not
part of this spec, but the event pipeline is designed so collaboration can
reuse it later.

This is not a video recording. Control events and short-lived state snapshots
exist only to render an active stream for current viewers; the server discards
them when the stream ends. LiveKit carries only the streamer's mixer audio.

## Goals

- Replace the **Skills** navigation item and placeholder page with
  **Community**, including a live streams list.
- List active streams with the streamer's username and profile picture, stream
  name, and elapsed duration.
- Let a viewer open a stream from its list entry.
- Present a watch-only version of the Studio page: the streamer's controls,
  pointer, and popups are reproduced from events and the streamer's audio is
  heard, but the viewer cannot interact with the studio.
- Clearly distinguish a stream from the local Studio with a gradient border.
- Show a stream-specific top bar with a home button, streamer identity,
  stream name, and elapsed duration. Do not show recording controls.
- Give the streamer a **Stream** button in the Studio top bar that becomes
  **Stop streaming** while live, with the current viewer count and an eye icon
  next to it.
- When a streamer ends the stream, show spectators a toast with an option to
  go back to the Community directory. Do not navigate them away automatically.
- Build the event model (serializable actions, server-sequenced log,
  snapshots) so collaboration can reuse it later.

## Non-goals

- Collaboration or b2b sessions. Only the stream's owner can send events.
- Recording or replay of streams. Streams are live sessions only.
- Server-side audio rendering. This is a possible later upgrade (see
  "Audio and synchronization").
- Peer-to-peer event delivery. Events go through the backend.

## User experience

### Community directory: live streams

The `Community` navigation item and `/community` route contain a live streams
list (and may contain other community lists as they are implemented). Keep
`/streams/:streamId` as the viewer route. The API continues to use `/streams`.

Show only currently open streams. Each list item displays:

- Streamer's profile picture and username.
- Stream name.
- Cover art for the two loaded decks, displayed as a split cover pill across the
  right half of the card. Cover art can be sampled from the latest stream
  snapshot when the directory refreshes; it does not need a live subscription.
- Elapsed duration, derived from the stream start time and refreshed while
  visible.

The entire list item (or its primary content) is a link to that stream. Provide
loading, empty, and error states. An empty state should explain that active
streams will appear here.

The directory must update when streams start or end. Prefer a real-time
presence/subscription mechanism; bounded polling is an acceptable initial
fallback if no real-time infrastructure is available. A stale list entry must
not leave a viewer stuck: opening a session that has already ended shows the
ended toast described below.

### Starting and ending a stream

The control lives in the Studio top bar, alongside the existing home and
recording controls.

| State | Control | Behavior |
| --- | --- | --- |
| Not streaming | **Stream** | Prompts for a stream name, then starts publishing events and the mixer audio. |
| Live | **Stop streaming** + eye icon + viewer count | Ends the session and stops publishing. The eye icon and count sit next to the button and update while live. |

- Clicking **Stream** prompts for a stream name (the directory needs one),
  then starts the session. No screen-share or microphone permission is needed,
  because the audio comes from the mixer engine and the visuals are rebuilt
  from events. If starting fails (session creation, event connection, or
  audio publication), stay in the **Stream** state and show a visible message.
- While live, the control reads **Stop streaming**. The eye icon and viewer
  count appear next to it and are removed when the stream ends.
- The viewer count is the number of distinct users currently watching the
  stream. A user with the stream open in several tabs counts once. It updates
  as viewers join and leave, without a page refresh. It shows `0` when nobody
  is watching.
- The control must communicate its state to assistive technology, not only
  through color or the icon. For example, the button's accessible name or an
  adjacent label includes the viewer count (such as "3 viewers"), and the eye
  icon is not the only way the count is conveyed.
- Show a clear **Live** state in the Studio while a session is active.
- If the streamer navigates away, closes the tab, or loses the publishing
  connection, mark the session ended and remove it from the open-stream
  directory. Do not leave a permanent "open" session.

The exact stop confirmation and whether navigation away should warn or end the
stream need confirmation (see Open decisions).

### Watch-only stream page

Opening an item navigates to a route such as `/streams/:streamId`. Render the
Studio composition in a viewer layout: stacked A/B waveforms above the two
decks and center mixer, inside a visible gradient frame. This is the same
Studio composition the streamer uses, driven by replicated state instead of
local input.

The viewer page is display-only:

- All Studio controls are noninteractive and not keyboard-operable. Viewer
  input never produces an event, and the server would reject it anyway.
- The streamer's pointer is drawn as a remote cursor overlay positioned from
  the streamer's pointer events. Coordinates are normalized to the Studio
  content area, so the position is approximate when the viewer's window size
  differs from the streamer's.
- Popups and menus the streamer opens are shown according to the state model
  (see Open decisions).
- The viewer's Studio is not connected to an audio engine. Viewers hear the
  streamer's audio track, never sound generated locally from replicated state.

Use a dedicated top bar containing:

- A home button that returns to the Community directory.
- Streamer's profile picture and username.
- Stream name.
- Elapsed stream duration, consistent with the directory.

Do not show the Studio recording button, the streamer's Stream / Stop
streaming control, or local transport controls. Viewers see only this stream
top bar.

**When the stream ends:** if the streamer ends the stream (Stop streaming,
leaving the Studio, closing the tab, or losing the publishing connection past
the reconnect timeout), each spectator's client stops audio playback, closes
the event and audio connections, and stops updating the Studio. It then shows
a toast saying the stream has ended, with a **Back to Community** action that
goes to `/community`. Spectators are not navigated away automatically; they can
also use the top bar's home button. The directory should no longer list the
ended stream. How long the toast stays and what the Studio view shows
afterward are open (see Open decisions).

**When the stream is still live but the viewer cannot receive it** (for
example the viewer's own connection fails), show a connection-error state with
a retry action and a link back to Community. This state is not used for ended
streams.

### Viewer lifecycle

- Joining must not start audio until the viewer has made any browser-required
  user gesture. If playback is blocked, show an explicit **Play stream** action.
- On joining, the viewer receives the current Studio state and then live
  events, so a viewer who arrives mid-set sees the decks as they are now.
- On leaving the stream route, stop playback and close the event and audio
  connections. When a user's last tab on the stream closes, the viewer count
  goes down.
- After a viewer-side disconnect, reconnect, request the state again, and
  resume from the latest events. Do not leave stale visuals, stale audio, or
  an indefinitely spinning loading state. Stream termination shows the ended
  toast described above.
- Support multiple viewers without exposing the streamer's private app data
  or letting viewers publish control input.

## Event model

Spectating depends on the Studio's state being driven by serializable actions.

- Every Studio change that viewers should see is an action handled by one
  store and reducer. The streamer's client publishes those actions as events.
  Viewers apply the same actions with the same reducer code, so the streamer's
  Studio and the viewer's Studio cannot drift apart in how they interpret an
  event.
- The store is separable from the audio engine. On the streamer, state changes
  drive the engine; on a viewer, they only drive the UI.

Event envelope (field names are illustrative):

| Field | Meaning |
| --- | --- |
| `streamId` | The session the event belongs to. |
| `seq` | Monotonic sequence number assigned by the server, not the client. |
| `t` | Timestamp on the streamer's media clock, used to line events up with audio. |
| `type` | The action type. |
| `payload` | Action data. Contains no secrets, URLs to private files, or tokens. |

Event categories:

| Category | Examples | Handling |
| --- | --- | --- |
| Durable state | Transport (play, pause, cue, seek), knob/slider/button changes, EQ and FX parameters, track loaded or ejected, loops, and popup state if mirrored | Sequenced, kept in the recent log and in snapshots. |
| Continuous controls | Slider or knob drags, jog movement | Throttled or coalesced while moving. The final value is always sent. |
| Ephemeral | Pointer position, hover | Best-effort, latest value wins, never kept in the log or snapshots. |

- Transport events carry the position, rate, and time they apply, so viewers
  extrapolate the playhead locally. The streamer does not send a per-frame
  position stream.
- **Snapshots.** A snapshot is the full serializable Studio state at a point in
  the log. A joining or reconnecting viewer gets the latest snapshot and then
  the events after its `seq`. The streamer's client produces a snapshot when
  the stream starts and periodically afterward (who produces snapshots is
  open, see Open decisions).
- The initial shared reducer covers mixer state, loaded deck metadata,
  transport, waveform zoom, track-picker popup state, and ephemeral pointer
  position. Mixer updates also drive the local audio engine; viewers apply the
  same reducer to update presentation only. Durable changes are coalesced and
  sent as sequenced actions, with a full checkpoint each second and immediately
  after loading a track. Pointer updates are relayed separately and are not
  retained in the event log or checkpoints.
- **Content data.** The viewer's decks and waveforms need metadata and waveform
  data for the tracks loaded on the streamer's decks. The client generates
  waveform data and sends it to the backend today, so the backend can serve it
  to viewers under stream authorization; confirm it is stored in a form
  viewers can fetch. Viewers never receive the audio files or the rest of the
  streamer's song pool.
- **Authority.** The server accepts events only from the owner's publishing
  connection for that stream, validates type, size, and rate, and assigns
  `seq`. Viewer connections are read-only: anything a viewer sends is rejected
  and not relayed.

**Later: collaboration.** Collaboration would reuse this envelope, the
sequenced log, snapshots, and the reducer. What it adds is multiple writers,
ordering and conflict rules in the server-side event service, and per-user
attribution on events. This spec only keeps those doors open: server-assigned
`seq`, action-based state, and a single owner-only write check on the server
that can later become a policy.

## Audio and synchronization

Proposed paths:

```text
MixerAudioEngine master output
    -> MediaStreamAudioDestinationNode
    -> WebRTC audio track -> SFU/relay -> viewers

Studio store actions -> event publisher
    -> WebSocket -> backend (validate, sequence, relay) -> viewers' stores
```

- Publish the shared `MixerAudioEngine` master output as an audio-only track
  so viewers hear both decks, mixer processing, and FX. Do not capture
  individual deck elements, and do not use a microphone or tab audio.
- Keep local monitoring unchanged: adding the stream audio branch must not
  alter speaker output volume or mixer routing.
- WebRTC's default Opus settings are tuned for voice. Configure stereo and a
  music-appropriate bitrate, and make sure DTX stays off, either in the
  provider's settings or in the SDP.
- Audio and events travel on different paths with different delays. Any
  buffering delay is acceptable; a control that visibly moves noticeably
  before or after the sound it causes is not. Viewers hold events in a short
  playout buffer so visuals line up with audio. How the offset is set (a fixed
  delay tuned by measurement, or mapping `t` to the audio's playout time) is to
  be settled in a prototype, along with the acceptable offset.
- Show connection quality or reconnecting states where practical.
- Possible later upgrade: the backend's audio engine renders audio from the
  same event log and sends it to viewers. Audio and events would then share
  one timeline, and the streamer would publish no media. This depends on the
  server-side engine existing and is not part of this spec.

## Architecture and persistence

There is no existing WebRTC, WebSocket, or stream-presence infrastructure in
the application. Streaming needs two backend pieces and a media provider:

- **Event relay.** A WebSocket endpoint in the backend that accepts the owner's
  events, validates and sequences them, keeps the latest snapshot and recent
  events, and fans them out to subscribed viewers.
- **Audio delivery.** For more than a very small number of viewers, use a
  WebRTC Selective Forwarding Unit (SFU) or managed equivalent. Direct
  peer-to-peer fan-out makes the streamer's upload grow with each viewer.
  Audio-only fan-out is much cheaper than video, which widens the options.
  Keep media authorization server-controlled; do not put long-lived provider
  credentials in the browser.
- **Session metadata.** Stored in the database.

Persist active-session metadata, at least:

- Stream/session ID.
- Owner/user ID.
- Stream name.
- Started-at timestamp and active/ended state.
- Audio room/publication identifier (or equivalent provider reference), not
  secret join credentials.
- Ended-at timestamp if retained for cleanup/diagnostics.

Elapsed duration is `now - startedAt`; it is not a client-maintained counter.
The directory returns only active sessions. Session status must be reconciled
on streamer disconnect, heartbeat timeout, provider events, and server
restarts so orphaned sessions are not shown as live.

The snapshot and recent-event buffer are live state, held in backend memory (or
a shared store if there is more than one backend instance) and discarded when
the session ends. The bounded event log replays recent state changes only to
current viewers for joining/reconnection; it is not a persistent replay or
recording.

**Viewer count.** The count shown to the streamer is live presence, not a
persisted field, and it counts distinct users, not connections. Each viewer
joins the event WebSocket with their authenticated user identity. Keep a
connection count per user and count a user while at least one of their
connections is alive. Heartbeats remove users who close their last tab or lose
connection. Deliver count changes to the streamer over the same WebSocket. The
count is shown to the streamer; whether it also appears in the directory is
not specified.

**Ending a stream.** When a session ends for any reason, the backend marks it
ended, revokes publication and viewer join credentials, and sends an
end-of-stream message to connected viewers so their clients stop audio, close
connections, and show the ended toast. Viewers must not rely on a media-track
timeout alone to find out.

Suggested API surface (exact paths depend on the chosen media provider):

- `GET /streams` — publicly list active/discoverable sessions, newest first or
  by the selected product ordering.
- `POST /streams` — create a session and return short-lived credentials for
  publishing events and audio.
- `GET /streams/:id` — return safe session metadata and viewer join
  authorization. For an ended or unknown session, return a response the client
  treats as "ended or unavailable".
- `POST /streams/:id/join` — issue short-lived viewer credentials to signed-in
  users or anonymous viewers. Anonymous viewers receive a server-generated
  guest identity; it must not grant owner permissions.
- `POST /streams/:id/end` — end the owner's session and revoke publication.
- A WebSocket endpoint for a stream's events. The owner publishes; viewers
  subscribe, receive the snapshot and events, and are counted for presence.
  Authenticate with a short-lived, single-use ticket, not a long-lived token
  in the URL.
- An endpoint that returns metadata and waveform data for tracks loaded in a
  stream, authorized by stream access rather than by ownership of the track.
- A media-provider flow to publish and subscribe to the audio track.

Enforce owner-only publish/end operations and viewer authorization on every
join. Do not trust client-supplied user IDs, active status, start time, or
provider room IDs. Apply rate limits to session creation, join-ticket
issuance, and event publishing. Decide whether the list and join endpoints
require sign-in or whether streams are public to anonymous visitors.

Streams are live sessions, not recordings. Do not persist or expose a replay
unless that becomes a separately specified feature.

## Security, privacy, and reliability

- Provide a visible live indicator and a reliable way to stop publishing.
- Ensure closing the page and network loss eventually end the session and
  release provider resources.
- Viewers are receive-only. The server enforces this; the UI being disabled is
  not the control.
- Events carry only what viewers need to render the Studio. Do not put access
  tokens, Clerk tokens, AWS credentials, file URLs, or other long-lived secrets
  in events, snapshots, stream metadata, or URLs.
- Viewers can see the Studio state, the titles and metadata of tracks on the
  decks, and their waveforms. They cannot access audio files or the rest of the
  song pool.
- Authorize each viewer through the backend with short-lived join credentials.
  Avoid trusting obscurity of the stream ID as access control.
- Validate event schema, size, and rate on the server, and limit the number of
  concurrent viewer connections per user.
- Handle expired sessions and stale provider rooms through server-side cleanup.

## Open decisions / design risks

1. **Audio delivery.** LiveKit Cloud is selected. Verify the configured
   provider region, music bitrate, quality reporting, and costs before
   production.
2. **Relay hosting and snapshots.** The initial deployment uses one backend
   instance with in-memory event/snapshot state and client-generated
   checkpoints. Add shared fan-out before running multiple backend instances.
3. **Who can watch?** The current directory and join APIs require sign-in;
   streams are discoverable to signed-in users and are not invite-only.
4. **Streamer controls.** The name is prompted after clicking **Stream**;
   **Stop streaming** confirms before ending; leaving the Studio closes the
   publisher connection and the backend ends the stream after a 20-second
   reconnect grace period.
5. **Offline and reconnect policy.** WebSocket heartbeat uses a 60-second
   timeout and the publisher has a 20-second reconnect grace period. Provider
   and process-restart cleanup still need production verification.
6. **Audio start behavior.** The viewer attempts playback on subscription and
   shows a **Play stream** action if the browser requires a user gesture.
7. **Event/audio sync target.** Events include the AudioContext media clock,
   but the playout buffer and acceptable offset have not been measured or
   implemented.
8. **State model.** Mixer/deck metadata/transport/zoom/track-picker state is
   replicated; pointer is ephemeral. Remaining Studio controls, menus, and
   waveform viewport details still need review. Showing loaded deck metadata
   and waveforms is allowed; private audio URLs and the rest of the library are
   excluded.
9. **Viewer count rules.** Distinct signed-in users count once across tabs;
   the streamer's own account is excluded. The count appears only in the
   Studio top bar.
10. **Ended-stream presentation.** Keep the viewer on the frozen Studio and
    show a persistent toast with **Back to Community**. Opening an already-ended
    stream shows an ended state with the same navigation action.

## Agent handoff TODO

Work in this order. Resolve open decisions that affect implementation before
building the corresponding infrastructure.

- [x] **Create the initial shared event model and reducer.** Mixer state drives
      both Studio rendering/audio and the same reducer used by viewers.
      Mixer, deck metadata, transport, zoom, popup, and pointer updates have
      typed serialization; snapshots are checkpoints, not recordings.
- [ ] **Complete state coverage and direct action capture.** Mirror remaining
      Studio-only state and controls, and replace sampled transport/coalesced
      state diffs with complete action coverage where necessary.
- [x] **Choose initial audio delivery and relay hosting.** Use LiveKit Cloud
      and a single backend instance with in-memory snapshots and recent events.
- [x] **Define the initial session lifecycle and access policy.** Signed-in
      viewers only, owner-only publishing, distinct-user viewer counts, stop
      confirmation, and a 20-second publisher reconnect grace period.
- [x] **Replace the Skills navigation and placeholder.** Rename the nav item
      to Community, use `/community` for the directory and
      `/streams/:streamId` for viewers, and build directory loading, empty,
      error, refresh, and elapsed-duration states.
- [ ] **Harden session metadata, relay, and authorization.** Create/start/
      list/join/end flows, short-lived publisher/viewer credentials and
      WebSocket tickets, owner-only event acceptance, read-only viewer
      connections, event validation and rate limiting, snapshot and recent-event
      handling, live viewer-count presence (distinct users) delivered to the
      publisher, and an end-of-stream message. The single-instance relay,
      bounded/schema-checked events, owner/viewer authorization, explicit room
      revocation, and best-effort startup cleanup are implemented; add creation
      and join rate limits, connection limits, and shared multi-instance
      fan-out.
- [x] **Add the initial Studio publisher flow.** Add the **Stream** button,
      viewer count/Live state, action publication, snapshots, and mixer-master
      audio publication. Route exit closes the publisher and starts backend
      disconnect cleanup.
- [ ] **Complete Studio publisher details.** Add complete state/action coverage,
      production quality reporting, and verify behavior under publisher
      reconnects.
- [ ] **Complete the watch-only stream page.** The viewer shares the Studio
      console layout, deck-grid calculation, `CDJ` deck component, track-load
      row, and `Mixer` component in read-only mode, without opening track audio
      or creating a local audio engine. The gradient frame is an overlay, so it
      does not change the Studio console's available dimensions. Streamer page
      exit now ends the session via an owner-only exit ticket, with a server
      guard that ends an existing session before that user can start another.
      Finish remaining popup/state mirroring and teardown/reconnect verification.
- [ ] **Tune event/audio sync.** Viewers now render sequenced state on a
      500 ms delayed timeline, interpolate deck playheads, mixer values, and
      pointer positions between buffered samples, and request the same LiveKit
      audio playout delay. Measure and tune the actual offset across browsers
      and rapid control changes.
- [ ] **Test the complete flow.** Verify concurrent viewers, start/end
      propagation in the directory, elapsed time, a late joiner seeing the
      correct current state, a reconnecting viewer resuming without gaps,
      event/audio sync during rapid control changes, no viewer control input
      accepted by the server, and authorization boundaries. Also verify: the
      viewer count rises and falls as users join and leave (including closing a
      tab abruptly), one user with several tabs counts once, the button
      switches between Stream and Stop streaming correctly, viewers never
      receive audio files or other song-pool data, and all spectators get the
      ended toast (with no leftover audio) when the streamer stops, navigates
      away, or closes the tab.