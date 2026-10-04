import { useCallback, useRef } from 'react';
import { cn } from 'cn';
import { AutomationMode, useSyncedControl } from '@/components/ControlSelection';
import { ControlReleaseReason, type ControlId } from '@/lib/types/Control';

// eslint-disable-next-line react-refresh/only-export-components
export enum KnobSize {
  Small = 'sm',
  Medium = 'md',
}

// eslint-disable-next-line react-refresh/only-export-components
export enum KnobLabelPosition {
  Top = 'top',
  Bottom = 'bottom',
}

type KnobProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
  disabled?: boolean;
  size?: KnobSize;
  labelPosition?: KnobLabelPosition;
  controlId?: ControlId;
  leaseOwner?: string;
  isLeasedByOther?: boolean;
  onLeaseAcquire?: (controlId: ControlId) => void;
  onLeaseRelease?: (controlId: ControlId, reason?: ControlReleaseReason) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function Knob({
  label,
  value,
  onChange,
  min = -1,
  max = 1,
  step = 0.02,
  defaultValue = 0,
  disabled,
  size = KnobSize.Medium,
  labelPosition = KnobLabelPosition.Bottom,
  controlId,
  leaseOwner,
  isLeasedByOther,
  onLeaseAcquire,
  onLeaseRelease,
}: KnobProps) {
  const dragRef = useRef<{ lastY: number } | null>(null);
  const range = max - min;
  const t = range === 0 ? 0 : (clamp(value, min, max) - min) / range;
  const angle = -135 + t * 270;
  const { selected, inverted, automating, configuringAutomation, bind, move, onContextMenu } = useSyncedControl({
    label,
    value,
    min,
    max,
    onChange,
    disabled,
    automationMode: AutomationMode.Knob,
  });

  const nudge = useCallback(
    (delta: number) => {
      if (disabled) return;
      move(delta);
    },
    [disabled, move],
  );

  return (
    <div className={cn(
      'flex items-center gap-1',
      labelPosition === KnobLabelPosition.Top ? 'flex-col-reverse' : 'flex-col',
    )}>
      <div
        role="slider"
        tabIndex={disabled || automating || isLeasedByOther ? -1 : 0}
        aria-label={isLeasedByOther ? `${label} (controlled by ${leaseOwner})` : label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(value.toFixed(3))}
        aria-disabled={disabled || automating || isLeasedByOther || undefined}
        className={cn(
          'relative cursor-ns-resize touch-none rounded-full border bg-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-zinc-400',
          size === 'sm' ? 'size-9' : 'size-12',
          automating && 'ring-2 ring-orange-400 focus-visible:ring-orange-400',
          configuringAutomation && !automating && 'ring-2 ring-yellow-400 focus-visible:ring-yellow-400',
          selected && !inverted && !automating && !configuringAutomation && 'ring-2 ring-sky-400 focus-visible:ring-sky-400',
          inverted && !automating && !configuringAutomation && 'ring-2 ring-red-400 focus-visible:ring-red-400',
          isLeasedByOther && 'ring-2 ring-amber-400 focus-visible:ring-amber-400 cursor-not-allowed opacity-70',
          (disabled || automating) && 'cursor-not-allowed opacity-60',
        )}
        {...bind}
        onContextMenu={onContextMenu}
        onPointerDown={(event) => {
          if (disabled || automating || isLeasedByOther) return;
          if (controlId) onLeaseAcquire?.(controlId);
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { lastY: event.clientY };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          const dy = drag.lastY - event.clientY;
          drag.lastY = event.clientY;
          move((dy / 120) * range);
        }}
        onPointerUp={() => {
          if (controlId) onLeaseRelease?.(controlId);
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          if (controlId) onLeaseRelease?.(controlId, ControlReleaseReason.PointerCancel);
          dragRef.current = null;
        }}
        onDoubleClick={() => {
          if (!disabled && !automating) onChange(defaultValue);
        }}
        onKeyDown={(event) => {
          if (automating) {
            event.preventDefault();
            return;
          }
          if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
            event.preventDefault();
            nudge(step);
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
            event.preventDefault();
            nudge(-step);
          } else if (event.key === 'Home') {
            event.preventDefault();
            onChange(defaultValue);
          }
        }}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{ transform: `rotate(${angle}deg)` }}
        >
          <div className="absolute left-1/2 top-[8%] h-[38%] w-0.5 -translate-x-1/2 rounded-full bg-zinc-100" />
        </div>
        <div className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-500" />
      </div>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
    </div>
  );
}