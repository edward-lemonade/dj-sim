import { useLayoutEffect, useRef } from 'react';
import type { RoomCursor } from '@/lib/types/Room';

function AnimatedRoomCursor({ cursor }: { cursor: RoomCursor }) {
  const cursorElement = useRef<HTMLDivElement | null>(null);
  const position = useRef(cursor.pointer);
  const target = useRef(cursor.pointer);

  useLayoutEffect(() => {
    target.current = cursor.pointer;
    if (cursorElement.current) {
      cursorElement.current.style.left = `${position.current.x * 100}%`;
      cursorElement.current.style.top = `${position.current.y * 100}%`;
    }
    let frame = 0;
    let previousFrameAt = performance.now();
    const animate = (now: number) => {
      const element = cursorElement.current;
      if (!element) return;
      const elapsed = Math.min(50, now - previousFrameAt);
      previousFrameAt = now;
      const blend = 1 - Math.exp(-elapsed / 40);
      const nextX = position.current.x + (target.current.x - position.current.x) * blend;
      const nextY = position.current.y + (target.current.y - position.current.y) * blend;
      const settled = Math.abs(target.current.x - nextX) < 0.0001
        && Math.abs(target.current.y - nextY) < 0.0001;
      position.current = settled ? target.current : { x: nextX, y: nextY };
      element.style.left = `${position.current.x * 100}%`;
      element.style.top = `${position.current.y * 100}%`;
      if (!settled) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [cursor.pointer]);

  return (
    <div
      ref={cursorElement}
      className="absolute z-[90] flex items-start gap-1.5"
    >
      <svg aria-hidden="true" className="h-5 w-5 shrink-0 drop-shadow" viewBox="0 0 20 20" fill="none">
        <path d="M3 2.5v13l3.8-3.2 2.1 5 2.1-.9-2.1-4.8h5.2L3 2.5Z" fill="#67e8f9" stroke="#082f49" strokeWidth="1.2" />
      </svg>
      {cursor.username && (
        <span className="mt-3 rounded bg-cyan-300 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-slate-950 shadow">
          {cursor.username}
        </span>
      )}
    </div>
  );
}

export function RoomCursorOverlay({
  cursors,
  currentUserId = null,
}: {
  cursors: RoomCursor[];
  currentUserId?: string | null;
}) {
  const remoteCursors = cursors.filter((cursor) => cursor.userId !== currentUserId);
  if (remoteCursors.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {remoteCursors.map((cursor) => (
        <AnimatedRoomCursor key={cursor.userId} cursor={cursor} />
      ))}
    </div>
  );
}
