import { ChannelStrip } from '@/pages/studio/components/ChannelStrip';
import type { MixerState } from '@/hooks/useMixerState';

export function Mixer({
  state,
  onChannelChange,
}: {
  state: MixerState;
  onChannelChange: (id: keyof MixerState, patch: Partial<MixerState['a']>) => void;
}) {
  return (
    <section className="flex min-h-0 flex-col border-x border-zinc-800 bg-mist-900">
      <div className="grid min-h-0 flex-1 grid-cols-2">
        <ChannelStrip label="A" value={state.a} onChange={(patch) => onChannelChange('a', patch)} />
        <ChannelStrip label="B" value={state.b} onChange={(patch) => onChannelChange('b', patch)} />
      </div>
    </section>
  );
}
