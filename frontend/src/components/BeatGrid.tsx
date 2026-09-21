import { useEffect, useRef, useState } from 'react';

const BEATS_PER_MEASURE = 4;
const MIN_BEAT_PX = 14; // beat lines are gone at or below this spacing
const FULL_BEAT_PX = 48; // beat lines are at full strength at or above this spacing
const MIN_MEASURE_PX = 30;
const MAX_LINES = 600;

const mod = (n: number, m: number) => ((n % m) + m) % m;

export function BeatGrid({
  bpm,
  offset,
  durationSeconds,
  viewStart,
  viewEnd,
}: {
  bpm: number;
  offset: number; // seconds to the first measure line
  durationSeconds: number;
  viewStart: number;
  viewEnd: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    setWidth(el.clientWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const active = bpm > 0 && durationSeconds > 0 && viewEnd > viewStart;
  const beat = active ? 60 / bpm : 1;
  const viewFraction = viewEnd - viewStart;
  const viewSeconds = viewFraction * durationSeconds;

  const pxPerBeat = active && width > 0 ? (width * beat) / viewSeconds : 0;
  const showBeats = pxPerBeat > MIN_BEAT_PX;
  const showMeasures = pxPerBeat * BEATS_PER_MEASURE >= MIN_MEASURE_PX;
  const beatFade = Math.min(1, Math.max(0, (pxPerBeat - MIN_BEAT_PX) / (FULL_BEAT_PX - MIN_BEAT_PX)));

  const lines: Array<{ k: number; x: number; isMeasure: boolean }> = [];
  if (active && width > 0 && showMeasures) {
    const tStart = viewStart * durationSeconds;
    const tEnd = viewEnd * durationSeconds;
    const kMin = Math.ceil((tStart - offset) / beat);
    const kMax = Math.floor((tEnd - offset) / beat);
    for (let k = kMin; k <= kMax && lines.length < MAX_LINES; k++) {
      const isMeasure = mod(k, BEATS_PER_MEASURE) === 0;
      if (!isMeasure && !showBeats) continue;
      const t = offset + k * beat;
      if (t < 0 || t > durationSeconds) continue;
      lines.push({ k, x: ((t / durationSeconds - viewStart) / viewFraction) * 100, isMeasure });
    }
  }

  return (
    <div ref={ref} className="pointer-events-none absolute inset-x-2 top-2 bottom-0 z-[5] overflow-hidden">
      {lines.map(({ k, x, isMeasure }) => (
        <div key={k} className="absolute inset-y-0 w-0" style={{ left: `${x}%` }}>
          {isMeasure ? (
            <>
              <div className="absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-white/70" />
              <div className="absolute left-0 top-0 h-0 w-0 -translate-x-1/2 border-x-[4px] border-t-[6px] border-x-transparent border-t-white/80" />
            </>
          ) : (
            <div
              className="absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-white/25"
              style={{ opacity: beatFade }}
            />
          )}
        </div>
      ))}
    </div>
  );
}