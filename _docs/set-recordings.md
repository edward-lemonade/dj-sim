# Set Recordings

Feature spec for recording a live studio mix in the browser, saving it to S3,
and managing saved sets from the home page.

## Goals

- Let a user start and stop a recording from the Studio top bar.
- Capture the final rendered mix from every deck and the shared FX return.
- Upload each finished recording to the existing S3 bucket under the
  `recordings/` key prefix.
- Show the user's saved recordings on the home page, with rename, download,
  playback, and delete actions.
- Keep recordings private to their owner through authenticated backend
  endpoints; never expose AWS credentials to the browser.

## User experience

### Studio top bar

Add a recording control alongside the existing home/exit control.

| State | Control | Behavior |
| --- | --- | --- |
| Idle | **Record** | Starts capturing the studio's final audio output. |
| Capturing | **Stop recording** | Stops capture and finalizes the audio file. |
| Saving | **Saving...** | Shown while the completed file is being uploaded and registered. Disable recording actions until the save finishes. |

- The control must communicate its state to assistive technology, not only
  through color.
- Maximum recording duration is **one hour**. At the limit, automatically stop
  capture, finalize, and save the recording just as if the user had pressed
  Stop recording.
- Starting capture may require a user gesture; handle unsupported browser
  audio/encoding capabilities with a visible error.
- Stopping should finalize the recording before beginning the upload. If the
  user exits the Studio while recording, automatically stop and save the
  recording; do not discard it or require a separate confirmation.
- Keep the app in a saving state until finalization, MP3 encoding, upload, and
  metadata creation are complete. Do not silently lose the recording if any
  stage fails.
- When the upload and metadata save succeed, return to **Record**.
- If saving fails, show an actionable error and retain the finalized local
  audio for a retry or an explicit discard. Do not report success or silently
  lose the recording.
- Set the initial title to the date and time the recording started, in the
  user's local time, using `YYYY-MM-DD HH:mm`. Keep the title editable from
  the home page.

### Home page recordings

Add a **Your recordings** section to the home page, separate from the entry
point to the Studio. List the signed-in user's saved sets, newest first.

Each recording row/card includes its editable title, created date, duration
when available, and actions:

- **Rename:** edit and persist the title; show a failure and preserve the
  existing saved title if the update fails.
- **Download:** download the original saved audio with a useful filename.
- **Play:** play and pause the saved audio in the page; indicate playback
  state and handle load/play errors.
- Stop playback when the user leaves the home page.
- **Delete:** ask for confirmation, then remove the recording from storage
  and the user's list. Report failures and keep the item visible if deletion
  fails.

Provide loading, empty, and error states. An empty state should explain that
recorded sets will appear here. Every operation must be scoped to the current
user.

## Audio capture

The studio uses a shared `MixerAudioEngine`. Each deck and the FX rack feed
the engine's master gain, which currently feeds `AudioContext.destination`.
Capture at that shared master output so the recording matches what the user
hears, including both decks, mixer processing, and FX. Do not capture the
individual deck media elements or mix their files after the fact.

Signal path (revised, see "Design decision: MP3 encoding"):

```text
decks + FX -> master gain -> speakers
                         -> AudioWorkletNode (capture) -> Web Worker (WASM LAME, 192 kbps CBR)
                                    |
                                    -> zero-gain GainNode -> destination (keeps the worklet pulled)
```

- Add the capture `AudioWorkletNode` to the master output and start posting
  audio blocks to the encoder worker only after the user clicks **Record**.
- Stop capture on **Stop recording** or at the one-hour limit, flush the
  encoder, and produce one playable/downloadable **MP3** before upload.
- Browser `MediaRecorder` support for MP3 is not generally available, so the
  implementation encodes to MP3 itself (see the design decision below). If
  MP3 encoding is unsupported, show a clear error rather than silently saving
  a different format.
- Persist the final content type as `audio/mpeg` and use the `.mp3` extension.
  No intermediate capture format exists in this design, so nothing else can
  leak into the saved/downloaded file contract.
- Connect the recording branch without changing the existing speaker output
  level or routing. Disconnect/stop its resources when capture ends.
- Support a one-hour recording and size upload limits for the selected MP3
  bitrate accordingly. At 192 kbps, one hour of audio is about 86 MB before
  container/metadata overhead; validate the actual encoder output and backend
  request limits.
- Keep the recording in browser memory only while capturing, finalizing, or
  retrying a failed upload. Avoid duplicate full-file buffers; release local
  chunks and object URLs after a successful save or explicit discard.

## Design decision: MP3 encoding

**Decision:** encode to MP3 in the browser, in real time, with a WASM build of
LAME running in a Web Worker. The implementation uses `mediabunny@1.61.0` and
`@mediabunny/mp3-encoder@1.61.0`. The wrapper is MPL-2.0; bundled LAME is
LGPL-licensed. Status: implemented and short-smoke-tested, but distribution/
attribution obligations and full-hour performance are not yet validated (see
TODO).

### Why not server-side conversion

The usual alternative is `MediaRecorder` to WebM/Opus, upload, then convert
with ffmpeg on the server. It is rejected for these reasons:

- The saved MP3 would be a lossy-to-lossy transcode of audio that was already
  compressed once by `MediaRecorder`.
- Chrome's WebM output often lacks reliable duration metadata, and Safari's
  `MediaRecorder` codec support is inconsistent.
- It adds an asynchronous "converting" stage. The spec requires the app to stay
  in Saving until the MP3 exists, so that stage would need polling and its own
  failure handling on the server.

### Chosen approach

1. An `AudioWorkletNode` taps the master gain and posts Float32 blocks to the
   main thread, which forwards them to the encoder worker. Mediabunny's MP3
   extension runs its WASM LAME encoder in a worker.
   `MediaStreamAudioDestinationNode` and `MediaRecorder` are not used.
2. The encoder produces CBR 192 kbps stereo. Encoded chunks are returned to
   the main thread and held as Blob parts; decoded PCM for the full hour never
   exists in memory, and the MP3 is about 86 MB.
3. The encoder runs at the `AudioContext` sample rate (usually 48 kHz) instead
   of resampling.
4. The one-hour limit is enforced by counting samples in the worklet, not with
   `setTimeout`, because main-thread timers are throttled in background tabs.
5. Duration comes from the same sample count and is sent with the upload.
6. On stop, the worker flushes the encoder and the parts are joined into one
   `audio/mpeg` Blob. That Blob is retained until the upload succeeds and is
   what retry and discard operate on.

The worklet is connected to the destination through a zero-gain `GainNode`
because some browsers do not pull an `AudioWorkletNode` that has no path to the
destination. This does not change what the user hears.

### Backend (Go/Gin)

- Parse the recording upload with a 100 MiB file cap and a 16 MiB in-memory
  multipart threshold, so larger file parts spill to temporary storage rather
  than requiring another full-size heap buffer. The existing S3 `PutObject`
  path accepts the bounded file size.
- Check any proxy/API limits in front of the backend. API Gateway caps payloads
  at 10 MB, and a reverse proxy such as nginx has its own body-size limit.
- Generate the object key on the server. Write the S3 object first, then the
  Postgres row; if the row insert fails, delete the object.

### Relationship to the planned C++/WASM engine

If the mixer moves to C++/WASM, LAME compiles with the same toolchain. The same
core could later render recordings server-side from the event log, which fits
the broadcast design. For v0 live recording, the worklet + LAME path does not
conflict with that direction.

### Open items

- Check the license terms of the chosen LAME build. LAME is LGPL; terms for
  individual wrappers vary.
- Crash recovery (for example, writing encoded chunks to IndexedDB) is
  optional and not required by this spec. It is worth considering for
  hour-long sets.

## Persistence and API

Store recording metadata in the database and audio objects in the existing
configured S3 bucket under `recordings/`. The metadata must associate the
object with its owner and contain at least an ID, title, object key, content
type, duration, and creation/update timestamps. Generate object keys on the
server; do not use a client-supplied key as an authorization boundary.
Recording keys should use `recordings/users/{userId}/{recordingId}.mp3`.

Suggested authenticated endpoints (all require a user session and ownership
checks):

- `GET /recordings` — list the current user's recordings, newest first.
- `POST /recordings/upload` — accept the finalized audio and initial title,
  store it in the existing bucket under `recordings/`, and create its metadata
  record. Ensure a failed metadata write does not leave an untracked object
  behind.
- `PATCH /recordings/:id` — update the title only.
- `GET /recordings/:id/audio` — stream the owned audio for playback, or return
  a short-lived authorized download URL.
- `GET /recordings/:id/download` — provide the owned audio with a download
  filename, or combine this behavior with the audio endpoint using a
  download query/response mode.
- `DELETE /recordings/:id` — delete the owned S3 object and metadata. Report
  errors rather than claiming deletion if either required operation fails.

Use the existing configured S3 bucket and storage client for both tracks and
recordings; keep track keys under their current prefix and recording keys
under `recordings/`. Keep the bucket private and mediate access through the
authenticated backend. Grant the backend identity the necessary object
permissions for the `recordings/*` prefix within the existing bucket; no
separate bucket configuration or startup requirement is needed.

## Confirmed product decisions

- Limit recordings to one hour and automatically stop and save at the limit.
- Exiting Studio while recording automatically stops and saves the recording.
- Use the recording start date/time in the user's local time as its default
  title (`YYYY-MM-DD HH:mm`).
- Stop home-page playback when the user leaves that page.
- Saved/downloaded recordings must be MP3 (`audio/mpeg`, `.mp3`).
- Encode MP3 in the browser (AudioWorklet + WASM LAME in a Web Worker), not
  server-side.
- Store MP3 objects in the existing S3 bucket with the `recordings/` key
  prefix, not a separate bucket.

## Agent handoff TODO

Work in this order, checking off items as completed. Preserve the existing
tracks bucket behavior and do not modify unrelated in-progress work.

- [x] **Inspect the audio engine and tests.** Confirm the actual master/FX
      signal graph and test conventions; capture must be connected after the
      master mix so it contains both decks and FX.
- [ ] **Validate the MP3 encoding path for release.** A short browser smoke
      test produced an `audio/mpeg` upload with MP3 frame sync bytes. Still
      confirm distribution/attribution obligations for the MPL-2.0 wrapper
      and LGPL LAME, and benchmark a full hour of 192 kbps stereo for CPU,
      memory, and output validity in supported browsers. Check any reverse
      proxy limit against the ~86 MB output. Do not decode/buffer a full hour
      as PCM in browser memory.
- [x] **Implement browser capture and MP3 output.** Add the post-mix
      AudioWorklet capture branch and encoder worker, enforce the one-hour
      maximum by sample count, automatically finalize at the limit, produce a
      valid MP3, release resources, and support retry after upload failure.
- [x] **Implement recording controls.** Add Record, Stop recording, and
      Saving... to `StudioTopbar`; expose accessible state, stop/finalize
      behavior, the start-time default title, and visible errors. Exiting
      Studio during capture must automatically stop and save before navigation
      completes.
- [x] **Add recording persistence.** Create recording metadata model and
      owner-scoped list/upload/rename/audio-download/delete endpoints. Keep
      generated S3 keys server-side and avoid orphaned S3 objects or database
      records on partial failures. Store final files as `audio/mpeg` with a
      `.mp3` extension; enforce one-hour duration and 100 MiB upload limits.
- [x] **Use the existing bucket and recording prefix.** Recording S3 keys use
      `recordings/users/{userId}/{recordingId}.mp3` through the existing S3
      client; track operations continue to use their current bucket and keys.
- [ ] **Grant deployment IAM access.** Give the backend identity read, write,
      and delete permissions for `recordings/*` within the existing S3 bucket.
      No new bucket or bucket configuration is required.
- [x] **Build the home-page library.** Add newest-first listing, loading,
      empty, and error states plus rename, download, playback, and confirmed
      delete actions. Use the saved MP3 and stop playback on page unmount.
      Ensure failed operations do not appear successful.
- [ ] **Test the complete flow.** Verify captured output includes both decks
      and FX, a one-hour limit finalizes and saves, exiting Studio during
      capture saves before navigating, the default title reflects recording
      start time, saved MP3 downloads and plays, and upload/encoding/
      metadata/delete errors are surfaced. Verify one user cannot list or
      operate on another user's recordings and home-page navigation stops
      playback.

## Verification so far

- `go test ./...` passes.
- The Vite bundle build passes, including the encoder worker.
- Changed recording UI/API files pass targeted ESLint with the existing
  `react-hooks/set-state-in-effect` rule disabled for two unmodified effects
  in `StudioPage.tsx`; the new recording effect's dependency warning is fixed.
- Browser smoke test: start, stop, MP3 encoding, mocked successful upload,
  and exit-while-recording save-before-navigation all worked. The captured
  multipart body contained `audio/mpeg` and MP3 frame sync bytes.
- Full frontend TypeScript build remains blocked by pre-existing diagnostics
  in `frontend/src/pages/tracks/components/TrackLibrary.tsx` (`Track.addedAt`)
  and `frontend/src/pages/tracks/components/TrackPreview.tsx` (unused
  `beatOffset`); those unrelated files were not changed for this feature.
- Real authenticated API/database/S3 integration, the one-hour duration
  boundary, and deployment IAM/proxy configuration have not yet been verified.