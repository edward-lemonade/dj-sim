import { useCallback, useState } from 'react';

export type ChannelState = {
  high: number;
  mid: number;
  low: number;
  volume: number;
};

export type MixerState = {
  a: ChannelState;
  b: ChannelState;
};

const defaultChannel = (): ChannelState => ({
  high: 0,
  mid: 0,
  low: 0,
  volume: 0.8,
});

export function useMixerState() {
  const [state, setState] = useState<MixerState>({
    a: defaultChannel(),
    b: defaultChannel(),
  });

  const setChannel = useCallback((id: keyof MixerState, patch: Partial<ChannelState>) => {
    setState((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
  }, []);

  return { state, setChannel };
}
