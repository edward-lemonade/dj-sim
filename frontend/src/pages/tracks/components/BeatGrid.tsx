import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';

const BEATS_PER_MEASURE = 4;
const MIN_BEAT_PX = 30;
const MIN_MEASURE_PX = 20;
const MAX_LINES = 600;

const mod = (n: number, m: number) => ((n % m) + m) % m;

export function BeatGrid({
  bpm,
  offset,
  durationSeconds,
  viewStart,
  viewEnd,
  onCommit,
}: {
  bpm: number;
  offset: number;
  durationSeconds: number;
  viewStart: number;
  viewEnd: number;
  onCommit: (offset: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const drag = useRef<{ startX: number; startOffset: number } | null>(null);

  // The container div is always rendered, so this effect always finds it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    setWidth(el.clientWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // passing scroll events down to the canvas
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      const canvas = el.parentElement?.querySelector('canvas');
      if (!canvas) return;
      const forwarded = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: event.clientX,
        clientY: event.clientY,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      });
      canvas.dispatchEvent(forwarded);
      if (forwarded.defaultPrevented) event.preventDefault();
    };
    // passive: false so preventDefault can stop the page from scrolling
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const active = bpm > 0 && durationSeconds > 0 && viewEnd > viewStart;
  const beat = active ? 60 / bpm : 1;
  const measure = beat * BEATS_PER_MEASURE;
  const viewFraction = viewEnd - viewStart;
  const viewSeconds = viewFraction * durationSeconds;
  const o = dragOffset ?? offset;

  const pxPerBeat = active && width > 0 ? (width * beat) / viewSeconds : 0;
  const showBeats = pxPerBeat >= MIN_BEAT_PX;
  const showMeasures = pxPerBeat * BEATS_PER_MEASURE >= MIN_MEASURE_PX;

  const lines: Array<{ k: number; x: number; isMeasure: boolean }> = [];
  if (active && width > 0 && showMeasures) {
    const tStart = viewStart * durationSeconds;
    const tEnd = viewEnd * durationSeconds;
    const kMin = Math.ceil((tStart - o) / beat);
    const kMax = Math.floor((tEnd - o) / beat);
    for (let k = kMin; k <= kMax && lines.length < MAX_LINES; k++) {
      const isMeasure = mod(k, BEATS_PER_MEASURE) === 0;
      if (!isMeasure && !showBeats) continue;
      const t = o + k * beat;
      if (t < 0 || t > durationSeconds) continue;
      lines.push({ k, x: ((t / durationSeconds - viewStart) / viewFraction) * 100, isMeasure });
    }
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startOffset: offset };
    setDragOffset(offset);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || width <= 0) return;
    const dx = event.clientX - d.startX;
    setDragOffset(d.startOffset + (dx * viewSeconds) / width);
  };

  const finish = (commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (commit && d && dragOffset !== null) {
      const next = Math.round(mod(dragOffset, measure) * 1000) / 1000;
      if (Math.abs(next - offset) > 0.0005) onCommit(next);
    }
    setDragOffset(null);
  };

  return (
    <div ref={ref} className="pointer-events-none absolute inset-x-2 top-2 bottom-0 z-[5] overflow-hidden">
      {lines.map(({ k, x, isMeasure }) => (
        <div
          key={k}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => finish(true)}
          onPointerCancel={() => finish(false)}
          style={{ left: `${x}%` }}
          className={`group pointer-events-auto absolute inset-y-0 w-1.5 -translate-x-1/2 touch-none ${
            dragOffset !== null ? 'cursor-grabbing' : 'cursor-pointer'
          }`}
        >
          <div
            className={
              isMeasure
                ? `absolute inset-y-0 left-1/2 w-px -translate-x-1/2 ${
                    dragOffset !== null ? 'bg-white' : 'bg-white/70 group-hover:bg-white'
                  }`
                : `absolute inset-y-0 left-1/2 w-px -translate-x-1/2 ${
                    dragOffset !== null ? 'bg-white/60' : 'bg-white/25 group-hover:bg-white/60'
                  }`
            }
          />
          {isMeasure && (
            <div
              className={`absolute left-1/2 top-0 h-0 w-0 -translate-x-1/2 border-x-[4px] border-t-[6px] border-x-transparent ${
                dragOffset !== null ? 'border-t-white' : 'border-t-white/80 group-hover:border-t-white'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}