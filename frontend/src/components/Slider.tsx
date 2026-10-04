import { cn } from 'cn';
import { AutomationMode, useSyncedControl } from '@/components/ControlSelection';
import { useRoomControl } from '@/contexts/RoomLeaseContext';
import { ControlReleaseReason, type ControlId } from '@/lib/types/Control';

// eslint-disable-next-line react-refresh/only-export-components
export enum SliderOrientation {
  Vertical = 'vertical',
  Horizontal = 'horizontal',
}

type VerticalSliderProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  orientation?: SliderOrientation;
  automationMode?: AutomationMode.Slider | AutomationMode.Tempo;
  referenceBpm?: number;
  controlId?: ControlId;
  leaseOwner?: string;
  isLeasedByOther?: boolean;
  onLeaseAcquire?: (controlId: ControlId) => void;
  onLeaseRelease?: (controlId: ControlId, reason?: ControlReleaseReason) => void;
};

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  disabled,
  className,
  orientation = SliderOrientation.Vertical,
  automationMode = AutomationMode.Slider,
  referenceBpm,
  controlId,
  leaseOwner,
  isLeasedByOther,
  onLeaseAcquire,
  onLeaseRelease,
}: VerticalSliderProps) {
  const { selected, inverted, automating, configuringAutomation, bind, move, onContextMenu, getInteractionControlIds } = useSyncedControl({
    label,
    value,
    min,
    max,
    onChange,
    disabled,
    automationMode,
    referenceBpm,
    roomControlId: controlId,
  });
  const roomControl = useRoomControl(controlId, value, true, getInteractionControlIds);
  const displayValue = roomControl.value;
  const controlLocked = isLeasedByOther || roomControl.isLeasedByOther;
  const currentLeaseOwner = leaseOwner ?? roomControl.leaseOwner;

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={displayValue}
      disabled={disabled || controlLocked}
      onChange={(event) => {
        if (!automating && !controlLocked) move(Number(event.target.value) - value);
      }}
      // Ctrl/cmd-click selects; without this the native thumb would still jump/drag.
      onMouseDown={(event) => {
        if (automating || controlLocked || event.ctrlKey || event.metaKey) event.preventDefault();
        if (!automating && !controlLocked) {
          roomControl.onLeaseAcquire?.();
          if (!roomControl.onLeaseAcquire && controlId) onLeaseAcquire?.(controlId);
        }
      }}
      onPointerUp={() => roomControl.onLeaseRelease?.()}
      onPointerCancel={() => roomControl.onLeaseRelease?.(ControlReleaseReason.PointerCancel)}
      onBlur={() => {
        roomControl.onLeaseRelease?.(ControlReleaseReason.LostCapture);
        if (!roomControl.onLeaseRelease && controlId) onLeaseRelease?.(controlId, ControlReleaseReason.LostCapture);
      }}
      onKeyDown={(event) => {
        if (automating || controlLocked) {
          event.preventDefault();
        } else if (['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
          roomControl.onLeaseAcquire?.();
        }
      }}
      onKeyUp={() => roomControl.onLeaseRelease?.()}
      onContextMenu={onContextMenu}
      aria-label={controlLocked ? `${label} (controlled by ${currentLeaseOwner})` : label}
      aria-disabled={disabled || automating || controlLocked || undefined}
      className={cn(
        automating && 'rounded ring-2 ring-orange-400',
        configuringAutomation && !automating && 'rounded ring-2 ring-yellow-400',
        selected && !inverted && !automating && !configuringAutomation && 'rounded ring-2 ring-sky-400',
        inverted && !automating && !configuringAutomation && 'rounded ring-2 ring-red-400',
        controlLocked && 'rounded ring-2 ring-amber-400 cursor-not-allowed opacity-70',
        className,
      )}
      style={orientation === SliderOrientation.Vertical ? { writingMode: 'vertical-lr', direction: 'rtl' } : undefined}
      {...bind}
    />
  );
}