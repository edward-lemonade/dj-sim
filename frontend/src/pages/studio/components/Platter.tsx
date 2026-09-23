import { useRef, useState } from 'react';
import type { Track } from '@/lib/types/Track';
import { DeckId } from '../useAudioEngine';

// Seconds of playback per full platter rotation — tunable "feel" constant
// for translating a drag into a scratch seek, not derived from anything
// (real vinyl at 33⅓rpm is ~1.8s/rev, used here as a familiar starting
// point). No longer used to derive the platter's own visual angle (see
// `angle` state below) — only to convert a drag into onScratchMove's
// deltaSeconds, same as before.
const SECONDS_PER_REVOLUTION = 1.8;

function isImageCover(cover: string | undefined | null): cover is string {
  return !!cover && (cover.startsWith('data:image/') || cover.startsWith('http'));
}

function angleFromPointer(event: PointerEvent, el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return Math.atan2(event.clientY - cy, event.clientX - cx);
}

// Handles the -π/π wraparound so a drag through the seam doesn't jump.
function shortestAngleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

export function Platter({
  label,
  size,
  track,
  currentTime,
  disabled,
  onScratchStart,
  onScratchMove,
  onScratchEnd,
}: {
  label?: DeckId;
  size?: number;
  track?: Track | null;
  // No longer drives rotation directly (see `angle` state below) — the
  // platter shouldn't auto-spin during normal playback, since a
  // continuously-moving target makes it hard to grab precisely for
  // scratching. Kept in the props for API compatibility / potential future
  // use (e.g. resyncing the visual angle on seek).
  currentTime: number;
  /** True when there's nothing to scratch (no track loaded / not ready). */
  disabled?: boolean;
  onScratchStart?: () => void;
  /** deltaSeconds: signed audio-seconds moved; deltaRealSeconds: wall time elapsed since the last move. */
  onScratchMove?: (deltaSeconds: number, deltaRealSeconds: number) => void;
  onScratchEnd?: () => void;
}) {
  const ringRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ lastAngle: number; lastTime: number } | null>(null);

  // Visual rotation, in degrees. Unlike the old currentTime-derived formula,
  // this only ever changes inside handlePointerMove below — it does not
  // track playback, so the platter sits still while the track plays and
  // only turns in direct response to the user's own drag motion.
  const [angle, setAngle] = useState(0);

  const coverUrl = isImageCover(track?.coverUrl) ? track.coverUrl : null;

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !ringRef.current) return;
    event.preventDefault();
    ringRef.current.setPointerCapture(event.pointerId);
    dragRef.current = { lastAngle: angleFromPointer(event.nativeEvent, ringRef.current), lastTime: performance.now() };
    onScratchStart?.();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !ringRef.current) return;
    event.preventDefault();
    const now = performance.now();
    const nextAngle = angleFromPointer(event.nativeEvent, ringRef.current);
    const deltaAngle = shortestAngleDelta(dragRef.current.lastAngle, nextAngle);
    const deltaSeconds = (deltaAngle / (2 * Math.PI)) * SECONDS_PER_REVOLUTION;
    const deltaRealSeconds = (now - dragRef.current.lastTime) / 1000;

    dragRef.current = { lastAngle: nextAngle, lastTime: now };

    // Rotate the ring by exactly the angle the pointer moved through — a
    // direct 1:1 visual response to the drag. Same deltaAngle that feeds
    // deltaSeconds below, just expressed in degrees for CSS instead of
    // being converted to an audio-seconds offset.
    setAngle((prev) => (prev + (deltaAngle * 180) / Math.PI) % 360);

    // Unchanged from before: the caller (scratch engine) still receives
    // audio-seconds moved, exactly as it did when the ring's angle was
    // driven by currentTime.
    onScratchMove?.(deltaSeconds, deltaRealSeconds);
  };

  const endDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    onScratchEnd?.();
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        ref={ringRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDragStart={(event) => event.preventDefault()}
        className={`relative select-none overflow-hidden rounded-full border border-zinc-600 bg-[#14181e] shadow-inner touch-none ${
          disabled ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
        }`}
        style={{ width: size, height: size }}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{ transform: `rotate(${angle}deg)` }}
        >
          {coverUrl ? (
            <img
              src={coverUrl}
              alt=""
              className="absolute inset-0 h-full w-full rounded-full object-cover"
              draggable={false}
            />
          ) : (
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  'repeating-radial-gradient(circle at center, transparent 0 7px, rgba(255,255,255,0.06) 7px 8px)',
              }}
            />
          )}
          {/* Dark ring so the label stays readable over any cover art */}
          <div className="absolute inset-[18%] rounded-full border border-zinc-500/50 bg-zinc-800/90" />
          {label !== undefined ? (
            <span className="absolute left-1/2 top-[62%] -translate-x-1/2 text-[10px] font-bold uppercase tracking-widest text-zinc-100 drop-shadow">
              {DeckId[label]}
            </span>
          ) : null}
        </div>
        <div className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-200" />
      </div>
    </div>
  );
}