import { useCallback, useRef } from 'react';
import { cn } from 'cn';
import { useSyncedControl } from '@/components/ControlSelection';

type KnobProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
  disabled?: boolean;
  size?: 'sm' | 'md';
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
  size = 'md',
}: KnobProps) {
  const dragRef = useRef<{ lastY: number } | null>(null);
  const range = max - min;
  const t = range === 0 ? 0 : (clamp(value, min, max) - min) / range;
  const angle = -135 + t * 270;
  const { selected, inverted, bind, move } = useSyncedControl({ value, min, max, onChange, disabled });

  const nudge = useCallback(
    (delta: number) => {
      if (disabled) return;
      move(delta);
    },
    [disabled, move],
  );

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(value.toFixed(3))}
        aria-disabled={disabled || undefined}
        className={cn(
          'relative cursor-ns-resize touch-none rounded-full border border-zinc-600 bg-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-zinc-400',
          size === 'sm' ? 'size-9' : 'size-12',
          selected && !inverted && 'ring-2 ring-sky-400 focus-visible:ring-sky-400',
          inverted && 'ring-2 ring-red-400 focus-visible:ring-red-400',
          disabled && 'cursor-not-allowed opacity-40',
        )}
        {...bind}
        onPointerDown={(event) => {
          if (disabled) return;
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
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onDoubleClick={() => {
          if (!disabled) onChange(defaultValue);
        }}
        onKeyDown={(event) => {
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