import type { MixerState } from '@/pages/studio/useMixerState';
import type { StreamDeckSnapshot, StudioSnapshot } from '@/lib/types/Stream';

export type StreamDeckId = 'A' | 'B';
export type StreamPopup = null | { kind: 'track-picker'; deck: StreamDeckId };
export type StreamPointer = { x: number; y: number } | null;

export type StudioAction =
  | { action: 'mixer-change'; value: MixerState }
  | { action: 'track-load'; deck: StreamDeckId; value: StreamDeckSnapshot['track'] }
  | {
      action: 'transport';
      deck: StreamDeckId;
      value: Pick<StreamDeckSnapshot, 'playing' | 'positionSeconds' | 'durationSeconds' | 'rate'>;
    }
  | { action: 'waveform-view'; value: number }
  | { action: 'popup'; value: StreamPopup }
  | { action: 'pointer'; value: StreamPointer };

export function createInitialStudioSnapshot(): StudioSnapshot {
  const channel = () => ({ high: 0, mid: 0, low: 0, filter: 0, volume: 0.8, tempo: 0 });
  const deck = (): StreamDeckSnapshot => ({
    track: null,
    playing: false,
    positionSeconds: 0,
    durationSeconds: 0,
    rate: 1,
  });
  return {
    version: 1,
    mixer: {
      channelState: { 0: channel(), 1: channel() },
      fx: { type: 'echo', division: 1, wet: 0, assign: { 0: false, 1: false } },
      tempoMaster: null,
      master: 0.9,
    },
    decks: { A: deck(), B: deck() },
    beatsPerView: 32,
    pointer: null,
    popup: null,
    capturedAt: 0,
  };
}

export function reduceStudioSnapshot(state: StudioSnapshot, action: StudioAction): StudioSnapshot {
  switch (action.action) {
    case 'mixer-change':
      return { ...state, mixer: action.value };
    case 'track-load': {
      const currentDeck = state.decks[action.deck];
      const sameTrack = currentDeck.track?.id === action.value?.id;
      return {
        ...state,
        decks: {
          ...state.decks,
          [action.deck]: {
            ...currentDeck,
            track: action.value,
            playing: sameTrack ? currentDeck.playing : false,
            positionSeconds: sameTrack ? currentDeck.positionSeconds : 0,
            durationSeconds: sameTrack ? currentDeck.durationSeconds : action.value?.durationSeconds ?? 0,
          },
        },
      };
    }
    case 'transport':
      return {
        ...state,
        decks: { ...state.decks, [action.deck]: { ...state.decks[action.deck], ...action.value } },
      };
    case 'waveform-view':
      if (state.beatsPerView === action.value) return state;
      return { ...state, beatsPerView: action.value };
    case 'popup':
      if (JSON.stringify(state.popup) === JSON.stringify(action.value)) return state;
      return { ...state, popup: action.value };
    case 'pointer':
      if (JSON.stringify(state.pointer) === JSON.stringify(action.value)) return state;
      return { ...state, pointer: action.value };
  }
}

export function diffStudioSnapshots(previous: StudioSnapshot, next: StudioSnapshot): StudioAction[] {
  const actions: StudioAction[] = [];
  if (JSON.stringify(previous.mixer) !== JSON.stringify(next.mixer)) {
    actions.push({ action: 'mixer-change', value: next.mixer });
  }
  for (const deck of ['A', 'B'] as const) {
    if (previous.decks[deck].track !== next.decks[deck].track) {
      actions.push({ action: 'track-load', deck, value: next.decks[deck].track });
    }
    const before = previous.decks[deck];
    const after = next.decks[deck];
    if (
      before.playing !== after.playing ||
      Math.abs(before.positionSeconds - after.positionSeconds) >= 0.2 ||
      Math.abs(before.durationSeconds - after.durationSeconds) >= 0.1 ||
      before.rate !== after.rate
    ) {
      actions.push({
        action: 'transport',
        deck,
        value: {
          playing: after.playing,
          positionSeconds: after.positionSeconds,
          durationSeconds: after.durationSeconds,
          rate: after.rate,
        },
      });
    }
  }
  if (previous.beatsPerView !== next.beatsPerView) {
    actions.push({ action: 'waveform-view', value: next.beatsPerView });
  }
  if (JSON.stringify(previous.popup) !== JSON.stringify(next.popup)) {
    actions.push({ action: 'popup', value: next.popup });
  }
  if (JSON.stringify(previous.pointer) !== JSON.stringify(next.pointer)) {
    actions.push({ action: 'pointer', value: next.pointer });
  }
  return actions;
}
