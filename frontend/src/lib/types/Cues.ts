export const CUE_COUNT = 8;
export const CUE_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export const CUE_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
] as const;

export type Cues = Array<number | null>;

export const emptyCues = (): Cues => Array<number | null>(CUE_COUNT).fill(null);

// Server rows created before this feature have no cues (null), so always pad/clean.
export function normalizeCues(raw: readonly (number | null)[] | null | undefined): Cues {
  const out = emptyCues();
  raw?.slice(0, CUE_COUNT).forEach((v, i) => {
    out[i] = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  });
  return out;
}

// Track length in seconds, preferring the analysed duration over the "m:ss" label.
export function trackSeconds(song: {
  duration: string;
  waveformOverview: { durationSeconds?: number } | null;
}): number {
  const fromOverview = song.waveformOverview?.durationSeconds;
  if (fromOverview && fromOverview > 0) return fromOverview;
  const parts = song.duration.split(':').map(Number);
  if (parts.length < 2 || parts.some((p) => !Number.isFinite(p))) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}