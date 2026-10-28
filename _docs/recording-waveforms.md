# Past Session Waveforms

Design for waveform previews and seekable playback in the Past sessions
recording library. This extends [set-recordings.md](set-recordings.md), which
covers recording capture, MP3 storage, and the original playback controls.

## Goals

- Show each recording's title and metadata above its waveform.
- Put a compact play/pause icon button to the left of the title and waveform.
- Display a playhead and let the user seek by clicking or dragging the
  waveform.
- Keep the recordings list responsive without downloading and decoding every
  recording in the browser.
- Keep audio, waveform data, and playback access private to the recording's
  owner.

## Decision

Generate waveform peak data asynchronously when an MP3 is uploaded to S3,
using a dedicated S3-triggered Lambda. Store the result as a small JSON
sidecar object next to the audio object. Do not generate peaks during a
recording-list request or playback request.

The Lambda should be separate from the existing track analyzer. Waveform
extraction is a different job from BPM/key analysis and should be independently
deployable, observable, and retryable. The existing analyzer can inform the
deployment pattern, but it should not be expanded to process recordings.

The browser should load the sidecar only when it needs to render the waveform.
It should use the existing MP3 as the audio source for playback and seeking;
waveform data is a visualization, not an audio substitute.

## Processing flow

1. The authenticated backend accepts and stores the recording MP3, then saves
   its recording metadata as described in `set-recordings.md`.
2. S3 emits an object-created event for MP3s under the recordings prefix.
   The event invokes the waveform Lambda asynchronously.
3. The Lambda downloads the MP3, decodes it, computes a fixed-size set of
   normalized peak values, and writes a JSON sidecar to S3.
4. If configured, the Lambda reports completion or failure to an authenticated
   backend webhook. Otherwise, the backend discovers the sidecar (or failure
   marker) through its periodic S3 polling loop.
5. The recordings API includes that state in the list response. The client
   shows a waveform loading state while pending, displays peaks when ready,
   and offers a retryable or explanatory state if processing failed.
6. A user-authorized waveform endpoint returns the sidecar data, or a
   short-lived, owner-scoped URL to it. Do not expose bucket credentials or
   unrestricted object URLs to the browser.

Use the recording's generated S3 object key to associate the event and
webhook result with its database row. S3 event notifications are at-least-once
and may arrive more than once or before downstream work finishes: processing
must be idempotent, and retries must safely overwrite the deterministic
sidecar key. A failure result should also be safe to repeat.

The backend should mark a recording `pending` when its row is created. A
webhook, when configured, marks it `ready` after the sidecar is stored or
`failed` after processing fails. Without a webhook, the backend polls S3 for
the `.waveform.json` sidecar and `.waveform-status.json` failure marker and
updates the state accordingly. The UI refreshes pending recording metadata
while generation is in progress. Do not store raw exception details for users
or treat a missing sidecar as a successful empty waveform. Any webhook must
authenticate the Lambda and validate that the reported recording key belongs
to a known recording.

## Implemented API

- `GET /recordings/:id/playback-url` returns a short-lived URL only after
  looking up the recording for the authenticated owner. The S3 object stays
  private; the URL expires after two hours and supports S3 byte-range reads.
- `GET /recordings/:id/waveform` returns the validated version 1 sidecar only
  for its owner. The endpoint returns a conflict while processing is not
  ready.
- `POST /recordings/:id/waveform/retry` queues a retry only when the owner's
  recording is in the failed state.
- `POST /internal/recordings/waveform` accepts authenticated `complete` or
  `failed` callbacks from the waveform Lambda. This callback is optional;
  backend polling of S3 sidecars is the fallback.

## Waveform data

Use compact min/max peak pairs over evenly sized time windows, normalized to
the audio's amplitude range. Each pair preserves prominent positive and
negative transients better than a single average value. Keep the peak count
bounded regardless of recording duration so list rendering and sidecar
downloads remain inexpensive.

Version 1 uses 2,048 min/max pairs. The Lambda downmixes to mono at 8 kHz and
aggregates samples across evenly sized time windows. Each peak is a JSON
number in the range `[-1, 1]`. The sidecar includes the version, decoded
duration, and peak data:

```json
{
  "version": 1,
  "durationSeconds": 184.25,
  "peaks": [[-0.42, 0.38], [-0.71, 0.66]]
}
```

The displayed peak pairs above are abbreviated for readability; production
sidecars contain exactly 2,048 pairs. If resolution changes later, use the
version field to support a compatible client migration. Avoid including
decoded PCM or audio samples in the sidecar.

Use a deterministic sidecar key derived from the MP3 key, for example
`recordings/users/{userId}/{recordingId}.waveform.json`. Keep it in the
existing bucket and protect it with the same owner-scoped access policy as the
recording audio. Delete the sidecar when its recording is deleted.

## Player behavior and layout

Each recording row should have this structure:

```text
[play]  Title
        Created date · Duration
        [waveform with seekable playhead]
```

- The play/pause control is an icon-only button on the left, with an
  accessible label and visible focus state.
- The title and metadata sit above the waveform.
- The waveform communicates loaded, pending, and failed states without
  implying that unavailable peaks are a valid silent recording.
- The playhead follows the audio element's current time and progress.
- Clicking or dragging the waveform updates the audio element's `currentTime`.
- Keep one active player at a time, preserve existing playback error
  reporting, and stop playback when the user leaves the page.
- Support keyboard seeking and expose an accessible label/value for the
  waveform seek control; pointer dragging must not be the only way to seek.

## Seekable audio delivery

The current home-page playback flow fetches the complete audio as a Blob before
starting playback. Replace that path for the player: downloading the entire
recording prevents efficient startup and does not provide the normal
range-based seeking behavior expected for long audio.

Use an authenticated, owner-scoped audio URL that supports HTTP byte-range
requests and returns correct `206 Partial Content`, `Content-Range`, and
`Accept-Ranges` behavior. Options are:

1. Extend the backend audio endpoint to support range requests while streaming
   the requested byte range from S3.
2. Have the authenticated backend issue a short-lived, owner-authorized
   presigned S3 URL and use it as the audio element source, after verifying
   the bucket's access and CORS configuration for range requests.

Do not use the download endpoint for playback, expose a permanent public URL,
or put AWS credentials in the client. Keep the separate download action
working as an authenticated file download.

## S3 and deployment notes

- Add a `.mp3` notification filtered to the recordings key prefix.
- S3 permits one bucket notification configuration per bucket. Compose this
  trigger with the existing track-analyzer notifications in the same bucket
  notification resource; do not introduce a competing resource that replaces
  the track notifications.
- Grant the waveform Lambda only the permissions it needs to read recording
  MP3 objects and write waveform sidecars (and invoke the backend webhook if
  configured).
- Ensure recording deletion removes both the MP3 and its waveform sidecar.
- Deploy the Lambda and backend state/webhook changes independently from the
  existing track analyzer where practical.

## Existing recordings and rollout

Run a one-time backfill for recordings already in S3. Make the backfill
idempotent and rate-limited; it should use the same processing path and state
transitions as new uploads. The UI should remain usable while older recordings
are pending or failed.

## Agent handoff TODO

Work in this order. Preserve existing track analysis and recording behavior;
check off items only after implementation and verification.

- [x] **Define the waveform contract.** Version 1 stores 2,048 min/max pairs
  from mono 8 kHz decode output in a deterministic `.waveform.json` sidecar.
- [x] **Add recording processing state.** Persist `pending`, `ready`, or
  `failed` on each recording. Set new recordings to `pending`, include the
  state in the owner-scoped recording list, and retry failed jobs only.
- [x] **Implement waveform generation.** Create a dedicated Lambda that reads
  recording MP3s, computes bounded normalized min/max peaks, and writes the
  deterministic sidecar. Make duplicate events and retries idempotent and
  clean up temporary files.
- [x] **Wire completion and failure reporting.** Add an authenticated backend
  webhook that validates the recording key, updates processing state, and
  stores only safe error information. The Lambda reports completion/failure
  and retries temporary backend failures.
- [x] **Configure S3 and IAM.** Add a recording-prefix `.mp3` S3 notification
  to the existing bucket notification resource without replacing track
  notifications. Grant the Lambda narrowly scoped read/write permissions.
- [x] **Add private waveform retrieval and cleanup.** Implement an
  owner-scoped API endpoint for peaks. Delete the sidecar when its recording
  is deleted, and surface storage failures rather than silently leaving
  orphaned data.
- [x] **Backfill existing recordings.** Add a rate-limited, repeatable job for
  recordings without waveform data. It supports `--force` to recover when a
  sidecar exists but its completion callback failed. S3 polling also updates
  state when no completion callback URL is configured.
- [x] **Make playback range-seekable.** Replace full-Blob playback with
  short-lived, owner-authorized presigned S3 URLs. The authenticated download
  behavior remains separate.
- [x] **Build the waveform player UI.** Put an icon-only play/pause button on
  the left, with title and metadata above the waveform. Add loading, pending,
  ready, and failure states; synchronize the waveform playhead with audio;
  support click, drag, and keyboard seeking; stop playback on page exit.
- [ ] **Verify end to end.** Test new uploads, duplicate events, retries,
  failures, backfill, private access, byte-range seeking, playhead updates,
  keyboard operation, and deletion of active recordings and sidecars.
- [ ] **Deploy and monitor.** Optionally configure
  `BACKEND_ANALYSIS_WEBHOOK_URL` and `BACKEND_WAVEFORM_WEBHOOK_URL`; without
  them, rely on backend S3 polling. Deploy the shared Lambda image and run the
  backfill. Confirm production
  metrics/logs expose processing failures and duration without logging
  credentials or audio contents.

## Validation

- A new MP3 upload eventually produces valid, bounded peak data and changes
  its state from `pending` to `ready`.
- Duplicate S3 events and retries do not create duplicate database rows or
  inconsistent sidecars.
- Processing failures are visible as failures and can be retried.
- Backfilled recordings produce the same sidecar format as new uploads.
- A user cannot read another user's waveform or audio, including through a
  guessed recording ID or expired presigned URL.
- Playback starts without downloading the entire file first; byte-range
  seeking works near the beginning, middle, and end of an MP3.
- The playhead tracks playback, and clicking, dragging, and keyboard seeking
  update the actual audio position.
- Deleting a recording removes its MP3 and waveform data; playback stops if
  the deleted recording was active.
