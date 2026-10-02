export type ControlId =
  | 'master.volume'
  | 'channel.A.gain'
  | 'channel.A.eq.high'
  | 'channel.A.eq.mid'
  | 'channel.A.eq.low'
  | 'channel.B.gain'
  | 'channel.B.eq.high'
  | 'channel.B.eq.mid'
  | 'channel.B.eq.low'
  | 'fx.wet'
  | 'fx.division'
  | 'deck.A.platter'
  | 'deck.A.tempo'
  | 'deck.B.platter'
  | 'deck.B.tempo';

export type ControlLease = {
  controlId: ControlId;
  ownerId: string;
  ownerUsername: string;
  expiresAt: number;
};

export type ControlState = {
  leases: Record<ControlId, ControlLease>;
};

export type ControlInteractionType = 'acquire' | 'update' | 'release' | 'cancel';

export type ControlInteractionEvent = {
  type: ControlInteractionType;
  controlId: ControlId;
  timestamp: number;
  value?: number;
  reason?: 'pointer-cancel' | 'lost-capture' | 'leave' | 'timeout';
};

export const EXTRAPOLATION_CONFIG = {
  horizonMs: 500,
  blendMs: 100,
  maxSamples: 5,
} as const;

export function channelId(deckId: 'A' | 'B', param: 'gain' | 'eq.high' | 'eq.mid' | 'eq.low'): ControlId {
  return `channel.${deckId}.${param}` as ControlId;
}

export function deckId(deckId: 'A' | 'B', param: 'platter' | 'tempo'): ControlId {
  return `deck.${deckId}.${param}` as ControlId;
}
