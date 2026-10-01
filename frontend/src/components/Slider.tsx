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
}: VerticalSliderProps) {
  const { selected, inverted, bind, move } = useSyncedControl({ value, min, max, onChange, disabled });

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(event) => move(Number(event.target.value) - value)}
      // Ctrl/cmd-click selects; without this the native thumb would still jump/drag.
      onMouseDown={(event) => {
        if (event.ctrlKey || event.metaKey) event.preventDefault();
      }}
      aria-label={label}
      className={cn(
        selected && !inverted && 'rounded ring-2 ring-sky-400',
        inverted && 'rounded ring-2 ring-red-400',
        className,
      )}
      style={orientation === 'vertical' ? { writingMode: 'vertical-lr', direction: 'rtl' } : undefined}
      {...bind}
    />
  );
}