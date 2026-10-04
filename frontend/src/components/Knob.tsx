import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from 'cn';
import { AutomationMode, useSyncedControl } from '@/components/ControlSelection';
import { useRoomControl } from '@/contexts/RoomLeaseContext';
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
  const dragRef = useRef<{ lastY: number; value: number } | null>(null);
  const [dragDisplayValue, setDragDisplayValue] = useState<number | null>(null);
  const { selected, inverted, automating, configuringAutomation, bind, move, onContextMenu, getInteractionControlIds } = useSyncedControl({
    label,
    value,
    min,
    max,
    onChange,
    disabled,
    automationMode: AutomationMode.Knob,
    roomControlId: controlId,
    setInteractionValue: setDragDisplayValue,
  });
  const roomControl = useRoomControl(controlId, value, true, getInteractionControlIds);
  const displayValue = roomControl.value;
  const controlLocked = isLeasedByOther || roomControl.isLeasedByOther;
  const currentLeaseOwner = leaseOwner ?? roomControl.leaseOwner;
  const range = max - min;
  const visibleValue = dragDisplayValue ?? displayValue;
  const t = range === 0 ? 0 : (clamp(visibleValue, min, max) - min) / range;
  const angle = -135 + t * 270;

  useEffect(() => {
    if (dragRef.current === null && dragDisplayValue !== null && Math.abs(value - dragDisplayValue) < 0.001) {
      setDragDisplayValue(null);
    }
  }, [dragDisplayValue, value]);

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
        tabIndex={disabled || automating || controlLocked ? -1 : 0}
        aria-label={controlLocked ? `${label} (controlled by ${currentLeaseOwner})` : label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(visibleValue.toFixed(3))}
        aria-disabled={disabled || automating || controlLocked || undefined}
        className={cn(
          'relative cursor-ns-resize touch-none rounded-full border bg-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-zinc-400',
          size === 'sm' ? 'size-9' : 'size-12',
          automating && 'ring-2 ring-orange-400 focus-visible:ring-orange-400',
          configuringAutomation && !automating && 'ring-2 ring-yellow-400 focus-visible:ring-yellow-400',
          selected && !inverted && !automating && !configuringAutomation && 'ring-2 ring-sky-400 focus-visible:ring-sky-400',
          inverted && !automating && !configuringAutomation && 'ring-2 ring-red-400 focus-visible:ring-red-400',
          controlLocked && 'ring-2 ring-amber-400 focus-visible:ring-amber-400 cursor-not-allowed opacity-70',
          (disabled || automating) && 'cursor-not-allowed opacity-60',
        )}
        {...bind}
        onContextMenu={onContextMenu}
        onPointerDown={(event) => {
          if (disabled || automating || controlLocked) return;
          roomControl.onLeaseAcquire?.();
          if (!roomControl.onLeaseAcquire && controlId) onLeaseAcquire?.(controlId);
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { lastY: event.clientY, value };
          setDragDisplayValue(value);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          const dy = drag.lastY - event.clientY;
          drag.lastY = event.clientY;
          const nextValue = clamp(drag.value + (dy / 120) * range, min, max);
          drag.value = nextValue;
          setDragDisplayValue(nextValue);
          if (selected) {
            move((dy / 120) * range);
          } else {
            onChange(Number(nextValue.toFixed(3)));
          }
        }}
        onPointerUp={() => {
          roomControl.onLeaseRelease?.();
          if (!roomControl.onLeaseRelease && controlId) onLeaseRelease?.(controlId);
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          roomControl.onLeaseRelease?.(ControlReleaseReason.PointerCancel);
          if (!roomControl.onLeaseRelease && controlId) onLeaseRelease?.(controlId, ControlReleaseReason.PointerCancel);
          dragRef.current = null;
        }}
        onDoubleClick={() => {
          if (disabled || automating || controlLocked) return;
          roomControl.onLeaseAcquire?.();
          if (!roomControl.onLeaseAcquire && controlId) onLeaseAcquire?.(controlId);
          onChange(defaultValue);
          roomControl.onLeaseRelease?.();
          if (!roomControl.onLeaseRelease && controlId) onLeaseRelease?.(controlId);
        }}
        onKeyDown={(event) => {
          if (disabled || automating || controlLocked) {
            event.preventDefault();
            return;
          }
          if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home'].includes(event.key)) return;
          roomControl.onLeaseAcquire?.();
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
        onKeyUp={() => roomControl.onLeaseRelease?.()}
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