export function snapToBeat(seconds: number, bpm: number, beatOffset: number, duration: number): number {
  const dur = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const t0 = Number.isFinite(seconds) ? seconds : 0;
  if (!(bpm > 0) || dur <= 0) {
    return Math.min(Math.max(0, t0), dur);
  }
  const beat = 60 / bpm;
  const t = beatOffset + Math.round((t0 - beatOffset) / beat) * beat;
  return Math.min(Math.max(0, t), dur);
}
