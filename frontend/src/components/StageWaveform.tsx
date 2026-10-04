import { useRef, type CSSProperties } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { BeatGrid } from '@/components/BeatGrid';
import { CueMarkers } from '@/components/CueMarkers';
import { BandOptions, WaveformCanvas, WaveformVariant } from '@/components/WaveformCanvas';
import { useWaveformZoom, ZOOM_STEP } from '@/hooks/useWaveformZoom';
import type { TrackPlayer } from '@/hooks/useTrackPlayer';
import type { ThreeBandPeaks } from '@/lib/utils/threeBandWaveform';
import { Playhead } from './Playhead';

export enum WaveformDisplayMode {EDIT, CDJ};

// CDJ mode slides a wider offscreen canvas with transforms and redraws only
// near its edges or when zoom changes, avoiding per-frame canvas redraws.

// Width of the offscreen-rendered window, as a multiple of the visible span.
const CDJ_WINDOW_SPAN_MULTIPLIER = 3;
// Keep this at least (1 - playhead fraction) / window multiplier so fast
// scrubbing cannot reveal unpainted canvas beyond the rendered window.
const CDJ_REDRAW_MARGIN = 0.25;
// Where the playhead sits, as a fraction of the visible width, in CDJ mode.
const CDJ_PLAYHEAD_FRACTION = 0.25;

// Recompute the compositor-only slide from the live playhead each render;
// the playhead's fraction drifts while the rendered window stays fixed.
const CDJ_CANVAS_WIDTH_PERCENT = CDJ_WINDOW_SPAN_MULTIPLIER * 100;

// Returns the live visible CDJ window for overlays and miniwaveform viewport
// markers; player.viewStart/viewEnd update less often during auto-follow.
export function computeCdjVisibleWindow(
  playhead: number | undefined,
  playerViewStart: number,
  playerViewEnd: number,
): { start: number; end: number } {
  const visibleSpan = Math.max(1e-6, playerViewEnd - playerViewStart);
  const currentPlayhead = playhead ?? playerViewStart + visibleSpan / 2;
  const start = currentPlayhead - visibleSpan * CDJ_PLAYHEAD_FRACTION;
  return { start, end: start + visibleSpan };
}

type CdjWindow = { start: number; end: number; span: number };

function computeCdjWindow(playhead: number, visibleSpan: number): CdjWindow {
  const span = visibleSpan * CDJ_WINDOW_SPAN_MULTIPLIER;
  const start = playhead - span * CDJ_PLAYHEAD_FRACTION;
  return { start, end: start + span, span };
}

// Keep the render window in a ref and redraw only when its span changes or
// the playhead approaches an edge.
function useCdjWindow(playhead: number, visibleSpan: number): CdjWindow {
  const ref = useRef<CdjWindow | null>(null);
  if (!ref.current) {
    ref.current = computeCdjWindow(playhead, visibleSpan);
  }
  const targetSpan = visibleSpan * CDJ_WINDOW_SPAN_MULTIPLIER;
  const spanChanged = Math.abs(ref.current.span - targetSpan) > 1e-9;
  const margin = ref.current.span * CDJ_REDRAW_MARGIN;
  const nearEdge = playhead - ref.current.start < margin || ref.current.end - playhead < margin;
  if (spanChanged || nearEdge) {
    ref.current = computeCdjWindow(playhead, visibleSpan);
  }
  return ref.current;
}

export function StageWaveform({
  peaks,
  player,
  playhead,
  bpm,
  beatOffset,
  cues,
  bands,
  onSeek,
  displayMode = WaveformDisplayMode.EDIT,
  showZoomControls = true,
  onZoomBy,
}: {
  peaks: ThreeBandPeaks | null;
  player: TrackPlayer;
  playhead?: number;
  bpm: number;
  beatOffset: number;
  cues: Array<number | null>;
  bands?: BandOptions;
  // Not used in CDJ mode, since the big waveform there is a pure readout.
  onSeek?: (fraction: number) => void;
  displayMode?: WaveformDisplayMode;
  showZoomControls?: boolean;
  onZoomBy?: (factor: number) => void;
}) {
  const { zoomBy } = useWaveformZoom(player, playhead);
  const handleZoomBy = onZoomBy ?? zoomBy;

  const isCdj = displayMode === WaveformDisplayMode.CDJ;

  // Zoom controls the span; CDJ mode centers its live viewport on playback.
  const visibleSpan = Math.max(1e-6, player.viewEnd - player.viewStart);
  const currentPlayhead = playhead ?? player.viewStart + visibleSpan / 2;

  // Overlays use the live CDJ viewport, which is cheap to update every frame.
  const { start: cdjViewStart, end: cdjViewEnd } = computeCdjVisibleWindow(
    playhead,
    player.viewStart,
    player.viewEnd,
  );

  const viewStart = isCdj ? cdjViewStart : player.viewStart;
  const viewEnd = isCdj ? cdjViewEnd : player.viewEnd;

  // The wider rendered window and compositor slide are used only in CDJ mode.
  const cdjWindow = useCdjWindow(currentPlayhead, visibleSpan);
  // Track the playhead's live position within the wider rendered window.
  const cdjLocalFraction = (currentPlayhead - cdjWindow.start) / cdjWindow.span;
  const cdjSlidePercent =
    (CDJ_PLAYHEAD_FRACTION / CDJ_WINDOW_SPAN_MULTIPLIER - cdjLocalFraction) * 100;
  const cdjSliderStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: `${CDJ_CANVAS_WIDTH_PERCENT}%`,
    transform: `translateX(${cdjSlidePercent}%)`,
  };

  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
      {isCdj ? (
        // CDJ readout: playback drives the window; a transform slides it.
        <div style={cdjSliderStyle}>
          <WaveformCanvas
            variant={WaveformVariant.Zoomed}
            bands={bands}
            peaks={peaks}
            interactive={false}
            viewStart={cdjWindow.start}
            viewEnd={cdjWindow.end}
            zoom={player.zoom}
            allowOutOfBoundsWindow
          />
        </div>
      ) : (
        <WaveformCanvas
          variant={WaveformVariant.Zoomed}
          bands={bands}
          peaks={peaks}
          interactive
          viewStart={viewStart}
          viewEnd={viewEnd}
          zoom={player.zoom}
          onSeek={onSeek}
          onViewChange={player.setView}
          onInteractionChange={player.setInteracting}
        />
      )}

      <BeatGrid
        bpm={bpm}
        offset={beatOffset}
        durationSeconds={player.durationSeconds}
        viewStart={viewStart}
        viewEnd={viewEnd}
      />
      <CueMarkers
        cues={cues}
        durationSeconds={player.durationSeconds}
        viewStart={viewStart}
        viewEnd={viewEnd}
      />
      <Playhead
        playhead={playhead}
        viewStart={viewStart}
        viewEnd={viewEnd}
      />

      {showZoomControls ? (
        <div className="absolute right-2 top-2 z-10 flex flex-row overflow-hidden rounded-md border bg-zinc-900/80 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => handleZoomBy(ZOOM_STEP)}
            className="flex h-7 w-7 items-center justify-center text-zinc-300 hover:bg-zinc-700 hover:text-white"
            aria-label="Zoom in"
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <div className="my-1 w-px bg-zinc-700" />
          <button
            type="button"
            onClick={() => handleZoomBy(1 / ZOOM_STEP)}
            className="flex h-7 w-7 items-center justify-center text-zinc-300 hover:bg-zinc-700 hover:text-white"
            aria-label="Zoom out"
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}