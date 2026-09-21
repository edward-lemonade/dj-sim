import { CUE_COLORS } from '@/lib/types/Cues';

export function CueTicks({ cues, seconds }: { cues: Array<number | null>; seconds: number }) {
  if (seconds <= 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {cues.map((t, i) =>
        t === null || t < 0 || t > seconds ? null : (
          <div
            key={i}
            className="absolute inset-y-0 w-px"
            style={{ left: `${(t / seconds) * 100}%`, backgroundColor: CUE_COLORS[i] }}
          />
        ),
      )}
    </div>
  );
}