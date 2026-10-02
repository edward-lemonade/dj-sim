import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { CueButtons } from '@/components/CueButtons';
import type { TrackPlayer } from '@/hooks/useTrackPlayer';
import type { DeckId } from '@/hooks/useAudioEngine';

const BEAT_STEPS = [1, 2, 4] as const;

export type DeckControlsProps = {
  player: TrackPlayer;
  bpm: number;
  cues: Array<number | null>;
  disabled?: boolean;
  cueDisabled?: boolean;
  label?: DeckId;
  onCue: () => void;
};

export function DeckControls({ player, bpm, cues, disabled, cueDisabled, label, onCue }: DeckControlsProps) {
  const playing = player.status === 'playing';
  const beatSeconds = bpm > 0 ? 60 / bpm : 0;
  const nudgeDisabled = disabled || beatSeconds <= 0;

  const nudge = (beats: number) => {
    if (beatSeconds <= 0) return;
    player.skip(beats * beatSeconds);
  };

  const squareBtn =
    'flex h-9 w-9 items-center justify-center rounded border text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-6 border-t bg-[#101214] px-4 py-3">
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          disabled={disabled || cueDisabled}
          onClick={onCue}
          aria-label={label ? `Set cue on deck ${label}` : 'Set cue'}
          title="Set cue at playhead"
          className="flex h-11 w-11 items-center justify-center rounded-full border bg-zinc-900 text-[10px] font-bold uppercase tracking-wider text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Cue
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={player.togglePlay}
          aria-label={playing ? (label ? `Pause deck ${label}` : 'Pause') : label ? `Play deck ${label}` : 'Play'}
          className={`flex h-14 w-14 items-center justify-center rounded-full border text-white disabled:cursor-not-allowed disabled:opacity-40 ${
            playing
              ? 'border-red-700 bg-red-600 hover:bg-red-500'
              : 'border-green-700 bg-green-600 hover:bg-green-500'
          }`}
        >
          {playing ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 translate-x-0.5" />}
        </button>
      </div>

      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={player.jumpStart}
          aria-label={label ? `Deck ${label} go to start` : 'Go to start'}
          title="Go to start"
          className={squareBtn}
        >
          <SkipBack/>
        </button>

        {BEAT_STEPS.map((beats) => (
          <div key={beats} className="flex flex-col gap-1">
            <button
              type="button"
              disabled={nudgeDisabled}
              onClick={() => nudge(beats)}
              aria-label={
                label
                  ? `Deck ${label} forward ${beats} beat${beats > 1 ? 's' : ''}`
                  : `Forward ${beats} beat${beats > 1 ? 's' : ''}`
              }
              title={`Forward ${beats} beat${beats > 1 ? 's' : ''}${beats === 4 ? ' (1 measure)' : ''}`}
              className={`${squareBtn} text-xs font-semibold`}
            >
              +{beats}
            </button>
            <button
              type="button"
              disabled={nudgeDisabled}
              onClick={() => nudge(-beats)}
              aria-label={
                label
                  ? `Deck ${label} back ${beats} beat${beats > 1 ? 's' : ''}`
                  : `Back ${beats} beat${beats > 1 ? 's' : ''}`
              }
              title={`Back ${beats} beat${beats > 1 ? 's' : ''}${beats === 4 ? ' (1 measure)' : ''}`}
              className={`${squareBtn} text-xs font-semibold`}
            >
              −{beats}
            </button>
          </div>
        ))}

        <button
          type="button"
          disabled={disabled}
          onClick={player.jumpEnd}
          aria-label={label ? `Deck ${label} go to end` : 'Go to end'}
          title="Go to end"
          className={squareBtn}
        >
          <SkipForward/>
        </button>
      </div>

      <CueButtons
        mode="jump"
        cues={cues}
        currentTime={player.currentTime}
        disabled={disabled}
        size={40}
        onCueClick={(index) => {
          const time = cues[index];
          if (time != null) player.seek(time);
        }}
      />
    </div>
  );
}