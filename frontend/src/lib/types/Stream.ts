import type { MixerState } from '@/hooks/useMixerState';
import type { RoomCursor, RoomVisibility } from './Room';
import type { WaveformOverview } from './Track';

export enum StreamDeckId {
  A = 'A',
  B = 'B',
}

export enum StreamPopupKind {
  TrackPicker = 'track-picker',
}

export enum StreamEventType {
  Joined = 'joined',
  Snapshot = 'snapshot',
  Event = 'event',
  Pointer = 'pointer',
  Cursors = 'cursors',
  ViewerCount = 'viewer-count',
  Ended = 'ended',
  Error = 'error',
  End = 'end',
}

export enum StreamConnectionStatus {
  Joining = 'joining',
  Live = 'live',
  Ended = 'ended',
  Error = 'error',
}

export type ListedStreamRoomMember = {
  userId: string;
  username: string;
  avatarUrl: string;
};

export type ListedStreamRoom = {
  id: string;
  visibility: RoomVisibility;
  members: ListedStreamRoomMember[];
  memberCount: number;
  capacity: number;
  code?: string;
};

export type ListedStream = {
  id: string;
  username: string;
  avatarUrl: string;
  name: string;
  startedAt: string;
  coverArts: [string | null, string | null];
  room?: ListedStreamRoom;
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
    coverUrl: string | null;
  };
  playing: boolean;
  positionSeconds: number;
  durationSeconds: number;
  rate: number;
};

export type StudioSnapshot = {
  version: 1;
  mixer: MixerState;
  decks: Record<StreamDeckId, StreamDeckSnapshot>;
  beatsPerView: number;
  pointer: { x: number; y: number } | null;
  popup: null | { kind: StreamPopupKind.TrackPicker; deck: StreamDeckId };
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
  type: StreamEventType;
  seq?: number;
  t?: number;
  payload?: StudioSnapshot | Record<string, unknown> | RoomCursor[];
  count?: number;
};
