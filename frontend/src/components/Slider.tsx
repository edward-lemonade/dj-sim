import { cn } from 'cn';
import { useSyncedControl } from '@/components/ControlSelection';

type VerticalSliderProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  orientation?: 'vertical' | 'horizontal';
  automationMode?: 'slider' | 'tempo';
  referenceBpm?: number;
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
  orientation = 'vertical',
  automationMode = 'slider',
  referenceBpm,
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
      disabled={disabled}
      onChange={(event) => {
        if (!automating) move(Number(event.target.value) - value);
      }}
      // Ctrl/cmd-click selects; without this the native thumb would still jump/drag.
      onMouseDown={(event) => {
        if (automating || event.ctrlKey || event.metaKey) event.preventDefault();
      }}
      onKeyDown={(event) => {
        if (automating) event.preventDefault();
      }}
      onContextMenu={onContextMenu}
      aria-label={label}
      aria-disabled={disabled || automating || undefined}
      className={cn(
        automating && 'rounded ring-2 ring-orange-400',
        configuringAutomation && !automating && 'rounded ring-2 ring-yellow-400',
        selected && !inverted && !automating && !configuringAutomation && 'rounded ring-2 ring-sky-400',
        inverted && !automating && !configuringAutomation && 'rounded ring-2 ring-red-400',
        className,
      )}
      style={orientation === 'vertical' ? { writingMode: 'vertical-lr', direction: 'rtl' } : undefined}
      {...bind}
    />
  );
}