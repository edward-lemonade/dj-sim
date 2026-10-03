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

// Server-side analysis lifecycle (set by the BPM/key Lambda via webhook).
// 'pending' until the Lambda reports back; bpm/beatOffset/key are 0/""
// until then. 'failed' leaves bpm/beatOffset/key untouched (never
// overwritten with zeros) — see backend UpdateAnalysisByObjectKey.
export type TrackAnalysisStatus = 'pending' | 'complete' | 'failed';

// what the server has
export type TrackDTO = TrackMeta & {
  id: string;
  userId: string;
  duration: string;
  cover: string;
  url: string;
  fileName: string;
  analysisStatus: TrackAnalysisStatus;
  createdAt: string;
  updatedAt: string;
};

export type TrackUpdateFields = Partial<{
  [K in keyof TrackMeta]: NonNullable<TrackMeta[K]>;
}>;

// Client view model
// 'analyzing' = uploaded, row exists, waiting on TrackDTO.analysisStatus
// to leave 'pending'. Deliberately one status enum (not analysisStatus +
// libraryStatus side by side) so the UI only ever branches on one field.
export type TrackLibraryStatus = 'ready' | 'uploading' | 'analyzing' | 'error';
export type Track = TrackMeta &
  Pick<TrackDTO, 
    'id' | 
    'duration'
  > & 
  {
    createdAt?: string;
    coverLabel: string;
    coverUrl: string | null;
    libraryStatus: TrackLibraryStatus;
    uploadProgress?: number;
    errorMessage?: string;
  };