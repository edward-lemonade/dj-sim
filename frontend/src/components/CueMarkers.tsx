import { CUE_COLORS, CUE_LABELS } from "@/lib/types/Cues";

export function CueMarkers({
  cues,
  durationSeconds,
  viewStart,
  viewEnd,
}: {
  cues: Array<number | null>;
  durationSeconds: number;
  viewStart: number;
  viewEnd: number;
}) {
  if (durationSeconds <= 0 || viewEnd <= viewStart) return null;
  const span = viewEnd - viewStart;

  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 bottom-0 z-[6] overflow-hidden">
      {cues.map((t, i) => {
        if (t === null) return null;
        const x = ((t / durationSeconds - viewStart) / span) * 100;
        if (x < 0 || x > 100) return null;
        const color = CUE_COLORS[i];
        return (
          <div key={i} className="absolute inset-y-0 w-0" style={{ left: `${x}%` }}>
            <div
              className="absolute inset-y-0 left-0 w-0.5 -translate-x-1/2"
              style={{ backgroundColor: color }}
            />
            <div
              className="absolute left-0 top-0 flex h-4 w-4 -translate-x-1/2 items-center justify-center text-[10px] font-bold leading-none text-zinc-950"
              style={{ backgroundColor: color }}
            >
              {CUE_LABELS[i]}
            </div>
          </div>
        );
      })}
    </div>
  );
}