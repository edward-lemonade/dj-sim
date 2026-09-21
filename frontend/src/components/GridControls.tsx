const SIZE = 20; // px, buttons are exact squares

export function GridControls({
  disabled,
  onNudge,
}: {
  disabled?: boolean;
  onNudge: (direction: -1 | 1, fine: boolean) => void;
}) {
  const btn =
    'shrink-0 rounded-none p-0 text-zinc-300 hover:bg-zinc-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-40';
  const square = {
    width: SIZE,
    height: SIZE,
    minWidth: SIZE,
    minHeight: SIZE,
    display: 'grid',
    placeItems: 'center',
  } as const;

  return (
    <div
      className="flex shrink-0 items-center self-center overflow-hidden rounded-none border border-zinc-700 bg-zinc-900/60"
      style={{ height: SIZE + 2 }}
    >
      <span className="whitespace-nowrap px-1.5 text-[9px] font-medium uppercase leading-none tracking-wider text-zinc-400">
        Grid Lines
      </span>
      <div className="w-px self-stretch bg-zinc-700" />
      <button
        type="button"
        disabled={disabled}
        onClick={(event) => onNudge(-1, event.shiftKey)}
        className={btn}
        style={square}
        title="Move grid lines left (Shift: fine)"
        aria-label="Move grid lines left"
      >
        <Chevron direction="left" />
      </button>
      <div className="w-px self-stretch bg-zinc-700" />
      <button
        type="button"
        disabled={disabled}
        onClick={(event) => onNudge(1, event.shiftKey)}
        className={btn}
        style={square}
        title="Move grid lines right (Shift: fine)"
        aria-label="Move grid lines right"
      >
        <Chevron direction="right" />
      </button>
    </div>
  );
}

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  // Bounding box is nudged 0.5 units toward the open side so it looks centered.
  const d = direction === 'left' ? 'M13 5 L8 10 L13 15' : 'M7 5 L12 10 L7 15';
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <path d={d} />
    </svg>
  );
}