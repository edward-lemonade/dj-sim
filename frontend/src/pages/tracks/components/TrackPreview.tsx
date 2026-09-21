import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { SongCover } from '@/components/SongCover';
import type { Track } from '@/lib/types/track';
import type { TrackUpdateFields } from '@/lib/types/track';
import { peaksFromOverview } from '@/lib/audio/threeBandWaveform';
import { TransportControls, formatPlaybackTime } from './TransportControls';
import type { TrackPlayer } from '../hooks/useTrackPlayer';
import { WaveformCanvas } from './WaveformCanvas';
import { BeatGrid } from './BeatGrid';

// clicking zoom in multiplies zoom by 1 / ZOOM_STEP; zoom out multiplies by ZOOM_STEP.
// bounds match WaveformCanvas's own wheel-zoom clamp (1x-48x) so buttons and any
// other zoom path stay consistent.
const ZOOM_STEP = 0.7;
const MIN_ZOOM = 1;
const MAX_ZOOM = 48;

export function TrackPreview({
  track,
  player,
  onPatch,
}: {
  track: Track | null;
  player: TrackPlayer;
  onPatch: (id: string, fields: TrackUpdateFields) => Promise<unknown>;
}) {
  const playhead = player.durationSeconds > 0 ? player.currentTime / player.durationSeconds : undefined;
  const peaks = player.hiResPeaks ?? peaksFromOverview(track?.waveformOverview);

  const zoomBy = (factor: number) => {
    const start = player.viewStart;
    const end = player.viewEnd;
    const center = playhead !== undefined && playhead >= start && playhead <= end ? playhead : (start + end) / 2;

    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, player.zoom / factor));
    const newWidth = 1 / newZoom;
    const newStart = Math.max(0, Math.min(center - newWidth / 2, 1 - newWidth));
    player.setView(newStart, newZoom);
  };

  if (!track || player.status === 'idle') {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center bg-[#101214]">
        <p className="text-sm tracking-wide text-zinc-400">No track opened</p>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-[#101214]">
      {player.status === 'error' ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-red-400">
          {player.errorMessage || 'Could not open track'}
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 px-2 pt-2">
          <WaveformCanvas
            variant="zoomed"
            peaks={peaks}
            viewStart={player.viewStart}
            viewEnd={player.viewEnd}
            playhead={playhead}
            zoom={player.zoom}
            onSeek={player.seekFraction}
            onViewChange={player.setView}
            onInteractionChange={player.setInteracting}
          />

          <BeatGrid
            bpm={track.bpm}
            offset={track.beatOffset ?? 0}
            durationSeconds={player.durationSeconds}
            viewStart={player.viewStart}
            viewEnd={player.viewEnd}
            onCommit={(beatOffset) => {
              void onPatch(track.id, { beatOffset }).catch(() => {});
            }}
          />

          <div className="absolute right-4 top-4 z-10 flex flex-col overflow-hidden rounded-md border border-zinc-700 bg-zinc-900/80 backdrop-blur-sm">
            <button
              type="button"
              onClick={() => zoomBy(ZOOM_STEP)}
              className="flex h-8 w-8 items-center justify-center text-zinc-300 hover:bg-zinc-700 hover:text-white"
              aria-label="Zoom in"
              title="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <div className="h-px bg-zinc-700" />
            <button
              type="button"
              onClick={() => zoomBy(1 / ZOOM_STEP)}
              className="flex h-8 w-8 items-center justify-center text-zinc-300 hover:bg-zinc-700 hover:text-white"
              aria-label="Zoom out"
              title="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <TransportControls player={player} />

      <div className="h-16 px-2 py-1">
        <WaveformCanvas
          variant="overview"
          peaks={peaksFromOverview(track.waveformOverview) ?? peaks}
          viewStart={player.viewStart}
          viewEnd={player.viewEnd}
          playhead={playhead}
          zoom={player.zoom}
          onSeek={player.seekFraction}
          onViewChange={player.setView}
          onInteractionChange={player.setInteracting}
        />
      </div>

      <div className="grid grid-cols-[40px_minmax(0,1.4fr)_minmax(0,1fr)_70px_70px_70px] items-center gap-2 border-t border-zinc-800 bg-[#14181e] px-3 py-2 text-xs">
        <SongCover song={track} className="h-8 w-8 rounded-sm shadow-none" />
        <MetaField label="Title" value={track.title} disabled={track.status !== 'ready'} error={track.errorMessage} onCommit={(title) => onPatch(track.id, { title })} />
        <MetaField label="Artist" value={track.artist} disabled={track.status !== 'ready'} onCommit={(artist) => onPatch(track.id, { artist })} />
        <MetaField label="BPM" value={track.bpm > 0 ? String(track.bpm) : ''} disabled={track.status !== 'ready'} onCommit={(raw) => onPatch(track.id, { bpm: parseBpmInput(raw, track.bpm) })} />
        <MetaField label="Key" value={track.key} disabled={track.status !== 'ready'} onCommit={(key) => onPatch(track.id, { key })} />
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

function MetaField({
  label,
  value,
  disabled,
  error,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  error?: string;
  onCommit: (value: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(value);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const draftRef = useRef(draft);
  const valueRef = useRef(value);
  draftRef.current = draft;
  valueRef.current = value;

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void commit();
    }, 400);
    return () => window.clearTimeout(handle);
    // commit reads refs; debounce only on draft changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const commit = async () => {
    if (disabled || draftRef.current === valueRef.current) return;
    try {
      await onCommit(draftRef.current);
      setFieldError(null);
    } catch {
      setDraft(valueRef.current);
      setFieldError('Could not save');
    }
  };

  return (
    <label className="min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <input
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        className="w-full truncate bg-transparent text-zinc-100 outline-none disabled:text-zinc-500"
      />
      {(fieldError || error) && <p className="text-[10px] text-red-400">{fieldError || error}</p>}
    </label>
  );
}