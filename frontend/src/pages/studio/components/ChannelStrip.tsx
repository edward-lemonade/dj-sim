import { Knob } from '@/components/Knob';
import type { ChannelState } from '@/hooks/useMixerState';

export function ChannelStrip({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ChannelState;
  onChange: (patch: Partial<ChannelState>) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-end gap-4 py-4">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">{label}</p>
      <Knob label="High" value={value.high} onChange={(high) => onChange({ high })} />
      <Knob label="Mid" value={value.mid} onChange={(mid) => onChange({ mid })} />
      <Knob label="Low" value={value.low} onChange={(low) => onChange({ low })} />
      <label className="flex flex-col items-center gap-2">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={value.volume}
          onChange={(event) => onChange({ volume: Number(event.target.value) })}
          aria-label={`${label} volume`}
          className="h-28 w-6 cursor-pointer accent-zinc-200"
          style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
        />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Vol</span>
      </label>
    </div>
  );
}
