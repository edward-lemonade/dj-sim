import { useRef, type CSSProperties } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { BeatGrid } from '@/components/BeatGrid';
import { CueMarkers } from '@/components/CueMarkers';
import { BandOptions, WaveformCanvas } from '@/components/WaveformCanvas';
import { useWaveformZoom, ZOOM_STEP } from '@/hooks/useWaveformZoom';
import type { TrackPlayer } from '@/hooks/useTrackPlayer';
import type { ThreeBandPeaks } from '@/lib/utils/threeBandWaveform';
import { Playhead } from './Playhead';

export enum WaveformDisplayMode {EDIT, CDJ};

// --- CDJ windowing -------------------------------------------------------
//
// In CDJ mode the visible window slides continuously with playback. Naively
// recomputing WaveformCanvas's viewStart/viewEnd every render means a full
// canvas redraw every frame, which is expensive enough to visibly stutter.
//
// Instead, the big waveform canvas is rendered once across a window wider
// than what's visible (CDJ_WINDOW_SPAN_MULTIPLIER × the visible span), and
// that canvas is positioned with a CSS `transform: translateX(...)` that's
// recalculated every render. The transform is pure compositing — no redraw —
// so it stays smooth every frame. The rendered window itself (state, kept in
// a ref) is only recomputed, triggering a real redraw, once the playhead
// gets close to either edge of it, or the zoom level changes.

// Width of the offscreen-rendered window, as a multiple of the visible span.
const CDJ_WINDOW_SPAN_MULTIPLIER = 3;
// Recompute (redraw) the window once the playhead is within this fraction of
// the window's span from either edge.
const CDJ_REDRAW_MARGIN = 0.15;
// Where the playhead sits, as a fraction of the visible width, in CDJ mode.
const CDJ_PLAYHEAD_FRACTION = 0.25;

const CDJ_CANVAS_WIDTH_PERCENT = CDJ_WINDOW_SPAN_MULTIPLIER * 100;

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

// Synchronous (no effect lag): recomputed inline during render, in a ref, so
// the canvas always gets an up-to-date window in the same render pass that
// the playhead moved in. Only actually changes (and therefore redraws) when
// the playhead nears the window's edge or the visible span changes.
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
}) {
  const { zoomBy } = useWaveformZoom(player, playhead);

  const isCdj = displayMode === WaveformDisplayMode.CDJ;

  // The visible span (in track-fraction units) is driven by player.zoom
  // either way; only how it's centered differs between edit and CDJ mode.
  const visibleSpan = Math.max(1e-6, player.viewEnd - player.viewStart);
  const currentPlayhead = playhead ?? player.viewStart + visibleSpan / 2;

  // True visible window: what BeatGrid/CueMarkers/Playhead are drawn against.
  // In CDJ mode this slides every frame with playback, which is fine — those
  // overlays are cheap to re-render, unlike the big waveform canvas.
  const { start: cdjViewStart, end: cdjViewEnd } = computeCdjVisibleWindow(
    playhead,
    player.viewStart,
    player.viewEnd,
  );

  const viewStart = isCdj ? cdjViewStart : player.viewStart;
  const viewEnd = isCdj ? cdjViewEnd : player.viewEnd;

  // Offscreen-rendered window + slide transform for the big waveform canvas,
  // only used in CDJ mode.
  const cdjWindow = useCdjWindow(currentPlayhead, visibleSpan);
  // Fraction of the way across the rendered window the playhead currently
  // sits — exactly CDJ_PLAYHEAD_FRACTION right after a redraw, drifting
  // above or below that as playback advances until the next redraw.
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
        // Pure readout: no click-to-seek, no drag-to-pan, no view feedback —
        // the window is driven entirely by the playhead (via cdjWindow above),
        // and slid into place with a transform instead of being redrawn.
        <div style={cdjSliderStyle}>
          <WaveformCanvas
            variant="zoomed"
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
          variant="zoomed"
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