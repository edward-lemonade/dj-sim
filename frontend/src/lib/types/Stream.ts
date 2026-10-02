import type { MixerState } from '@/pages/studio/useMixerState';
import type { WaveformOverview } from './Track';

export type ListedStream = {
  id: string;
  username: string;
  avatarUrl: string;
  name: string;
  startedAt: string;
};

export type StreamDeckSnapshot = {
  track: null | {
    id: string;
    title: string;
    artist: string;
    bpm: number;
    beatOffset: number;
    key: string;
    durationSeconds: number;
    cues: Array<number | null>;
    waveformOverview: WaveformOverview | null;
  };
  playing: boolean;
  positionSeconds: number;
  durationSeconds: number;
  rate: number;
};

export type StudioSnapshot = {
  version: 1;
  mixer: MixerState;
  decks: Record<'A' | 'B', StreamDeckSnapshot>;
  beatsPerView: number;
  pointer: { x: number; y: number } | null;
  popup: null | { kind: 'track-picker'; deck: 'A' | 'B' };
  capturedAt: number;
};

export type StreamConnection = {
  session: ListedStream;
  eventUrl: string;
  eventTicket: string;
  exitTicket?: string;
  liveKitUrl: string;
  liveKitToken: string;
};

export type StreamEvent = {
  type: 'joined' | 'snapshot' | 'event' | 'pointer' | 'viewer-count' | 'ended' | 'error';
  seq?: number;
  t?: number;
  payload?: StudioSnapshot | Record<string, unknown>;
  count?: number;
};
