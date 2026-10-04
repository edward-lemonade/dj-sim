import { Knob, KnobLabelPosition, KnobSize } from '@/components/Knob';
import type { ChannelState } from '../hooks/useMixerState';
import { DeckId } from '../hooks/useAudioEngine';
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
    <div className="flex h-full min-h-0 min-w-0 flex-col items-center justify-center gap-1 border-r border-white/10 px-0.5 py-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{DeckId[label]}</p>
      <Knob size={KnobSize.Small} label="High" value={value.high} onChange={(high) => onChange({ high })} labelPosition={KnobLabelPosition.Top} />
      <Knob size={KnobSize.Small} label="Mid" value={value.mid} onChange={(mid) => onChange({ mid })} labelPosition={KnobLabelPosition.Top} />
      <Knob size={KnobSize.Small} label="Low" value={value.low} onChange={(low) => onChange({ low })} labelPosition={KnobLabelPosition.Top} />
      <Knob size={KnobSize.Small} label="Filter" value={value.filter} onChange={(filter) => onChange({ filter })} labelPosition={KnobLabelPosition.Top} />
      <div className="flex flex-col items-center gap-1">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Volume</span>
        <Slider
          value={value.volume}
          onChange={(volume) => onChange({ volume })}
          label={`${DeckId[label]} volume`}
          className="h-12 w-6 cursor-pointer accent-zinc-200"
        />
      </div>
    </div>
  );
}