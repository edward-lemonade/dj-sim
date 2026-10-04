import { CUE_COLORS, CUE_LABELS } from "@/lib/types/Cues";

// eslint-disable-next-line react-refresh/only-export-components
export enum CueButtonMode {
  Edit = 'edit',
  Jump = 'jump',
}

export function CueButtons({
  cues,
  currentTime,
  disabled,
  mode = CueButtonMode.Edit,
  size = 18,
  onChange,
  onCueClick,
}: {
  cues: Array<number | null>;
  currentTime: number;
  disabled?: boolean;
  mode?: CueButtonMode;
  size?: number;
  onChange?: (next: Array<number | null>) => void;
  onCueClick?: (index: number) => void;
}) {
  const toggle = (i: number) => {
    const next = [...cues];
    next[i] = next[i] === null ? Math.round(currentTime * 1000) / 1000 : null;
    onChange?.(next);
  };

  return (
    <div className="grid shrink-0 grid-cols-4 gap-1">
      {CUE_LABELS.map((label, i) => {
        const set = cues[i] !== null;
        const color = CUE_COLORS[i];
        const jumpDisabled = mode === CueButtonMode.Jump && !set;
        return (
          <button
            key={label}
            type="button"
            disabled={disabled || jumpDisabled}
            onClick={() => {
              if (mode === CueButtonMode.Jump) {
                if (set) onCueClick?.(i);
                return;
              }
              toggle(i);
            }}
            title={
              mode === CueButtonMode.Jump
                ? set
                  ? `Jump to cue ${label}`
                  : `Cue ${label} unset`
                : set
                  ? `Delete cue ${label}`
                  : `Set cue ${label} at playhead`
            }
            aria-label={
              mode === CueButtonMode.Jump
                ? set
                  ? `Jump to cue ${label}`
                  : `Cue ${label} unset`
                : set
                  ? `Delete cue ${label}`
                  : `Set cue ${label}`
            }
            style={{
            width: size,
            height: size,
            minWidth: size,
            minHeight: size,
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
