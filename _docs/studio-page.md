# StudioPage

A two-deck DJ view: a thin top bar, a CDJ on the left, a mixer in the middle, and a CDJ on the right.

## Open questions

- [x] **How does a track get loaded into a deck?** Each `CDJ` takes a `track: Track | null` prop. The page holds `deckAId` / `deckBId`, auto-loads the first two ready library tracks, and exposes a load `<select>` until a picker exists.
- [x] **Cue navigation when the cue is unset.** Unset cue buttons are disabled and do nothing.
- [x] **Should the mixer knobs and fader actually affect audio?** UI-only for now, like the tempo slider. Audio routing is a follow-up (see the end of this doc).
- [x] **Do both decks share one `AudioContext`?** Playback uses a separate `HTMLAudioElement` per `useTrackPlayer`. Peak decoding already shares one `AudioContext` via `getAudioContext()`. Spacebar is disabled on studio decks so two instances do not fight.

## Layout

```
┌──────────────────────────────────────────────────────────┐
│ [home]                                       (thin bar)  │
├────────────────────┬──────────────────┬──────────────────┤
│       CDJ A        │      Mixer       │       CDJ B      │
│                    │  ┌────┐  ┌────┐  │                  │
│                    │  │ HI │  │ HI │  │                  │
│                    │  │ MID│  │ MID│  │                  │
│                    │  │ LOW│  │ LOW│  │                  │
│                    │  │ vol│  │ vol│  │                  │
└────────────────────┴──────────────────┴──────────────────┘
```

- [x] `StudioPage.tsx`: full-height column, with `StudioTopbar` on top and a `grid grid-cols-3` filling the rest (`min-h-0 flex-1`).
- [x] Left and right thirds are `<CDJ />` instances. The middle third is `<Mixer />`.
- [x] Add the route (e.g. `/studio`) and a way to reach it from the home page.

## 1. `StudioTopbar`

- [x] Very thin bar (about 28 to 32px) with a home icon button on the left. Leave room to add more items later.
- [x] `ExitConfirmModal`: "Are you sure you want to exit?" with **Yes** and **No**.
  - [x] Yes navigates to home. No closes the modal.
  - [x] Escape and clicking the backdrop count as No.
  - [x] Reuse the existing dialog component if the project has one.

## 2. `CDJ` (reusable component)

Props (draft):

```ts
type CDJProps = {
  track: PoolTrack | null;
  label?: string; // "A" / "B", used for aria labels
};
```

Each `CDJ` owns its own `useTrackPlayer` instance. Two decks means two independent players.

Vertical stack:

1. Waveform preview (zoomed and mini)
2. Controls row

### 2a. Waveform preview (`DeckWaveform`)

Based on `TrackPreview`, with these differences:

- [x] **1-band waveform.** Check whether `WaveformCanvas` can render a single combined band. If not, add a `bands="single"` prop or a variant that sums lows, mids and highs into one peak array.
- [x] Keep the zoomed waveform, the mini (overview) waveform below it, and zoom in/out buttons.
- [x] Keep `BeatGrid` and `CueMarkers`, **read-only**. `BeatGrid` already has no dragging.
- [x] Remove the metadata row (title, artist, BPM, key, time). Nothing is editable.
- [x] Remove `TransportControls` from the preview. Transport lives in the deck's own control row.
- [x] **Snap-to-grid seek (always on).** Clicking the waveform seeks to the nearest beat:
  - [x] Write `snapToBeat(seconds, bpm, beatOffset, duration)`, where `beat = 60 / bpm` and `t = beatOffset + round((seconds - beatOffset) / beat) * beat`, clamped to `[0, duration]`.
  - [x] Intercept `onSeek`: convert the fraction to seconds, snap, then call `player.seek(snapped)`.
  - [x] If `bpm <= 0`, fall back to a normal seek.
  - [x] Decide whether drag-scrubbing snaps too, or only click.
- [x] Extract what `TrackPreview` and `DeckWaveform` share (the zoom logic, canvas layout) instead of copy-pasting. Options: a shared `useWaveformZoom` hook, or make `TrackPreview` compose a base `WaveformView`.
- [x] Empty state when no track is loaded ("No track loaded").

### 2b. Controls row

Three zones: left, center, right.

**Bottom left: transport**

- [x] **Play/Pause** button, wired to `player.togglePlay`.
- [x] **CUE** button above it. On press, write the current playhead into the first `null` slot of `track.cues`:
  - [x] If every slot is filled, do nothing.
  - [x] Save through the existing `patchTrack` (optimistic, so it reuses the `cues` patch flow).
  - [x] Use the un-snapped playhead position. Confirm whether the cue should be snapped to the beat instead.

**Center: `Platter` (spinning record)**

- [x] Circle with a label and groove styling (CSS only; no images needed).
- [x] Rotates while `player.status === 'playing'`. Use a CSS keyframe animation with `animation-play-state` toggled between `running` and `paused`, so it stops in place rather than snapping back.
- [x] About 33 rpm as the default speed (about 1.8s per rotation).
- [x] No interaction yet: no scratching, no jog. Keep it `pointer-events-none`.

**Bottom right: cues and tempo**

- [x] **Tempo slider** above the cue buttons: vertical or horizontal (pick one), UI only, no effect yet. Keep its value in local state so it's easy to wire up later.
- [x] **Cue buttons (A to H)**, reusing the existing `CueButtons`:
  - [x] `CueButtons` currently *toggles* (sets or deletes). The deck needs *navigate*. Add a `mode: 'edit' | 'jump'` prop, or an `onCueClick(index)` override.
  - [x] Jump mode: clicking a set cue calls `player.seek(cues[i])`. Unset cues are disabled (see open questions).
  - [x] Set and unset styling stays the same (solid vs outline).

## 3. `Mixer` (middle third)

Two identical channel strips, one per deck (`ChannelStrip`).

- [x] `ChannelStrip` props: `label`, plus `value`/`onChange` for high, mid, low and volume (controlled, so the page can lift state later).
- [x] Three **rotary knobs** stacked vertically: HIGH, MID, LOW.
  - [x] Build a reusable `Knob` component (pointer drag up/down to change the value, double-click to reset to center, keyboard arrows, `role="slider"` with aria values).
  - [x] Range: -1 to +1 with 0 at center, and the indicator sweeps about 270 degrees.
- [x] **Volume slider (fader)** beneath the knobs, vertical.
  - [x] Range 0 to 1, default around 0.8.
- [x] Label each strip ("A" / "B") and align the left strip with the left deck and the right strip with the right deck.
- [x] State lives in `StudioPage` (or a `useMixerState` hook) as `{ a: {high, mid, low, volume}, b: {...} }`.

## 4. Shared / reuse checklist

- [x] `useTrackPlayer`: confirm two instances work side by side and share one `AudioContext`.
- [x] `WaveformCanvas`: single-band support.
- [x] `BeatGrid`, `CueMarkers`: reuse as-is. Pass the shared `WaveformView` props.
- [x] `CueButtons`: add the jump mode.
- [x] `useTrackLibrary.patchTrack`: reuse for the CUE button. Make sure the `cues` PATCH is fixed on the backend first (the jsonb cast).

## 5. Suggested build order

1. [x] `StudioPage` shell, three-column grid, route.
2. [x] `StudioTopbar` and `ExitConfirmModal`.
3. [x] `CDJ` skeleton with hardcoded layout zones and no logic.
4. [x] `Platter` (CSS spin driven by a fake `playing` prop first).
5. [x] `DeckWaveform`: port from `TrackPreview`, single band, read-only.
6. [x] Snap-to-beat seeking.
7. [x] Play/pause and CUE button.
8. [x] `CueButtons` jump mode.
9. [x] Tempo slider (UI only).
10. [x] `Knob`, `ChannelStrip`, `Mixer`.
11. [x] Track loading into decks.

## Out of scope for now

- Audio routing for the EQ and volume (Web Audio `BiquadFilterNode` chain per deck: low shelf, peaking mid, high shelf, then a gain node).
- Tempo/pitch changes and playback-rate changes.
- Jog wheel / scratching / platter interaction.
- Crossfader, sync, loops, and any other topbar items.
