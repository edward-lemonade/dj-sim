import { useEffect, useState, type ReactNode } from 'react';
import { ChevronsLeft, ChevronsRight, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TrackPlayer } from '../hooks/useTrackPlayer';

export function formatPlaybackTime(seconds: number, withCentiseconds = true) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  const whole = Math.floor(rest);
  const centiseconds = Math.floor((rest - whole) * 100);
  const base = `${minutes}:${whole.toString().padStart(2, '0')}`;
  return withCentiseconds ? `${base}.${centiseconds.toString().padStart(2, '0')}` : base;
}

export function parsePlaybackTime(raw: string): number | null {
  const match = raw.trim().match(/^(\d+):([0-5]?\d)(?:[.:](\d{1,2}))?$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const frac = match[3] ? Number(match[3].padEnd(2, '0').slice(0, 2)) / 100 : 0;
  return minutes * 60 + seconds + frac;
}

export function TransportControls({
  player,
}: {
  player: TrackPlayer;
}) {
  const playing = player.status === 'playing';
  const disabled = player.status === 'idle' || player.status === 'loading' || player.status === 'error';
  const [draft, setDraft] = useState(formatPlaybackTime(player.currentTime));

  useEffect(() => {
    setDraft(formatPlaybackTime(player.currentTime));
  }, [player.currentTime]);

  const commitTime = () => {
    const parsed = parsePlaybackTime(draft);
    if (parsed == null) {
      setDraft(formatPlaybackTime(player.currentTime));
      return;
    }
    player.seek(parsed);
  };

  return (
    <div className="flex gap-1 items-center justify-center">
      <Button variant="ghost" size="icon-xs" className="text-zinc-200 hover:bg-zinc-800" disabled={disabled} onClick={player.jumpStart}>
        <SkipBack />
      </Button>
      <Button variant="ghost" size="icon-sm" className="text-zinc-200 hover:bg-zinc-800" disabled={disabled} onClick={() => player.skip(-10)}>
        <ChevronsLeft />
      </Button>
      <Button variant="ghost" size="icon-sm" className="text-zinc-100 hover:bg-zinc-800" disabled={disabled} onClick={player.togglePlay}>
        {playing ? <Pause /> : <Play />}
      </Button>
      <Button variant="ghost" size="icon-sm" className="text-zinc-200 hover:bg-zinc-800" disabled={disabled} onClick={() => player.skip(10)}>
        <ChevronsRight />
      </Button>
      <Button variant="ghost" size="icon-xs" className="text-zinc-200 hover:bg-zinc-800" disabled={disabled} onClick={player.jumpEnd}>
        <SkipForward />
      </Button>
      <input
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitTime}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
        }}
        className="h-6 w-[5.5rem] rounded border border-zinc-700 bg-[#0d1014] px-1.5 font-mono text-xs text-zinc-100 outline-none focus:border-zinc-500 disabled:opacity-50"
        aria-label="Current time"
      />
      <span className="font-mono text-[11px] text-zinc-500">
        / {formatPlaybackTime(player.durationSeconds, false)}
      </span>
    </div>
  );
}
