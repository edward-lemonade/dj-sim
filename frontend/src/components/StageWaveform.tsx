import { ZoomIn, ZoomOut } from 'lucide-react';
import { BeatGrid } from '@/components/BeatGrid';
import { CueMarkers } from '@/components/CueMarkers';
import { BandOptions, WaveformCanvas } from '@/components/WaveformCanvas';
import { useWaveformZoom, ZOOM_STEP } from '@/hooks/useWaveformZoom';
import type { TrackPlayer } from '@/hooks/useTrackPlayer';
import type { ThreeBandPeaks } from '@/lib/utils/threeBandWaveform';
import { Playhead } from './Playhead';

export function StageWaveform({
  peaks,
  player,
  playhead,
  bpm,
  beatOffset,
  cues,
  bands,
  onSeek,
}: {
  peaks: ThreeBandPeaks | null;
  player: TrackPlayer;
  playhead?: number;
  bpm: number;
  beatOffset: number;
  cues: Array<number | null>;
  bands?: BandOptions;
  onSeek: (fraction: number) => void;
}) {
  const { zoomBy } = useWaveformZoom(player, playhead);

  return (
    <div className="relative min-h-0 min-w-0 flex-col ">
      <WaveformCanvas
        variant="zoomed"
        bands={bands}
        peaks={peaks}
        viewStart={player.viewStart}
        viewEnd={player.viewEnd}
        zoom={player.zoom}
        onSeek={onSeek}
        onViewChange={player.setView}
        onInteractionChange={player.setInteracting}
      />

      <BeatGrid
        bpm={bpm}
        offset={beatOffset}
        durationSeconds={player.durationSeconds}
        viewStart={player.viewStart}
        viewEnd={player.viewEnd}
      />
      <CueMarkers
        cues={cues}
        durationSeconds={player.durationSeconds}
        viewStart={player.viewStart}
        viewEnd={player.viewEnd}
      />
      <Playhead 
        playhead={playhead} 
        viewStart={player.viewStart} 
        viewEnd={player.viewEnd} 
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
  );
}
