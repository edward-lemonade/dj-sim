import { SongCover } from '@/components/SongCover';
import type { Track } from '@/lib/types/Track';
import type { TrackUpdateFields } from '@/lib/types/Track';
import { TransportControls, formatPlaybackTime } from '../../../components/TransportControls';
import type { TrackPlayer } from '../../../hooks/useTrackPlayer';
import { CueButtons } from '@/components/CueButtons';
import { normalizeCues } from '@/lib/types/Cues';
import { GridControls } from '../../../components/GridControls';
import { useGridNudge } from '../../../hooks/useGridNudge';
import { BandOptions } from '@/components/WaveformCanvas';
import { EditWaveformDisplay } from '@/components/EditWaveformDisplay';
import { MetaField } from '@/components/MetaField';

export function TrackPreview({
  track,
  player,
  onPatch,
}: {
  track: Track | null;
  player: TrackPlayer;
  onPatch: (id: string, fields: TrackUpdateFields) => Promise<unknown>;
}) {
  const { offset: beatOffset, nudge: nudgeGrid } = useGridNudge({
    trackId: track?.id ?? null,
    bpm: track?.bpm ?? 0,
    savedOffset: track?.beatOffset ?? 0,
    save: (id, beatOffset) => onPatch(id, { beatOffset }),
  });

  if (!track || player.status === 'idle') {
    return (
      <section className="flex min-h-0 shrink-0 items-center justify-center bg-[#101214] border-b border-slate/40">
        <p className="text-sm tracking-wide text-zinc-400">No track opened</p>
      </section>
    );
  }

  const cues = normalizeCues(track.cues);
  const setCues = (next: Array<number | null>) => {
    void onPatch(track.id, { cues: next }).catch(console.error);
  };

  return (
    <section className="flex min-h-0 shrink-0 flex-col bg-mist-900 border-b border-slate/40">
      {player.status === 'error' ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-red-400">
          {player.errorMessage || 'Could not open track'}
        </div>
      ) : (
        <EditWaveformDisplay 
          track={track} 
          player={player} 
          bands={BandOptions.Triple}
        />
      )}

      <div className="flex items-center justify-center gap-10 border-y bg-mist-900 px-3 py-1.5">
        <TransportControls player={player}/>
        <CueButtons
          cues={cues}
          currentTime={player.currentTime}
          disabled={track.libraryStatus !== 'ready'}
          onChange={setCues}
        />
        <GridControls disabled={track.libraryStatus !== 'ready' || track.bpm <= 0} onNudge={nudgeGrid} />
      </div>

      <div className="grid grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_minmax(3.5rem,auto)_minmax(3.5rem,auto)_minmax(3.5rem,auto)] items-center gap-2 bg-mist-900 px-3 py-2 text-xs">
        <SongCover song={track} className="h-8 w-8 shrink-0 rounded-sm shadow-none" />
        <MetaField label="Title" value={track.title} disabled={track.libraryStatus !== 'ready'} error={track.errorMessage} onCommit={(title) => onPatch(track.id, { title })} />
        <MetaField label="Artist" value={track.artist} disabled={track.libraryStatus !== 'ready'} onCommit={(artist) => onPatch(track.id, { artist })} />
        <MetaField label="BPM" value={track.bpm > 0 ? String(track.bpm) : ''} disabled={track.libraryStatus !== 'ready'} onCommit={(raw) => onPatch(track.id, { bpm: parseBpmInput(raw, track.bpm) })} />
        <MetaField label="Key" value={track.key} disabled={track.libraryStatus !== 'ready'} onCommit={(key) => onPatch(track.id, { key })} />
        <div>
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Time</p>
          <p className="truncate text-zinc-200">{player.durationSeconds > 0 ? formatPlaybackTime(player.durationSeconds, false) : track.duration}</p>
        </div>
      </div>
    </section>
  );
}

function parseBpmInput(raw: string, fallback: number) {
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 400) return fallback;
  return parsed;
}