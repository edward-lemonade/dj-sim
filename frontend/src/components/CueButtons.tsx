import { CUE_COLORS, CUE_LABELS } from "@/lib/types/Cues";

const SIZE = 18

export function CueButtons({
  cues,
  currentTime,
  disabled,
  onChange,
}: {
  cues: Array<number | null>;
  currentTime: number;
  disabled?: boolean;
  onChange: (next: Array<number | null>) => void;
}) {
  const toggle = (i: number) => {
    const next = [...cues];
    next[i] = next[i] === null ? Math.round(currentTime * 1000) / 1000 : null;
    onChange(next);
  };

  return (
    <div className="grid shrink-0 grid-cols-4 gap-1">
      {CUE_LABELS.map((label, i) => {
        const set = cues[i] !== null;
        const color = CUE_COLORS[i];
        return (
          <button
            key={label}
            type="button"
            disabled={disabled}
            onClick={() => toggle(i)}
            title={set ? `Delete cue ${label}` : `Set cue ${label} at playhead`}
            aria-label={set ? `Delete cue ${label}` : `Set cue ${label}`}
            style={{
            width: SIZE,
            height: SIZE,
            minWidth: SIZE,
            minHeight: SIZE,
            fontSize: 10,
            lineHeight: 1,
            ...(set
              ? { backgroundColor: color, borderColor: color, color: '#0b0d10' }
              : { borderColor: `${color}99`, color }),
          }}
          className="flex items-center justify-center rounded-none border p-0 font-bold transition-[filter] hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-40">
            {label}
          </button>
        );
      })}
    </div>
  );
}