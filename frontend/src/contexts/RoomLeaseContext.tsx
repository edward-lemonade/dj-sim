import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { ControlId, ControlLease } from '@/lib/types/Control';

type RoomLeaseContextType = {
  leases: Record<ControlId, ControlLease>;
  updateLease: (controlId: ControlId, lease: ControlLease | null) => void;
  isLeasedByOther: (controlId: ControlId, myUserId: string) => boolean;
  getLeaseOwner: (controlId: ControlId) => string | null;
};

const RoomLeaseContext = createContext<RoomLeaseContextType | null>(null);

export function RoomLeaseProvider({ children }: { children: ReactNode }) {
  const [leases, setLeases] = useState<Record<ControlId, ControlLease>>({});

  const updateLease = useCallback((controlId: ControlId, lease: ControlLease | null) => {
    setLeases((prev) => {
      const next = { ...prev };
      if (lease) {
        next[controlId] = lease;
      } else {
        delete next[controlId];
      }
      return next;
    });
  }, []);

  const isLeasedByOther = useCallback((controlId: ControlId, myUserId: string) => {
    const lease = leases[controlId];
    if (!lease) return false;
    return lease.ownerId !== myUserId && Date.now() < lease.expiresAt;
  }, [leases]);

  const getLeaseOwner = useCallback((controlId: ControlId) => {
    const lease = leases[controlId];
    if (!lease || Date.now() >= lease.expiresAt) return null;
    return lease.ownerUsername;
  }, [leases]);

  return (
    <RoomLeaseContext.Provider value={{ leases, updateLease, isLeasedByOther, getLeaseOwner }}>
      {children}
    </RoomLeaseContext.Provider>
  );
}

export function useRoomLeases() {
  const context = useContext(RoomLeaseContext);
  if (!context) {
    throw new Error('useRoomLeases must be used within RoomLeaseProvider');
  }
  return context;
}
