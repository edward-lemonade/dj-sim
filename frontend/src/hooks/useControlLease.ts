import { useCallback, useRef, useEffect } from 'react';
import type { ControlId, ControlReleaseReason } from '@/lib/types/Control';

const LEASE_RENEWAL_MS = 10000;

export function useControlLease(
  currentUserId: string | null,
  emitEvent: (event: { type: string; controlId: ControlId; reason?: ControlReleaseReason }) => void,
) {
  const activeLeasesRef = useRef<Set<ControlId>>(new Set());
  const renewalTimersRef = useRef<Map<ControlId, number>>(new Map());

  const acquireLease = useCallback((controlId: ControlId) => {
    if (!currentUserId) return;
    if (activeLeasesRef.current.has(controlId)) return;

    emitEvent({
      type: 'control-acquire',
      controlId,
    });

    activeLeasesRef.current.add(controlId);

    const timer = window.setInterval(() => {
      emitEvent({
        type: 'control-acquire',
        controlId,
      });
    }, LEASE_RENEWAL_MS);
    renewalTimersRef.current.set(controlId, timer);
  }, [currentUserId, emitEvent]);

  const releaseLease = useCallback((controlId: ControlId, reason?: ControlReleaseReason) => {
    if (!activeLeasesRef.current.has(controlId)) return;

    const timer = renewalTimersRef.current.get(controlId);
    if (timer) {
      window.clearInterval(timer);
      renewalTimersRef.current.delete(controlId);
    }

    activeLeasesRef.current.delete(controlId);

    emitEvent({
      type: reason ? 'control-cancel' : 'control-release',
      controlId,
      reason,
    });
  }, [emitEvent]);

  const releaseAll = useCallback(() => {
    for (const controlId of activeLeasesRef.current) {
      releaseLease(controlId);
    }
  }, [releaseLease]);

  useEffect(() => {
    return () => {
      releaseAll();
    };
  }, [releaseAll]);

  return { acquireLease, releaseLease };
}
