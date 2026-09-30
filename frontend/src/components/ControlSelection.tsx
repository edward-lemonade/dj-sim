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

type Control = {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
};

type SelectionApi = {
  register: (id: string, control: Control) => void;
  unregister: (id: string) => void;
  move: (id: string, delta: number) => void;
};

const SelectionContext = createContext<{
  api: SelectionApi;
  selected: ReadonlySet<string>;
  shiftHeld: boolean;
  activeId: string | null;
} | null>(null);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function ControlSelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const selectedRef = useRef(selected);
  const controls = useRef(new Map<string, Control>());
  const shiftRef = useRef(false);
  // Mirrors shiftRef for rendering; the ref stays because move() needs the live value.
  const [shiftHeld, setShiftHeld] = useState(false);
  // The control currently being dragged, so it can stay blue while the rest go red.
  const [activeId, setActiveId] = useState<string | null>(null);

  const update = useCallback((next: ReadonlySet<string>) => {
    selectedRef.current = next;
    setSelected(next);
  }, []);

  const api = useMemo<SelectionApi>(
    () => ({
      register: (id, control) => {
        controls.current.set(id, control);
      },
      unregister: (id) => {
        controls.current.delete(id);
        if (!selectedRef.current.has(id)) return;
        const next = new Set(selectedRef.current);
        next.delete(id);
        update(next);
      },
      // Deltas are normalized by each control's range, so a knob ([-1, 1]) and
      // a tempo slider ([-50, 50]) travel the same fraction of their travel.
      move: (id, delta) => {
        const source = controls.current.get(id);
        if (!source || source.max === source.min) return;
        const normalized = delta / (source.max - source.min);
        const targets = selectedRef.current.has(id) ? selectedRef.current : new Set([id]);
        targets.forEach((targetId) => {
          const target = controls.current.get(targetId);
          if (!target) return;
          const sign = targetId === id || !shiftRef.current ? 1 : -1;
          const next = target.value + sign * normalized * (target.max - target.min);
          target.onChange(Number(clamp(next, target.min, target.max).toFixed(3)));
        });
      },
    }),
    [update],
  );

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

  const context = useMemo(
    () => ({ api, selected, shiftHeld, activeId }),
    [api, selected, shiftHeld, activeId],
  );

  return <SelectionContext.Provider value={context}>{children}</SelectionContext.Provider>;
}

export function useSyncedControl({
  value,
  min,
  max,
  onChange,
  disabled,
}: Control & { disabled?: boolean }) {
  const context = useContext(SelectionContext);
  if (!context) throw new Error('useSyncedControl must be used inside ControlSelectionProvider');
  const { api, selected, shiftHeld, activeId } = context;
  const id = useId();

  // Re-registers every render so the provider always sees the latest value/onChange.
  useEffect(() => {
    api.register(id, { value, min, max, onChange });
  });
  useEffect(() => () => api.unregister(id), [api, id]);

  const move = useCallback((delta: number) => api.move(id, delta), [api, id]);

  const isSelected = selected.has(id);

  return {
    selected: isSelected,
    inverted: isSelected && shiftHeld && activeId !== null && activeId !== id,
    move,
    bind: disabled ? {} : { 'data-control-id': id },
  };
}