import {
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

export type DragState = {
  id: string;
  fromIndex: number;
  toIndex: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
};

const DEFAULT_ROW_GAP = 8;
const DEFAULT_LIST_PADDING = 8;

export function useListItemMove<T extends { id: string }>({
  items,
  setItems,
  listRef,
  rowGap = DEFAULT_ROW_GAP,
  listPadding = DEFAULT_LIST_PADDING,
  canDrag,
}: {
  items: T[];
  setItems: Dispatch<SetStateAction<T[]>>;
  listRef: RefObject<HTMLDivElement | null>;
  rowGap?: number;
  listPadding?: number;
  /** Return false to make an item non-draggable (e.g. still uploading). Defaults to always true. */
  canDrag?: (item: T) => boolean;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const itemsRef = useRef<T[]>(items);
  const dragRef = useRef<DragState | null>(null);
  const moveFrame = useRef<number | null>(null);
  const canDragRef = useRef(canDrag);
  const listenersRef = useRef<{
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
  } | null>(null);

  itemsRef.current = items;
  canDragRef.current = canDrag; // ref, so an inline arrow doesn't churn the callbacks below

  const stopListening = useCallback(() => {
    const listeners = listenersRef.current;
    if (!listeners) return;
    window.removeEventListener('pointermove', listeners.move);
    window.removeEventListener('pointerup', listeners.up);
    window.removeEventListener('pointercancel', listeners.up);
    listenersRef.current = null;
  }, []);

  const commitMove = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setItems((current) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= current.length ||
        toIndex >= current.length
      ) {
        return current;
      }

      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, [setItems]);

  const indexFromPointer = useCallback((clientY: number, height: number) => {
    const list = listRef.current;
    const count = itemsRef.current.length;
    if (!list || count === 0) return 0;

    const rect = list.getBoundingClientRect();
    const y = clientY - rect.top + list.scrollTop - listPadding;
    const stride = height + rowGap;
    return Math.max(0, Math.min(count - 1, Math.round(y / stride)));
  }, [listRef, listPadding, rowGap]);

  const autoScrollList = useCallback((clientY: number) => {
    const list = listRef.current;
    if (!list) return;

    const rect = list.getBoundingClientRect();
    const edge = 48;
    if (clientY < rect.top + edge) {
      list.scrollTop -= 14;
    } else if (clientY > rect.bottom - edge) {
      list.scrollTop += 14;
    }
  }, [listRef]);

  const publishDrag = useCallback((next: DragState | null) => {
    dragRef.current = next;
    if (moveFrame.current != null) cancelAnimationFrame(moveFrame.current);
    moveFrame.current = requestAnimationFrame(() => {
      setDrag(next);
      moveFrame.current = null;
    });
  }, []);

  const onRowPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>, item: T) => {
    if (event.button !== 0) return;
    if (canDragRef.current && !canDragRef.current(item)) return;

    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('input, textarea, a, [data-no-drag]')
    ) {
      return;
    }

    const row = event.currentTarget.closest<HTMLElement>('[data-drag-row]');
    if (!row) return;

    event.preventDefault();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = row.getBoundingClientRect();

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;

      const active = dragRef.current;
      if (!active) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6) return;
        const fromIndex = itemsRef.current.findIndex((entry) => entry.id === item.id);
        if (fromIndex < 0) return;

        publishDrag({
          id: item.id,
          fromIndex,
          toIndex: fromIndex,
          width: rect.width,
          height: rect.height,
          offsetX: startX - rect.left,
          offsetY: startY - rect.top,
          x: moveEvent.clientX,
          y: moveEvent.clientY,
        });
        return;
      }

      autoScrollList(moveEvent.clientY);
      publishDrag({
        ...active,
        x: moveEvent.clientX,
        y: moveEvent.clientY,
        toIndex: indexFromPointer(moveEvent.clientY, active.height),
      });
    };

    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;

      stopListening();

      const active = dragRef.current;
      dragRef.current = null;
      if (moveFrame.current != null) {
        cancelAnimationFrame(moveFrame.current);
        moveFrame.current = null;
      }

      if (active) {
        commitMove(active.fromIndex, active.toIndex);
      }
      setDrag(null);
    };

    stopListening();
    listenersRef.current = { move: onMove, up: onUp };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [autoScrollList, commitMove, indexFromPointer, publishDrag, stopListening]);

  useEffect(() => {
    if (!drag) return;

    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
    };
  }, [drag]);

  useEffect(() => {
    return () => {
      stopListening();
      if (moveFrame.current != null) {
        cancelAnimationFrame(moveFrame.current);
      }
    };
  }, [stopListening]);

  const draggedItem = drag ? items.find((item) => item.id === drag.id) ?? null : null;
  const stride = drag ? drag.height + rowGap : 0;

  return {
    drag,
    draggedItem,
    stride,
    onRowPointerDown,
  };
}

export function rowShift(index: number, fromIndex: number, toIndex: number, stride: number) {
  if (fromIndex === toIndex) return 0;
  if (fromIndex < toIndex && index > fromIndex && index <= toIndex) return -stride;
  if (fromIndex > toIndex && index >= toIndex && index < fromIndex) return stride;
  return 0;
}