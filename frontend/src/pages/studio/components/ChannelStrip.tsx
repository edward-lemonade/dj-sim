import { Knob } from '@/components/Knob';
import type { ChannelState } from '../useMixerState';
import { DeckId } from '../useAudioEngine';
import { VerticalSlider } from '@/components/VerticalSlider';

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
    <div className="flex h-full min-h-0 flex-col items-center justify-end gap-4 py-4">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">{DeckId[label]}</p>
      <Knob label="High" value={value.high} onChange={(high) => onChange({ high })} />
      <Knob label="Mid" value={value.mid} onChange={(mid) => onChange({ mid })} />
      <Knob label="Low" value={value.low} onChange={(low) => onChange({ low })} />
      <VerticalSlider
        value={value.volume}
        onChange={(volume) => onChange({ volume })}
        label={`${DeckId[label]} volume`}
        className="h-28 w-6 cursor-pointer accent-zinc-200"
      />
    </div>
  );
}