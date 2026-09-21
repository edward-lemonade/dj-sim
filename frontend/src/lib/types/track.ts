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
};

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

// PATCH body: every field optional, but null isn't a valid value to send
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
    status: TrackLibraryStatus;
    errorMessage?: string;
  };