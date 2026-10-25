import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { ToastVariant } from '@/components/ui/toast';

const GRID_NUDGE_STEP_PIXELS = 3;
const GRID_NUDGE_FINE_STEP_PIXELS = GRID_NUDGE_STEP_PIXELS / 10;

const mod = (n: number, m: number) => ((n % m) + m) % m;

type PendingNudge = {
  trackId: string;
  offset: number;
};

export function useGridNudge({
  trackId,
  bpm,
  savedOffset,
  secondsPerPixel,
  save,
}: {
  trackId: string | null;
  bpm: number;
  savedOffset: number;
  secondsPerPixel: number;
  save: (id: string, offset: number) => Promise<unknown>;
}) {
  const { showToast } = useToast();
  const [pending, setPending] = useState<PendingNudge | null>(null);
  const pendingRef = useRef<PendingNudge | null>(null);
  const saveRef = useRef(save);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const flush = useCallback((id: string) => {
    const value = pendingRef.current;
    if (!value || value.trackId !== id) return;
    pendingRef.current = null;
    void saveRef.current(id, value.offset).catch((cause: unknown) => {
      showToast(cause instanceof Error ? cause.message : 'Could not save beat-grid adjustment.', ToastVariant.Error, {
        dedupeKey: `track-grid-${id}`,
      });
    }).finally(() => {
      if (pendingRef.current?.trackId !== id) {
        setPending((current) =>
          current?.trackId === id && current.offset === value.offset ? null : current,
        );
      }
    });
  }, [showToast]);

  useEffect(() => {
    if (!trackId) return;
    const flushOnPageHide = () => flush(trackId);
    window.addEventListener('pagehide', flushOnPageHide);
    return () => {
      window.removeEventListener('pagehide', flushOnPageHide);
      flush(trackId);
    };
  }, [trackId, flush]);

  const nudge = useCallback(
    (direction: -1 | 1, fine: boolean) => {
      if (!trackId || bpm <= 0 || secondsPerPixel <= 0) return;
      const measure = (60 / bpm) * 4;
      const localPending = pendingRef.current?.trackId === trackId
        ? pendingRef.current
        : pending?.trackId === trackId ? pending : null;
      const base = localPending?.offset ?? savedOffset;
      // Wrapping by a measure is visually identical and keeps the stored value small.
      const pixels = fine ? GRID_NUDGE_FINE_STEP_PIXELS : GRID_NUDGE_STEP_PIXELS;
      const next = Math.round(mod(base + direction * pixels * secondsPerPixel, measure) * 1e6) / 1e6;
      const nextPending = { trackId, offset: next };
      pendingRef.current = nextPending;
      setPending(nextPending);
    },
    [trackId, bpm, pending, savedOffset, secondsPerPixel],
  );

  return {
    offset: pending?.trackId === trackId ? pending.offset : savedOffset,
    nudge,
  };
}