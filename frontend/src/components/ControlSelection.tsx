import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';

type Control = {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  automationMode?: AutomationMode;
  referenceBpm?: number;
};

type AutomationUnit = 'beats' | 'seconds';
type AutomationMode = 'knob' | 'slider' | 'tempo';
type AutomationPopupState = { id: string; x: number; y: number } | null;

type SelectionApi = {
  register: (id: string, control: Control) => void;
  unregister: (id: string) => void;
  move: (id: string, delta: number) => void;
  openAutomation: (id: string, x: number, y: number) => void;
  startAutomation: (id: string, target: number, duration: number, unit: AutomationUnit) => void;
  stopAutomation: (id: string) => void;
};

const SelectionContext = createContext<{
  api: SelectionApi;
  selected: ReadonlySet<string>;
  automating: ReadonlySet<string>;
  automationPopupId: string | null;
  shiftHeld: boolean;
  activeId: string | null;
} | null>(null);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function ControlSelectionProvider({ children, bpm = 0 }: { children: ReactNode; bpm?: number }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const selectedRef = useRef(selected);
  const controls = useRef(new Map<string, Control>());
  const automations = useRef(new Map<string, { frameId: number }>());
  const [automating, setAutomating] = useState<ReadonlySet<string>>(new Set());
  const automatingRef = useRef(automating);
  const [popup, setPopup] = useState<AutomationPopupState>(null);
  const bpmRef = useRef(bpm);
  bpmRef.current = bpm;
  const shiftRef = useRef(false);
  // Mirrors shiftRef for rendering; the ref stays because move() needs the live value.
  const [shiftHeld, setShiftHeld] = useState(false);
  // The control currently being dragged, so it can stay blue while the rest go red.
  const [activeId, setActiveId] = useState<string | null>(null);

  const update = useCallback((next: ReadonlySet<string>) => {
    selectedRef.current = next;
    setSelected(next);
  }, []);

  const setAutomationState = useCallback((next: ReadonlySet<string>) => {
    automatingRef.current = next;
    setAutomating(next);
  }, []);

  const stopAutomation = useCallback((id: string) => {
    const animation = automations.current.get(id);
    if (!animation) return;
    cancelAnimationFrame(animation.frameId);
    automations.current.delete(id);
    const next = new Set(automatingRef.current);
    next.delete(id);
    setAutomationState(next);
  }, [setAutomationState]);

  const api = useMemo<SelectionApi>(() => ({
    register: (id, control) => {
      controls.current.set(id, control);
    },
    unregister: (id) => {
      controls.current.delete(id);
      stopAutomation(id);
      setPopup((current) => current?.id === id ? null : current);
      if (!selectedRef.current.has(id)) return;
      const next = new Set(selectedRef.current);
      next.delete(id);
      update(next);
    },
    // Deltas are normalized by each control's range, so a knob ([-1, 1]) and
    // a tempo slider ([-50, 50]) travel the same fraction of their travel.
    move: (id, delta) => {
      const source = controls.current.get(id);
      if (!source || source.max === source.min || automatingRef.current.has(id)) return;
      const normalized = delta / (source.max - source.min);
      const targets = selectedRef.current.has(id) ? selectedRef.current : new Set([id]);
      targets.forEach((targetId) => {
        const target = controls.current.get(targetId);
        if (!target || automatingRef.current.has(targetId)) return;
        const sign = targetId === id || !shiftRef.current ? 1 : -1;
        const next = target.value + sign * normalized * (target.max - target.min);
        target.onChange(Number(clamp(next, target.min, target.max).toFixed(3)));
      });
    },
    openAutomation: (id, x, y) => {
      if (automatingRef.current.has(id)) {
        stopAutomation(id);
        setPopup(null);
        return;
      }
      if (selectedRef.current.has(id) || !controls.current.has(id)) return;
      setPopup({
        id,
        x: Math.max(8, Math.min(x, window.innerWidth - 188)),
        y: Math.max(8, Math.min(y, window.innerHeight - 212)),
      });
    },
    startAutomation: (id, target, duration, unit) => {
      const control = controls.current.get(id);
      if (!control || !Number.isFinite(target) || !Number.isFinite(duration) || duration <= 0) return;
      stopAutomation(id);
      const startValue = control.value;
      const endValue = control.automationMode === 'tempo' ? target : clamp(target, control.min, control.max);
      let elapsed = 0;
      let previousTime: number | null = null;
      const animation = { frameId: 0 };
      automations.current.set(id, animation);
      const nextAutomating = new Set(automatingRef.current);
      nextAutomating.add(id);
      setAutomationState(nextAutomating);
      if (selectedRef.current.has(id)) {
        const nextSelected = new Set(selectedRef.current);
        nextSelected.delete(id);
        update(nextSelected);
      }

      const tick = (now: number) => {
        if (automations.current.get(id) !== animation) return;
        if (previousTime !== null) {
          const deltaSeconds = (now - previousTime) / 1000;
          elapsed += unit === 'beats' ? deltaSeconds * bpmRef.current / 60 : deltaSeconds;
        }
        previousTime = now;
        const progress = Math.min(1, elapsed / duration);
        const liveControl = controls.current.get(id);
        if (!liveControl) {
          stopAutomation(id);
          return;
        }
        liveControl.onChange(startValue + (endValue - startValue) * progress);
        if (progress >= 1) {
          stopAutomation(id);
          return;
        }
        animation.frameId = requestAnimationFrame(tick);
      };
      animation.frameId = requestAnimationFrame(tick);
      setPopup(null);
    },
    stopAutomation,
  }), [setAutomationState, stopAutomation, update]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Shift') return;
      shiftRef.current = event.type === 'keydown';
      setShiftHeld(shiftRef.current);
    };
    const onBlur = () => {
      shiftRef.current = false;
      setShiftHeld(false);
    };
    const onPointerUp = () => setActiveId(null);
    // Capture phase, so a ctrl/cmd-click toggles selection before the control's
    // own pointer handlers can start a drag.
    const onPointerDown = (event: PointerEvent) => {
      const id = (event.target as Element).closest('[data-control-id]')?.getAttribute('data-control-id');
      if (id && (event.ctrlKey || event.metaKey)) {
        if (automatingRef.current.has(id)) return;
        event.stopPropagation();
        const next = new Set(selectedRef.current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        update(next);
      } else if (id && selectedRef.current.has(id)) {
        setActiveId(id);
      } else if (selectedRef.current.size) {
        update(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [update]);

  useEffect(() => () => {
    automations.current.forEach(({ frameId }) => cancelAnimationFrame(frameId));
    automations.current.clear();
  }, []);

  const context = useMemo(
    () => ({ api, selected, automating, automationPopupId: popup?.id ?? null, shiftHeld, activeId }),
    [api, selected, automating, popup, shiftHeld, activeId],
  );

  const popupControl = popup ? controls.current.get(popup.id) : null;

  return (
    <SelectionContext.Provider value={context}>
      {children}
      {popup && popupControl ? (
        <AutomationPopup
          key={popup.id}
          control={popupControl}
          position={popup}
          bpm={bpm}
          onClose={() => setPopup(null)}
          onStart={(target, duration, unit) => api.startAutomation(popup.id, target, duration, unit)}
        />
      ) : null}
    </SelectionContext.Provider>
  );
}

function AutomationPopup({
  control,
  position,
  bpm,
  onClose,
  onStart,
}: {
  control: Control;
  position: NonNullable<AutomationPopupState>;
  bpm: number;
  onClose: () => void;
  onStart: (target: number, duration: number, unit: AutomationUnit) => void;
}) {
  const [endpoint, setEndpoint] = useState<'low' | 'mid' | 'high' | 'custom'>('high');
  const [customValue, setCustomValue] = useState('');
  const [unit, setUnit] = useState<AutomationUnit>('beats');
  const [duration, setDuration] = useState('4');
  const customTarget = Number(customValue);
  const parsedDuration = Number(duration);
  const mode = control.automationMode ?? 'slider';
  const referenceBpm = control.referenceBpm ?? 0;
  const rangeMin = mode === 'knob' ? -100 : mode === 'slider' ? 0 : referenceBpm * (1 + control.min / 100);
  const rangeMax = mode === 'knob' ? 100 : mode === 'slider' ? 100 : referenceBpm * (1 + control.max / 100);
  const toControlValue = (value: number) => {
    if (mode === 'tempo') return (value / referenceBpm - 1) * 100;
    if (mode === 'knob') return control.min + ((value + 100) / 200) * (control.max - control.min);
    return control.min + (value / 100) * (control.max - control.min);
  };
  const endpointValue = endpoint === 'low' ? rangeMin : endpoint === 'mid' ? (rangeMin + rangeMax) / 2 : rangeMax;
  const target = toControlValue(endpoint === 'custom' ? customTarget : endpointValue);
  const customValueIsValid = mode === 'tempo'
    ? referenceBpm > 0 && customTarget > 0
    : customTarget >= rangeMin && customTarget <= rangeMax;
  const canStart = Number.isFinite(target)
    && (endpoint !== 'custom' || (customValue.trim() !== '' && customValueIsValid))
    && Number.isFinite(parsedDuration)
    && parsedDuration > 0
    && (unit !== 'beats' || bpm > 0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-100" onPointerDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Automate ${control.label}`}
        className="fixed w-40 border border-zinc-600 bg-[#111418] px-2 pb-2 pt-1 text-zinc-200 shadow-2xl"
        style={{ left: position.x, top: position.y }}
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <fieldset>
          <legend className="mb-0.5 text-[9px] uppercase tracking-wider text-zinc-400">Ending value</legend>
          <div className="grid grid-cols-4 gap-1">
            {(['low', 'mid', 'high'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={endpoint === option}
                onClick={() => setEndpoint(option)}
                className={cn(
                  'flex h-6 items-center justify-center border text-[9px] capitalize',
                  endpoint === option ? 'border-orange-400 bg-orange-400/15 text-orange-200' : 'border-zinc-700 text-zinc-400 hover:text-zinc-100',
                )}
              >
                <span className="text-[9px] leading-none">{option}</span>
              </button>
            ))}
            <input
              type="text"
              inputMode="decimal"
              aria-label={`${control.label} custom ending value${mode === 'tempo' ? ' in BPM' : ''}`}
              placeholder={mode === 'tempo' ? 'BPM' : 'Custom'}
              value={customValue}
              onFocus={() => setEndpoint('custom')}
              onChange={(event) => {
                setCustomValue(event.target.value);
                setEndpoint('custom');
              }}
              className={cn(
                'h-6 min-w-0 w-full border bg-[#0b0d10] px-0 text-center text-[9px] leading-none text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-orange-400',
                endpoint === 'custom' ? 'border-orange-400 bg-orange-400/15 text-orange-200' : 'border-zinc-700',
              )}
            />
          </div>
        </fieldset>
        <fieldset className="mt-2">
          <legend className="mb-1 text-[9px] uppercase tracking-wider text-zinc-400">Ramp time</legend>
          <div className="grid grid-cols-2 gap-1">
            {(['beats', 'seconds'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={unit === option}
                onClick={() => setUnit(option)}
                className={cn(
                  'flex h-6 items-center justify-center border text-[9px] capitalize',
                  unit === option ? 'border-orange-400 bg-orange-400/15 text-orange-200' : 'border-zinc-700 text-zinc-400 hover:text-zinc-100',
                )}
              >
                <span className="text-[9px] leading-none">{option}</span>
              </button>
            ))}
          </div>
          <label className="mt-1.5 block text-[9px] uppercase tracking-wider text-zinc-400">
            Duration {unit === 'beats' ? `(${bpm > 0 ? `${bpm.toFixed(1)} BPM` : 'BPM unavailable'})` : '(seconds)'}
            <input
              type="number"
              value={duration}
              min="0.1"
              step={unit === 'beats' ? '0.25' : '0.1'}
              onChange={(event) => setDuration(event.target.value)}
              className="mt-1 h-6 w-full border border-zinc-700 bg-[#0b0d10] px-2 text-[9px] text-zinc-100 outline-none focus:border-orange-400"
            />
          </label>
        </fieldset>
        <Button
          type="button"
          className="mt-2 h-6 w-full bg-orange-400 text-[9px] text-zinc-950 hover:bg-orange-300"
          disabled={!canStart}
          onClick={() => {
            onStart(target, parsedDuration, unit);
            onClose();
          }}
        >
            <span className="text-[9px] leading-none">Automate</span>
        </Button>
      </section>
    </div>,
    document.body,
  );
}

export function useSyncedControl({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
  automationMode = 'slider',
  referenceBpm,
}: Control & { disabled?: boolean }) {
  const context = useContext(SelectionContext);
  if (!context) throw new Error('useSyncedControl must be used inside ControlSelectionProvider');
  const { api, selected, automating, automationPopupId, shiftHeld, activeId } = context;
  const id = useId();

  // Re-registers every render so the provider always sees the latest value/onChange.
  useEffect(() => {
    api.register(id, { label, value, min, max, onChange, automationMode, referenceBpm });
  });
  useEffect(() => () => api.unregister(id), [api, id]);

  const move = useCallback((delta: number) => api.move(id, delta), [api, id]);

  const isSelected = selected.has(id);
  const isAutomating = automating.has(id);
  const isConfiguringAutomation = automationPopupId === id;

  return {
    selected: isSelected,
    automating: isAutomating,
    configuringAutomation: isConfiguringAutomation,
    inverted: isSelected && shiftHeld && activeId !== null && activeId !== id,
    move,
    bind: disabled ? {} : { 'data-control-id': id },
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault();
      if (!disabled) api.openAutomation(id, event.clientX, event.clientY);
    },
  };
}