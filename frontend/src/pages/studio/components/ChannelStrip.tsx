import { Knob } from '@/components/Knob';
import type { ChannelState } from '../useMixerState';
import { DeckId } from '../useAudioEngine';
import { Slider } from '@/components/Slider';

export function ChannelStrip({
  label,
  value,
  onChange,
}: {
  label: DeckId;
  value: ChannelState;
  onChange: (patch: Partial<ChannelState>) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-end gap-2 py-2">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">{DeckId[label]}</p>
      <Knob size="sm" label="High" value={value.high} onChange={(high) => onChange({ high })} />
      <Knob size="sm" label="Mid" value={value.mid} onChange={(mid) => onChange({ mid })} />
      <Knob size="sm" label="Low" value={value.low} onChange={(low) => onChange({ low })} />
      <Knob size="sm" label="Filter" value={value.filter} onChange={(filter) => onChange({ filter })} />
      <Slider
        value={value.volume}
        onChange={(volume) => onChange({ volume })}
        label={`${DeckId[label]} volume`}
        className="h-20 w-6 cursor-pointer accent-zinc-200"
      />
    </div>
  );
}