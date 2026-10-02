import type { ReactNode } from 'react';
import { cn } from 'cn';
import { Knob } from '@/components/Knob';
import { Slider } from '@/components/Slider';
import { DECK_IDS, DeckId } from '../hooks/useAudioEngine';
import { FX_TYPES, type FxState, type FxType } from '../lib/utils/fxRack';

const TYPE_LABELS: Record<FxType, string> = {
  echo: 'Echo',
  reverb: 'Reverb',
  flanger: 'Flanger',
};

function FxButton({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  label?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-6 min-w-0 flex-1 items-center justify-center rounded-sm border px-1 disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'border-orange-400/70 bg-orange-400/15 text-orange-200' : 'text-zinc-400 hover:text-zinc-100',
      )}
    >
      <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-wider">{children}</span>
    </button>
  );
}

export function EffectsUnit({
  value,
  onChange,
  className,
}: {
  value: FxState;
  onChange: (patch: Partial<FxState>) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex h-full min-h-0 min-w-0 flex-col items-center justify-center gap-2 px-1 py-2', className)}>
      <div role="group" aria-label="Effect type" className="flex w-full flex-col gap-1">
        {FX_TYPES.map((type) => (
          <FxButton key={type} active={value.type === type} onClick={() => onChange({ type })}>
            {TYPE_LABELS[type]}
          </FxButton>
        ))}
      </div>
      <div role="group" aria-label="Effect timing" className="border-t border-white/10 pt-2">
        <Knob
          size="sm"
          label="Beats"
          value={value.division}
          min={0.25}
          max={4}
          step={0.01}
          defaultValue={1}
          disabled={value.type === 'reverb'}
          onChange={(division) => onChange({ division })}
          labelPosition="top"
        />
      </div>
      <div className="flex flex-col items-center justify-center gap-1 border-t border-white/10 pt-2">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Level</span>
        <Slider
          orientation="vertical"
          label="Effect level"
          value={value.wet}
          onChange={(wet) => onChange({ wet })}
          className="h-20 w-4 cursor-pointer accent-zinc-200"
        />
      </div>
      <div role="group" aria-label="Effect sends" className="flex w-full gap-1 border-t border-white/10 pt-2">
        {DECK_IDS.map((id) => (
          <FxButton
            key={id}
            active={value.assign[id]}
            label={`Send deck ${DeckId[id]} to effects`}
            onClick={() => onChange({ assign: { ...value.assign, [id]: !value.assign[id] } })}
          >
            {DeckId[id]}
          </FxButton>
        ))}
      </div>
    </div>
  );
}