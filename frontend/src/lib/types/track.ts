import type { Cues } from "./Cues";

export type WaveformOverview = {
  lows: number[];
  mids: number[];
  highs: number[];
  durationSeconds?: number;
};

// editable fields
export type TrackMeta = {
  title: string;
  artist: string;
  bpm: number;
  beatOffset: number; // seconds to the first measure line
  key: string;
  waveformOverview: WaveformOverview | null;
  cues: Cues;
};

// what the server has
export type TrackDTO = TrackMeta & {
  id: string;
  userId: string;
  duration: string;
  cover: string;
  url: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
};

export type TrackUpdateFields = Partial<{
  [K in keyof TrackMeta]: NonNullable<TrackMeta[K]>;
}>;

// Client view model
export type TrackLibraryStatus = 'ready' | 'uploading' | 'error';
export type Track = TrackMeta &
  Pick<TrackDTO, 
    'id' | 
    'duration'
  > & 
  {
    coverLabel: string;
    coverUrl: string | null;
    libraryStatus: TrackLibraryStatus;
    uploadProgress?: number;
    errorMessage?: string;
  };