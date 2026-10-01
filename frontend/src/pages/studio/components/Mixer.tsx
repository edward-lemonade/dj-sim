import { ChannelStrip } from '@/pages/studio/components/ChannelStrip';
import { EffectsUnit } from '@/pages/studio/components/EffectsUnit';
import { DECK_IDS, DeckId } from '../useAudioEngine';
import type { FxState } from '../fxRack';
import type { ChannelState, MixerState } from '../useMixerState';

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
    <section className="flex min-h-0 flex-col border-x border-zinc-800 bg-mist-900">
      {/* Column count follows DECK_IDS — add a deck in deckId.ts and a strip appears here automatically. */}
      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: `repeat(${DECK_IDS.length}, minmax(0, 1fr))` }}>
        {DECK_IDS.map((id) => (
          <ChannelStrip
            key={id}
            label={id}
            value={state.channelState[id]}
            onChange={(patch) => onChannelChange(id, patch)}
          />
        ))}
      </div>
      <EffectsUnit value={state.fx} onChange={onFxChange} />
      <div className="flex flex-col items-center gap-2 border-t border-zinc-800 px-4 py-3">
        <span className="text-xs uppercase tracking-wide text-zinc-500">Master</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={state.master}
          onChange={(e) => onMasterChange(Number(e.target.value))}
          className="w-full"
          aria-label="Master volume"
        />
      </div>
    </section>
  );
}