export type PoolStatus = 'ready' | 'uploading' | 'error';

export type PoolTrack = {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  duration: string;
  coverLabel: string;
  coverUrl: string | null;
  status: PoolStatus;
  errorMessage?: string;
};
