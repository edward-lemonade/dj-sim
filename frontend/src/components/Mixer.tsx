import { ChannelStrip } from '@/components/ChannelStrip';
import { EffectsUnit } from '@/components/EffectsUnit';
import { Slider } from '@/components/Slider';
import { DECK_IDS, DeckId } from '../hooks/useAudioEngine';
import type { FxState } from '../lib/utils/fxRack';
import type { ChannelState, MixerState } from '../hooks/useMixerState';
import { ControlId } from '@/lib/types/Control';

export function Mixer({
  state,
  onChannelChange,
  onFxChange,
  onMasterChange,
}: {
  state: MixerState;
  onChannelChange: (id: DeckId, patch: Partial<ChannelState>) => void;
  onFxChange: (patch: Partial<FxState>) => void;
  onMasterChange: (value: number) => void;
}) {
  return (
    <section className="grid min-h-0 min-w-0 grid-cols-4 overflow-hidden border-x bg-mist-900">
      <div className="flex min-h-0 flex-col items-center justify-center gap-2 border-r border-white/10 px-1 py-2">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Master</span>
        <Slider
          value={state.master}
          onChange={onMasterChange}
          label="Master volume"
          controlId={ControlId.MasterVolume}
          className="h-32 w-5 flex-none cursor-pointer accent-zinc-200"
        />
      </div>
      {DECK_IDS.map((id) => (
        <ChannelStrip
          key={id}
          label={id}
          value={state.channelState[id]}
          onChange={(patch) => onChannelChange(id, patch)}
        />
      ))}
      <EffectsUnit value={state.fx} onChange={onFxChange} className="min-h-0 min-w-0 justify-center border-l-0 border-t-0 px-1 py-2" />
    </section>
  );
}