export type WaveformOverview = {
  lows: number[];
  mids: number[];
  highs: number[];
  durationSeconds?: number;
};

export interface Track {
  id: string;
  userId: string;
  title: string;
  artist: string;
  bpm: number;
  beatOffset: number; // seconds to the first measure line
  key: string;
  duration: string;
  cover: string;
  url: string;
  fileName: string;
  waveformOverview?: WaveformOverview | null;
  createdAt: string;
  updatedAt: string;
}

export type TrackUpdateFields = {
  title?: string;
  artist?: string;
  bpm?: number;
  beatOffset?: number;
  key?: string;
  waveformOverview?: WaveformOverview;
};

export type PoolStatus = 'ready' | 'uploading' | 'error';
export type PoolTrack = {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  beatOffset: number;
  key: string;
  duration: string;
  coverLabel: string;
  coverUrl: string | null;
  waveformOverview: WaveformOverview | null;
  status: PoolStatus;
  errorMessage?: string;
};
