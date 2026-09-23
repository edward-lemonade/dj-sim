import { useEffect, useRef, useState } from 'react';
import { cn } from 'cn';
import { drawMonoWaveform, drawRgbWaveform, type ThreeBandPeaks } from '@/lib/utils/threeBandWaveform';

export enum BandOptions {Triple, Single}

type WaveformCanvasProps = {
  peaks: ThreeBandPeaks | null;
  variant: 'zoomed' | 'overview' | 'mini';
  bands?: BandOptions;
  viewStart?: number;
  viewEnd?: number;
  className?: string;
  onSeek?: (fraction: number) => void;
  onViewChange?: (start: number, zoom: number) => void;
  onInteractionChange?: (active: boolean) => void;
  zoom?: number;
  // When false, the canvas is a pure readout: no click-to-seek, no drag-to-pan,
  // no wheel/scrollbar panning, no native scrollbar UI at all. Used for
  // CDJ-style displays where the view window is driven externally (e.g.
  // centered on the playhead every frame) rather than by user interaction.
  interactive?: boolean;
  // When true, viewStart/viewEnd past [0,1] are drawn as empty space instead
  // of being clamped/compressed to fit inside the track's duration. Used by
  // the CDJ display, whose pre-rendered window intentionally extends past
  // the start/end of the track so the playhead can sit off-center.
  allowOutOfBoundsWindow?: boolean;
};

export function WaveformCanvas({
  peaks,
  variant,
  bands,
  viewStart = 0,
  viewEnd = 1,
  className,
  onSeek,
  onViewChange,
  onInteractionChange,
  zoom = 1,
  interactive = true,
  allowOutOfBoundsWindow = false,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const ignoreNextScroll = useRef(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const dragRef = useRef<{
    mode: 'pan' | 'seek' | 'viewport';
    lastX: number;
    moved: boolean;
    startView: number;
  } | null>(null);
  const viewRef = useRef({ viewStart, viewEnd, zoom, variant, onViewChange, onSeek, onInteractionChange, peaks });
  viewRef.current = { viewStart, viewEnd, zoom, variant, onViewChange, onSeek, onInteractionChange, peaks };

  // Only the zoomed variant ever gets the scrollable-wrapper UI (native scrollbar,
  // wheel-pan, scroll-sync), and only while interactive. A non-interactive zoomed
  // canvas (CDJ mode) renders as a plain <canvas>, sized by its parent, with its
  // view window driven entirely by the viewStart/viewEnd props.
  const showScrollUI = variant === 'zoomed' && interactive;

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const full = variant !== 'zoomed';
    const useRgb = (bands ?? (variant === 'zoomed' ? BandOptions.Triple : BandOptions.Single)) === BandOptions.Triple;
    const draw = useRgb ? drawRgbWaveform : drawMonoWaveform;
    const resolution = variant === 'mini' ? 3 : variant === 'overview' ? 2 : 1;
    const opts = {
      showViewport: variant === 'overview',
      viewportStart: viewStart,
      viewportEnd: viewEnd,
      background: variant === 'mini' ? '#15181d' : '#0b0d10',
      resolution,
      allowOutOfBoundsWindow: full ? false : allowOutOfBoundsWindow,
    };
    console.log('redraw', { variant, full, useRgb, viewStart, viewEnd, drawnStart: full ? 0 : viewStart, drawnEnd: full ? 1 : viewEnd, opts });
    draw(canvas, peaks, full ? 0 : viewStart, full ? 1 : viewEnd, opts);
  };

  useEffect(() => {
    redraw();
  }, [peaks, variant, viewEnd, viewStart, bands, allowOutOfBoundsWindow]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => redraw());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [peaks, variant, viewEnd, viewStart, bands, allowOutOfBoundsWindow]);

  // Zoomed + interactive: keep the native scrollbar's scrollLeft in sync with
  // viewStart/zoom. Runs whenever those change externally (zoom buttons,
  // programmatic seeks, resize) — guarded so it doesn't fight with handleScroll
  // below. Skipped entirely in CDJ (non-interactive) mode, which has no scrollbar.
  useEffect(() => {
    if (!showScrollUI) return;
    const el = scrollRef.current;
    if (!el) return;

    const sync = () => {
      const virtualWidth = el.clientWidth * zoom;
      if (virtualWidth <= 0) return;
      const target = viewStart * virtualWidth;
      if (Math.abs(el.scrollLeft - target) > 1) {
        ignoreNextScroll.current = true;
        el.scrollLeft = target;
      }
    };

    sync();
    const observer = new ResizeObserver(() => {
      setContainerWidth(el.clientWidth);
      sync();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [showScrollUI, viewStart, zoom]);

  // Zoomed + interactive: wheel (vertical or trackpad-horizontal) pans instead of zooming.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !showScrollUI) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      el.scrollLeft += delta;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [showScrollUI]);

  const handleScroll = () => {
    if (!showScrollUI) return;
    if (ignoreNextScroll.current) {
      ignoreNextScroll.current = false;
      return;
    }
    const el = scrollRef.current;
    const { onViewChange: change, zoom: currentZoom } = viewRef.current;
    if (!el || !change) return;
    const virtualWidth = el.clientWidth * currentZoom;
    if (virtualWidth <= 0) return;
    const nextStart = el.scrollLeft / virtualWidth;
    viewRef.current.viewStart = nextStart;
    change(nextStart, currentZoom);
  };

  const fractionAt = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(Math.max(0, clientX - rect.left), rect.width);
    const local = rect.width === 0 ? 0 : x / rect.width;
    if (variant === 'zoomed') {
      return viewStart + local * Math.max(1e-6, viewEnd - viewStart);
    }
    return local;
  };

  const canvasEl = (
    <canvas
      ref={canvasRef}
      className={cn('block h-full w-full touch-none', !showScrollUI && className)}
      onPointerDown={(event) => {
        if (!interactive || !peaks) return;
        (event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId);
        onInteractionChange?.(true);
        const mode = variant === 'zoomed' ? 'pan' : variant === 'overview' ? 'viewport' : 'seek';
        dragRef.current = { mode, lastX: event.clientX, moved: false, startView: viewStart };
        if (variant === 'mini') onSeek?.(fractionAt(event.clientX));
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag) return;
        const dx = event.clientX - drag.lastX;
        if (Math.abs(dx) > 2) drag.moved = true;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        if (drag.mode === 'pan' && onViewChange) {
          const width = viewEnd - viewStart;
          const delta = rect.width === 0 ? 0 : -(dx / rect.width) * width;
          const nextStart = viewRef.current.viewStart + delta;
          viewRef.current.viewStart = nextStart;
          onViewChange(nextStart, zoom);
        } else if (drag.mode === 'viewport' && onViewChange) {
          const delta = rect.width === 0 ? 0 : (dx / rect.width);
          const nextStart = viewRef.current.viewStart + delta;
          viewRef.current.viewStart = nextStart;
          onViewChange(nextStart, zoom);
        } else if (drag.mode === 'seek') {
          onSeek?.(fractionAt(event.clientX));
        }
        drag.lastX = event.clientX;
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current;
        dragRef.current = null;
        onInteractionChange?.(false);
        if (!drag) return;
        if (!drag.moved) {
          onSeek?.(fractionAt(event.clientX));
        } else if (drag.mode === 'viewport') {
          onSeek?.(viewStart + (viewEnd - viewStart) / 2);
        }
      }}
      onPointerCancel={() => {
        dragRef.current = null;
        onInteractionChange?.(false);
      }}
    />
  );

  if (!showScrollUI) {
    return canvasEl;
  }

  // The spacer below is never visually shown — its width (containerWidth * zoom) is what
  // gives the scroll container a real scrollWidth, so the browser draws a working scrollbar.
  // The canvas stays sticky at the left edge so it always shows just the current viewStart–viewEnd slice.
  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className={cn('relative h-full w-full min-h-0 max-h-full min-w-0 max-w-full overflow-x-auto overflow-y-hidden', className)}
    >
      <div className="sticky left-0 top-0 h-full w-full">{canvasEl}</div>
      <div aria-hidden className="h-px" style={{ width: `${containerWidth * zoom}px` }} />
    </div>
  );
}