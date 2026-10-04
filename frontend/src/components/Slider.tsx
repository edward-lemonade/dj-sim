import { cn } from 'cn';
import { AutomationMode, useSyncedControl } from '@/components/ControlSelection';
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
  const { selected, inverted, automating, configuringAutomation, bind, move, onContextMenu } = useSyncedControl({
    label,
    value,
    min,
    max,
    onChange,
    disabled,
    automationMode,
    referenceBpm,
  });

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled || isLeasedByOther}
      onChange={(event) => {
        if (!automating && !isLeasedByOther) move(Number(event.target.value) - value);
      }}
      // Ctrl/cmd-click selects; without this the native thumb would still jump/drag.
      onMouseDown={(event) => {
        if (automating || isLeasedByOther || event.ctrlKey || event.metaKey) event.preventDefault();
        if (controlId && !automating && !isLeasedByOther) onLeaseAcquire?.(controlId);
      }}
      onBlur={() => {
        if (controlId) onLeaseRelease?.(controlId, ControlReleaseReason.LostCapture);
      }}
      onKeyDown={(event) => {
        if (automating || isLeasedByOther) event.preventDefault();
      }}
      onContextMenu={onContextMenu}
      aria-label={isLeasedByOther ? `${label} (controlled by ${leaseOwner})` : label}
      aria-disabled={disabled || automating || isLeasedByOther || undefined}
      className={cn(
        automating && 'rounded ring-2 ring-orange-400',
        configuringAutomation && !automating && 'rounded ring-2 ring-yellow-400',
        selected && !inverted && !automating && !configuringAutomation && 'rounded ring-2 ring-sky-400',
        inverted && !automating && !configuringAutomation && 'rounded ring-2 ring-red-400',
        isLeasedByOther && 'rounded ring-2 ring-amber-400 cursor-not-allowed opacity-70',
        className,
      )}
      style={orientation === SliderOrientation.Vertical ? { writingMode: 'vertical-lr', direction: 'rtl' } : undefined}
      {...bind}
    />
  );
}