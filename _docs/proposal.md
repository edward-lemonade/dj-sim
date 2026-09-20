# DJ App — Planning Doc

## Overview

A browser-based app that simulates DJ hardware (2 CDJs to start, extensible to more) and lets users mix in real time. The core design problem: DJing requires two hands, but a keyboard/mouse setup only gives the user one cursor at a time. The app solves this with **skills** — pre-scripted automations bound to keybinds that execute multi-control actions instantly.

## Core Features

### Song Pool (Home Page)
- Upload and delete tracks
- Tag tracks
- BPM alignment
- Reorder pool

### Skills (Home Page)
- Change keybinds
- Create new skills
- Delete skills

### Studio
- Mix live using the song pool
- Trigger skills via keybind for two-handed actions the user can't perform with mouse + keyboard alone
- Most of the actual mixing work happens live; skills fill the gap for actions that need simultaneous multi-control input

### Skill Editor
- In-depth editor for scripting automations across knobs, buttons, and sliders
- Multiple controls can be automated simultaneously (e.g. an EQ swap — high-to-low on one slider, low-to-high on the other — executed near-instantly)
- No hard limit on sequence complexity; users can script long automated sequences
- Skills are replayed via keybind during a live session

### Accounts
- Account required for song pool to persist
- Without an account, the song pool only lasts for the current session (guest mode)

## Future Features

### Broadcasting / Spectating
- Users can broadcast a session so others can spectate, with a live view of their CDJs

### B2B (Back-to-Back) Sessions
- 2–3 users mixing together in the same live session
- Hardest piece to implement: syncing actions across users without perceptible delay

## Technical Considerations

### Timing Precision (Skill Playback)
An EQ swap or similar automation only feels "instant" if it's sample-accurate rather than driven by JS timers. Skills should compile down to a timeline of scheduled parameter curves (e.g. using Web Audio `AudioParam` automation like `linearRampToValueAtTime` / `setValueCurveAtTime`), which run on the audio thread's own clock rather than `setTimeout`/`setInterval`. This also makes skills easier to preview, edit, and replay deterministically.

### Shared Clock / BPM Sync
Both CDJs should reference a shared transport clock (e.g. based on `AudioContext.currentTime`) so tempo/pitch adjustments and skill playback stay locked to the same timeline instead of drifting independently.

### Skill Editor UX
Central design question: how does a user compose a two-handed action using only one hand at a time in the editor? Likely approach — a timeline/sequencer view with parallel tracks per control, where the user places and scrubs automation events, rather than literally performing the action live to record it. A live-record-then-quantize mode could be a nice addition later.

### Guest vs. Account Persistence
Guest sessions can use local browser storage (e.g. IndexedDB, since audio files are involved) with a clear prompt to sign up to persist the song pool.

### B2B Sync Architecture (Future)
This is a live audio-rate performance sync problem, not just state sync — the goal is to replicate the *effect* of each user's actions on audio output across peers, not raw audio. Likely approach: WebRTC data channels for control messages (button/knob events, skill triggers) combined with each client running its own local audio engine, driven by a shared logical/timestamp clock so playback stays coordinated despite network jitter and differing local clocks. Worth treating as a distinct v2 project rather than designing the MVP around it.

## Implementation Stack

### Frontend
- TypeScript
- React
- Vite
- Clerk (auth)

### Backend
- Go
- Gin
- AWS S3 (asset/track storage)
- PostgreSQL (song pool, skills, user data)