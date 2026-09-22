import { useEffect, useState } from 'react';
import { useTrackPlayer } from '@/hooks/useTrackPlayer';
import { normalizeCues } from '@/lib/types/Cues';
import type { Track, TrackUpdateFields } from '@/lib/types/Track';
import { DeckControls } from '@/components/DeckControls';
import { WaveformDoubleDisplay } from '@/components/WaveformDoubleDisplay';
import { Platter } from '@/pages/studio/components/Platter';
import { BandOptions } from '@/components/WaveformCanvas';

export type CDJProps = {
  track: Track | null;
  label?: string;
  tracks?: Track[];
  onLoadTrack?: (id: string) => void;
  onPatch: (id: string, fields: TrackUpdateFields) => Promise<unknown>;
};

export function CDJ({ track, label, tracks, onLoadTrack, onPatch }: CDJProps) {
  const player = useTrackPlayer({ enableSpacebar: false });
  const [tempo, setTempo] = useState(0);

  useEffect(() => {
    if (track?.id) {
      void player.open(track.id);
      return;
    }
    player.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id]);

  const cues = normalizeCues(track?.cues);
  const playing = player.status === 'playing';
  const transportDisabled = !track || player.status === 'idle' || player.status === 'loading' || player.status === 'error';
  const cueSlotsFull = cues.every((slot) => slot !== null);

  const setCueAtPlayhead = () => {
    if (!track || cueSlotsFull) return;
    const next = [...cues];
    const index = next.findIndex((slot) => slot === null);
    if (index < 0) return;
    next[index] = Math.round(player.currentTime * 1000) / 1000;
    void onPatch(track.id, { cues: next }).catch(console.error);
  };

  return (
    <section
      className="grid h-full min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] bg-[#101214]"
      aria-label={label ? `Deck ${label}` : 'Deck'}
    >
      {tracks && onLoadTrack ? (
        <div className="shrink-0 border-b border-zinc-800 px-2 py-1">
          <label className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
            Load
            <select
              className="min-w-0 flex-1 bg-[#161a20] text-xs text-zinc-200 outline-none"
              value={track?.id ?? ''}
              onChange={(event) => onLoadTrack(event.target.value)}
              aria-label={label ? `Load track on deck ${label}` : 'Load track'}
            >
              <option value="">No track loaded</option>
              {tracks
                .filter((item) => item.libraryStatus === 'ready')
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
            </select>
          </label>
        </div>
      ) : null}

      <WaveformDoubleDisplay track={track} player={player} bands={BandOptions.Single} />

      <div className="flex flex-1 min-h-0 items-center justify-center gap-10 border-t border-slate/40 px-4 py-4">
        <Platter 
          label={label} 
          size={180} 
          track={track}
        />
        <label className="flex flex-col items-center gap-1">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            Tempo {tempo > 0 ? '+' : ''}
            {tempo}%
          </span>
          <input
            type="range"
            min={-8}
            max={8}
            step={0.1}
            value={tempo}
            onChange={(event) => setTempo(Number(event.target.value))}
            aria-label={label ? `Deck ${label} tempo` : 'Tempo'}
            className="h-56 w-8 cursor-pointer accent-zinc-200"
            style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
          />
        </label>
      </div>

      <DeckControls
        player={player}
        bpm={track?.bpm ?? 0}
        cues={cues}
        disabled={transportDisabled}
        cueDisabled={cueSlotsFull}
        label={label}
        onCue={setCueAtPlayhead}
      />
    </section>
  );
}