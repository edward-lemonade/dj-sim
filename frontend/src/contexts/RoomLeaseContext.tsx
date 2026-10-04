import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useControlLease } from '@/hooks/useControlLease';
import { useRemoteControlExtrapolation } from '@/hooks/useRemoteControlExtrapolation';
import type { ControlId, ControlLease, ControlReleaseReason } from '@/lib/types/Control';

type RoomLeaseContextType = {
  currentUserId: string | null;
  leases: Partial<Record<ControlId, ControlLease>>;
  isLeasedByOther: (controlId: ControlId) => boolean;
  getLeaseOwner: (controlId: ControlId) => string | null;
  acquireLease: (controlId: ControlId) => void;
  releaseLease: (controlId: ControlId, reason?: ControlReleaseReason) => void;
};

type ControlLeaseEvent = {
  type: string;
  controlId: ControlId;
  reason?: ControlReleaseReason;
};

const RoomLeaseContext = createContext<RoomLeaseContextType | null>(null);

export function RoomLeaseProvider({
  children,
  currentUserId,
  leases,
  emitEvent,
}: {
  children: ReactNode;
  currentUserId: string | null;
  leases: ControlLease[];
  emitEvent: (event: ControlLeaseEvent) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const { acquireLease, releaseLease } = useControlLease(currentUserId, emitEvent);

  useEffect(() => {
    const nextExpiry = leases
      .map((lease) => lease.expiresAt)
      .filter((expiresAt) => expiresAt > now)
      .sort((a, b) => a - b)[0];
    if (nextExpiry === undefined) return;
    const timeout = window.setTimeout(() => setNow(Date.now()), Math.max(0, nextExpiry - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [leases, now]);

  const leaseMap = useMemo(() => Object.fromEntries(
    leases.filter((lease) => lease.expiresAt > now).map((lease) => [lease.controlId, lease]),
  ) as Partial<Record<ControlId, ControlLease>>, [leases, now]);

  const isLeasedByOther = useCallback((controlId: ControlId) => {
    const lease = leaseMap[controlId];
    return Boolean(currentUserId && lease && lease.ownerId !== currentUserId);
  }, [currentUserId, leaseMap]);

  const getLeaseOwner = useCallback((controlId: ControlId) => {
    const lease = leaseMap[controlId];
    return lease && lease.ownerId !== currentUserId ? lease.ownerUsername : null;
  }, [currentUserId, leaseMap]);

  const contextValue = useMemo(() => ({
    currentUserId,
    leases: leaseMap,
    isLeasedByOther,
    getLeaseOwner,
    acquireLease,
    releaseLease,
  }), [currentUserId, leaseMap, isLeasedByOther, getLeaseOwner, acquireLease, releaseLease]);

  return (
    <RoomLeaseContext.Provider value={contextValue}>
      {children}
    </RoomLeaseContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRoomLeases() {
  const context = useContext(RoomLeaseContext);
  if (!context) throw new Error('useRoomLeases must be used within RoomLeaseProvider.');
  return context;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRoomControl(
  controlId: ControlId | undefined,
  value: number,
  extrapolate = true,
  getInteractionControlIds?: () => ControlId[],
) {
  const { acquireLease, releaseLease, isLeasedByOther, getLeaseOwner } = useRoomLeases();
  const { currentValue, onAuthoritativeUpdate, reset } = useRemoteControlExtrapolation(value);
  const activeLeaseIdsRef = useRef<ControlId[]>([]);
  const leasedByOther = controlId ? isLeasedByOther(controlId) : false;
  const selectedLeaseIds = getInteractionControlIds?.() ?? [];
  const interactionLeaseIds = selectedLeaseIds.length > 0
    ? selectedLeaseIds
    : controlId ? [controlId] : [];
  const interactionLeasedByOther = interactionLeaseIds.some(isLeasedByOther);

  const acquireInteractionLeases = useCallback(() => {
    const selectedIds = getInteractionControlIds?.() ?? [];
    const controlIds = selectedIds.length > 0 ? selectedIds : controlId ? [controlId] : [];
    activeLeaseIdsRef.current = controlIds;
    controlIds.forEach(acquireLease);
  }, [acquireLease, controlId, getInteractionControlIds]);

  const releaseInteractionLeases = useCallback((reason?: ControlReleaseReason) => {
    const selectedIds = new Set(getInteractionControlIds?.() ?? []);
    activeLeaseIdsRef.current
      .filter((id) => !selectedIds.has(id))
      .forEach((id) => releaseLease(id, reason));
    activeLeaseIdsRef.current = [];
  }, [getInteractionControlIds, releaseLease]);

  useEffect(() => {
    if (leasedByOther && extrapolate) {
      onAuthoritativeUpdate(value, performance.now());
    } else {
      reset(value);
    }
  }, [controlId, extrapolate, leasedByOther, onAuthoritativeUpdate, reset, value]);

  return {
    value: leasedByOther && extrapolate ? currentValue : value,
    isLeasedByOther: leasedByOther || interactionLeasedByOther,
    leaseOwner: controlId ? getLeaseOwner(controlId) ?? undefined : undefined,
    onLeaseAcquire: controlId ? acquireInteractionLeases : undefined,
    onLeaseRelease: controlId ? releaseInteractionLeases : undefined,
  };
}
