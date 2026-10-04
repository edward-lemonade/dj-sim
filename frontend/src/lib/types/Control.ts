export enum ControlId {
  MasterVolume = 'master.volume',
  ChannelAGain = 'channel.A.gain',
  ChannelAEqHigh = 'channel.A.eq.high',
  ChannelAEqMid = 'channel.A.eq.mid',
  ChannelAEqLow = 'channel.A.eq.low',
  ChannelBGain = 'channel.B.gain',
  ChannelBEqHigh = 'channel.B.eq.high',
  ChannelBEqMid = 'channel.B.eq.mid',
  ChannelBEqLow = 'channel.B.eq.low',
  ChannelAFilter = 'channel.A.filter',
  ChannelBFilter = 'channel.B.filter',
  FxWet = 'fx.wet',
  FxDivision = 'fx.division',
  FxAssignA = 'fx.assign.A',
  FxAssignB = 'fx.assign.B',
  TempoMaster = 'mixer.tempo-master',
  DeckAPlatter = 'deck.A.platter',
  DeckATempo = 'deck.A.tempo',
  DeckBPlatter = 'deck.B.platter',
  DeckBTempo = 'deck.B.tempo',
}

export enum ControlDeckId {
  A = 'A',
  B = 'B',
}

export enum ChannelControlParam {
  Gain = 'gain',
  EqHigh = 'eq.high',
  EqMid = 'eq.mid',
  EqLow = 'eq.low',
}

export enum DeckControlParam {
  Platter = 'platter',
  Tempo = 'tempo',
}

export enum ControlInteractionType {
  Acquire = 'acquire',
  Update = 'update',
  Release = 'release',
  Cancel = 'cancel',
}

export enum ControlReleaseReason {
  PointerCancel = 'pointer-cancel',
  LostCapture = 'lost-capture',
  Leave = 'leave',
  Timeout = 'timeout',
}

export type ControlLease = {
  controlId: ControlId;
  ownerId: string;
  ownerUsername: string;
  expiresAt: number;
};

export type ControlState = {
  leases: Record<ControlId, ControlLease>;
};

export type ControlInteractionEvent = {
  type: ControlInteractionType;
  controlId: ControlId;
  timestamp: number;
  value?: number;
  reason?: ControlReleaseReason;
};

export const EXTRAPOLATION_CONFIG = {
  horizonMs: 500,
  blendMs: 100,
  maxSamples: 5,
} as const;

const CHANNEL_CONTROL_IDS: Record<ControlDeckId, Record<ChannelControlParam, ControlId>> = {
  [ControlDeckId.A]: {
    [ChannelControlParam.Gain]: ControlId.ChannelAGain,
    [ChannelControlParam.EqHigh]: ControlId.ChannelAEqHigh,
    [ChannelControlParam.EqMid]: ControlId.ChannelAEqMid,
    [ChannelControlParam.EqLow]: ControlId.ChannelAEqLow,
  },
  [ControlDeckId.B]: {
    [ChannelControlParam.Gain]: ControlId.ChannelBGain,
    [ChannelControlParam.EqHigh]: ControlId.ChannelBEqHigh,
    [ChannelControlParam.EqMid]: ControlId.ChannelBEqMid,
    [ChannelControlParam.EqLow]: ControlId.ChannelBEqLow,
  },
};

const DECK_CONTROL_IDS: Record<ControlDeckId, Record<DeckControlParam, ControlId>> = {
  [ControlDeckId.A]: {
    [DeckControlParam.Platter]: ControlId.DeckAPlatter,
    [DeckControlParam.Tempo]: ControlId.DeckATempo,
  },
  [ControlDeckId.B]: {
    [DeckControlParam.Platter]: ControlId.DeckBPlatter,
    [DeckControlParam.Tempo]: ControlId.DeckBTempo,
  },
};

export function channelId(deckId: ControlDeckId, param: ChannelControlParam): ControlId {
  return CHANNEL_CONTROL_IDS[deckId][param];
}

export function deckId(deckId: ControlDeckId, param: DeckControlParam): ControlId {
  return DECK_CONTROL_IDS[deckId][param];
}
