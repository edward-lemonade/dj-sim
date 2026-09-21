import { useCallback, useEffect, useRef, useState } from 'react';

const STEP = 0.01; // seconds
const FINE_STEP = 0.001;
const SAVE_DELAY_MS = 400;

const mod = (n: number, m: number) => ((n % m) + m) % m;

export function useGridNudge({
  trackId,
  bpm,
  savedOffset,
  save,
}: {
  trackId: string | null;
  bpm: number;
  savedOffset: number;
  save: (id: string, offset: number) => Promise<unknown>;
}) {
  const [pending, setPending] = useState<number | null>(null);
  const pendingRef = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback((id: string) => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const value = pendingRef.current;
    if (value === null) return;
    pendingRef.current = null;
    void saveRef
      .current(id, value)
      .catch(console.error)
      .finally(() => {
        if (pendingRef.current === null) setPending(null);
      });
  }, []);

  // Save any unsaved nudge when switching tracks or unmounting.
  useEffect(() => {
    return () => {
      if (trackId) flush(trackId);
      setPending(null);
    };
  }, [trackId, flush]);

  const nudge = useCallback(
    (direction: -1 | 1, fine: boolean) => {
      if (!trackId || bpm <= 0) return;
      const measure = (60 / bpm) * 4;
      const base = pendingRef.current ?? savedOffset;
      // Wrapping by a measure is visually identical and keeps the stored value small.
      const next = Math.round(mod(base + direction * (fine ? FINE_STEP : STEP), measure) * 1000) / 1000;
      pendingRef.current = next;
      setPending(next);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => flush(trackId), SAVE_DELAY_MS);
    },
    [trackId, bpm, savedOffset, flush],
  );

  return { offset: pending ?? savedOffset, nudge };
}