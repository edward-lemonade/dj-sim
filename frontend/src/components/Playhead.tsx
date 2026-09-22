export function Playhead({
  playhead,
  viewStart,
  viewEnd,
}: {
  playhead?: number; // fraction of full track (0-1), matches WaveformCanvas's playhead prop
  viewStart: number;
  viewEnd: number;
}) {
  if (playhead === undefined) return null;
  const span = viewEnd - viewStart;
  if (span <= 0) return null;

  const x = ((playhead - viewStart) / span) * 100;
  if (x < 0 || x > 100) return null;

  return (
    <div className="pointer-events-none absolute inset-y-0 z-[7] w-0" style={{ left: `${x}%` }}>
      <div className="absolute inset-y-0 left-0 w-0.5 -translate-x-1/2 w-2px bg-amber-200" />
    </div>
  );
}