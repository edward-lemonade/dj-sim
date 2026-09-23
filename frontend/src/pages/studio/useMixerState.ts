import { useCallback, useState } from 'react';
import { DECK_IDS, type DeckId } from './useAudioEngine';

export type ChannelState = {
  high: number; // [-1, 1], 0 = flat
  mid: number; // [-1, 1], 0 = flat
  low: number; // [-1, 1], 0 = flat
  volume: number; // [0, 1]
  tempo: number; // percent, e.g. [-8, 8], 0 = normal speed
};

export type MixerState = {
  channelState: Record<DeckId, ChannelState>;
  master: number; // [0, 1]
};

const defaultChannel = (): ChannelState => ({
  high: 0,
  mid: 0,
  low: 0,
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

export function useMixerState() {
  const [state, setState] = useState<MixerState>(() => ({
    channelState: defaultChannelState(),
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

  const setMaster = useCallback((value: number) => {
    setState((current) => ({ ...current, master: value }));
  }, []);

  return { state, setChannel, setMaster };
}