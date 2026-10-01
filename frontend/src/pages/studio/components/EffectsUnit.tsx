import type { ReactNode } from 'react';
import { cn } from 'cn';
import { Slider } from '@/components/Slider';
import { DECK_IDS, DeckId } from '../useAudioEngine';
import { FX_DIVISIONS, FX_TYPES, type FxDivision, type FxState, type FxType } from '../fxRack';

const TYPE_LABELS: Record<FxType, string> = {
  echo: 'Echo',
  reverb: 'Reverb',
  flanger: 'Flanger',
};

const DIVISION_LABELS: Record<FxDivision, string> = {
  0.25: '1/4',
  0.5: '1/2',
  0.75: '3/4',
  1: '1',
  2: '2',
  4: '4',
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
        active ? 'border-orange-400/70 bg-orange-400/15 text-orange-200' : 'border-zinc-700 text-zinc-400 hover:text-zinc-100',
      )}
    >
      <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-wider">{children}</span>
    </button>
  );
}

export function EffectsUnit({
  value,
  onChange,
}: {
  value: FxState;
  onChange: (patch: Partial<FxState>) => void;
}) {
  const beatSynced = value.type !== 'reverb';

  return (
    <div className="flex flex-col gap-1.5 border-t border-zinc-800 px-3 py-2">
      <div className="flex gap-1">
        {FX_TYPES.map((type) => (
          <FxButton key={type} active={value.type === type} onClick={() => onChange({ type })}>
            {TYPE_LABELS[type]}
          </FxButton>
        ))}
      </div>
      <div className="flex gap-1">
        {FX_DIVISIONS.map((division) => (
          <FxButton
            key={division}
            active={value.division === division}
            disabled={!beatSynced}
            label={`${DIVISION_LABELS[division]} beat`}
            onClick={() => onChange({ division })}
          >
            {DIVISION_LABELS[division]}
          </FxButton>
        ))}
      </div>
      <Slider
        orientation="horizontal"
        label="Effect level"
        value={value.wet}
        onChange={(wet) => onChange({ wet })}
        className="w-full cursor-pointer accent-zinc-200"
      />
      <div className="flex gap-1">
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