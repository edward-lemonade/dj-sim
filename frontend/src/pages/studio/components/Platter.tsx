import { useState } from 'react';
import type { Track } from '@/lib/types/Track';
import type { DeckId } from '../useAudioEngine';

function isImageCover(cover: string | undefined | null): cover is string {
  return !!cover && (cover.startsWith('data:image/') || cover.startsWith('http'));
}

export function Platter({
  label,
  size,
  track,
}: {
  label?: DeckId;
  size?: number;
  track?: Track | null;
}) {
  const [angle, setAngle] = useState(0);

  const coverUrl = isImageCover(track?.coverUrl) ? track.coverUrl : null;

  return (
    <div className="pointer-events-none flex flex-col items-center gap-1">
      <div
        className="relative overflow-hidden rounded-full border border-zinc-600 bg-[#14181e] shadow-inner"
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
          {label ? (
            <span className="absolute left-1/2 top-[62%] -translate-x-1/2 text-[10px] font-bold uppercase tracking-widest text-zinc-100 drop-shadow">
              {label}
            </span>
          ) : null}
        </div>
        <div className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-200" />
      </div>
    </div>
  );
}