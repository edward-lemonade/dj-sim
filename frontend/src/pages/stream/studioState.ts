import type { MixerState } from '@/hooks/useMixerState';
import type { ControlId } from '@/lib/types/Control';
import { FxType } from '@/lib/utils/fxRack';
import {
  StreamDeckId,
  StreamPopupKind,
  type StreamDeckSnapshot,
  type StudioSnapshot,
} from '@/lib/types/Stream';

export { StreamDeckId };
export type StreamPopup = null | { kind: StreamPopupKind.TrackPicker; deck: StreamDeckId };
export type StreamPointer = { x: number; y: number } | null;
export const STREAM_PLAYBACK_BUFFER_SECONDS = 0.5;

export type MixerSample = { time: number; value: MixerState };
export type PointerSample = { time: number; value: StreamPointer };

export type TransportSample = {
  time: number;
  trackId: string | null;
  transport: Pick<StreamDeckSnapshot, 'playing' | 'positionSeconds' | 'durationSeconds' | 'rate'>;
};

export function interpolateMixerState(current: MixerSample, next: MixerSample | undefined, time: number): MixerState {
  if (!next) return current.value;
  const span = next.time - current.time;
  const fraction = span > 0 ? Math.max(0, Math.min(1, (time - current.time) / span)) : 0;
  const mix = (from: number, to: number) => from + (to - from) * fraction;

  return {
    ...current.value,
    master: mix(current.value.master, next.value.master),
    channelState: {
      0: {
        high: mix(current.value.channelState[0].high, next.value.channelState[0].high),
        mid: mix(current.value.channelState[0].mid, next.value.channelState[0].mid),
        low: mix(current.value.channelState[0].low, next.value.channelState[0].low),
        filter: mix(current.value.channelState[0].filter, next.value.channelState[0].filter),
        volume: mix(current.value.channelState[0].volume, next.value.channelState[0].volume),
        tempo: mix(current.value.channelState[0].tempo, next.value.channelState[0].tempo),
      },
      1: {
        high: mix(current.value.channelState[1].high, next.value.channelState[1].high),
        mid: mix(current.value.channelState[1].mid, next.value.channelState[1].mid),
        low: mix(current.value.channelState[1].low, next.value.channelState[1].low),
        filter: mix(current.value.channelState[1].filter, next.value.channelState[1].filter),
        volume: mix(current.value.channelState[1].volume, next.value.channelState[1].volume),
        tempo: mix(current.value.channelState[1].tempo, next.value.channelState[1].tempo),
      },
    },
    fx: {
      ...current.value.fx,
      wet: mix(current.value.fx.wet, next.value.fx.wet),
    },
  };
}

export function interpolatePointer(current: PointerSample, next: PointerSample | undefined, time: number): StreamPointer {
  if (!current.value || !next?.value) return current.value;
  const span = next.time - current.time;
  const fraction = span > 0 ? Math.max(0, Math.min(1, (time - current.time) / span)) : 0;
  return {
    x: current.value.x + (next.value.x - current.value.x) * fraction,
    y: current.value.y + (next.value.y - current.value.y) * fraction,
  };
}

export function interpolateDeckPosition(
  trackId: string | null,
  current: TransportSample,
  next: TransportSample | undefined,
  time: number,
): number {
  const { transport } = current;
  let position = transport.positionSeconds;
  if (
    next &&
    current.trackId === next.trackId &&
    current.trackId === trackId &&
    transport.playing === next.transport.playing &&
    transport.rate === next.transport.rate
  ) {
    const span = next.time - current.time;
    const expectedPosition = position + (transport.playing && span > 0 ? span * transport.rate : 0);
    if (Math.abs(next.transport.positionSeconds - expectedPosition) < 0.5) {
      const fraction = span > 0 ? Math.max(0, Math.min(1, (time - current.time) / span)) : 0;
      position += (next.transport.positionSeconds - position) * fraction;
    } else if (transport.playing) {
      position += Math.max(0, time - current.time) * transport.rate;
    }
  } else if (transport.playing) {
    position += Math.max(0, time - current.time) * transport.rate;
  }
  return Math.max(0, Math.min(transport.durationSeconds, position));
}

export enum StudioActionType {
  Hydrate = 'hydrate',
  MixerChange = 'mixer-change',
  TrackLoad = 'track-load',
  Transport = 'transport',
  WaveformView = 'waveform-view',
  Popup = 'popup',
  Pointer = 'pointer',
}

export type StudioAction =
  | { action: StudioActionType.MixerChange; value: MixerState; controlId?: ControlId }
  | { action: StudioActionType.TrackLoad; deck: StreamDeckId; value: StreamDeckSnapshot['track'] }
  | {
      action: StudioActionType.Transport;
      deck: StreamDeckId;
      value: Pick<StreamDeckSnapshot, 'playing' | 'positionSeconds' | 'durationSeconds' | 'rate'>;
    }
  | { action: StudioActionType.WaveformView; value: number }
  | { action: StudioActionType.Popup; value: StreamPopup }
  | { action: StudioActionType.Pointer; value: StreamPointer };

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
      fx: { type: FxType.Echo, division: 1, wet: 0, assign: { 0: false, 1: false } },
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
    case StudioActionType.MixerChange:
      return { ...state, mixer: action.value };
    case StudioActionType.TrackLoad: {
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
    case StudioActionType.Transport:
      return {
        ...state,
        decks: { ...state.decks, [action.deck]: { ...state.decks[action.deck], ...action.value } },
      };
    case StudioActionType.WaveformView:
      if (state.beatsPerView === action.value) return state;
      return { ...state, beatsPerView: action.value };
    case StudioActionType.Popup:
      if (JSON.stringify(state.popup) === JSON.stringify(action.value)) return state;
      return { ...state, popup: action.value };
    case StudioActionType.Pointer:
      if (JSON.stringify(state.pointer) === JSON.stringify(action.value)) return state;
      return { ...state, pointer: action.value };
  }
}

export function diffStudioSnapshots(previous: StudioSnapshot, next: StudioSnapshot): StudioAction[] {
  const actions: StudioAction[] = [];
  if (JSON.stringify(previous.mixer) !== JSON.stringify(next.mixer)) {
    actions.push({ action: StudioActionType.MixerChange, value: next.mixer });
  }
  for (const deck of [StreamDeckId.A, StreamDeckId.B]) {
    if (previous.decks[deck].track !== next.decks[deck].track) {
      actions.push({ action: StudioActionType.TrackLoad, deck, value: next.decks[deck].track });
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
        action: StudioActionType.Transport,
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
    actions.push({ action: StudioActionType.WaveformView, value: next.beatsPerView });
  }
  if (JSON.stringify(previous.popup) !== JSON.stringify(next.popup)) {
    actions.push({ action: StudioActionType.Popup, value: next.popup });
  }
  if (JSON.stringify(previous.pointer) !== JSON.stringify(next.pointer)) {
    actions.push({ action: StudioActionType.Pointer, value: next.pointer });
  }
  return actions;
}
