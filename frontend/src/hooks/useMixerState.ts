import { useCallback, useState } from 'react';
import { DECK_IDS, type DeckId } from './useAudioEngine';
import { FxType, type FxState } from '../lib/utils/fxRack';

export type ChannelState = {
  high: number; // [-1, 1], 0 = flat
  mid: number; // [-1, 1], 0 = flat
  low: number; // [-1, 1], 0 = flat
  filter: number; // [-1, 1], 0 = off, negative = low-pass, positive = high-pass
  volume: number; // [0, 1]
  tempo: number; // percent, e.g. [-8, 8], 0 = normal speed
};

export type MixerState = {
  channelState: Record<DeckId, ChannelState>;
  fx: FxState;
  tempoMaster: DeckId | null; // every other deck's tempo follows this one, null = off
  master: number; // [0, 1]
};

const defaultChannel = (): ChannelState => ({
  high: 0,
  mid: 0,
  low: 0,
  filter: 0,
  volume: 0.8,
  tempo: 0,
});

// Built from DECK_IDS, so going to 4 decks means adding members in
// deckId.ts — nothing here changes.
function defaultChannelState(): Record<DeckId, ChannelState> {
  return DECK_IDS.reduce(
    (acc, id) => {
      acc[id] = defaultChannel();
      return acc;
    },
    {} as Record<DeckId, ChannelState>,
  );
}

function defaultFxAssign(): Record<DeckId, boolean> {
  return DECK_IDS.reduce(
    (acc, id) => {
      acc[id] = false;
      return acc;
    },
    {} as Record<DeckId, boolean>,
  );
}

export function useMixerState() {
  const [state, setState] = useState<MixerState>(() => ({
    channelState: defaultChannelState(),
    fx: { type: FxType.Echo, division: 1, wet: 0, assign: defaultFxAssign() },
    tempoMaster: null,
    master: 0.9,
  }));

  const setChannel = useCallback((id: DeckId, patch: Partial<ChannelState>) => {
    setState((current) => ({
      ...current,
      channelState: {
        ...current.channelState,
        [id]: { ...current.channelState[id], ...patch },
      },
    }));
  }, []);

  const setFx = useCallback((patch: Partial<FxState>) => {
    setState((current) => ({ ...current, fx: { ...current.fx, ...patch } }));
  }, []);

  const setTempoMaster = useCallback((id: DeckId | null) => {
    setState((current) => ({ ...current, tempoMaster: id }));
  }, []);

  const setMaster = useCallback((value: number) => {
    setState((current) => ({ ...current, master: value }));
  }, []);

  return { state, setChannel, setFx, setTempoMaster, setMaster };
}