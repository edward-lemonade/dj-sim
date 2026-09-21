import { LoaderCircle, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Track } from '@/lib/types/track';

export function SongCover({ song, className }: { song: Track; className?: string }) {
  return (
    <div className={cn('relative h-12 w-12 shrink-0 overflow-hidden shadow-sm shadow-violet-500/20', className)}>
      {song.status === 'error' ? (
        <div className="flex h-full w-full items-center justify-center bg-red-600 text-white" title={song.errorMessage || 'Upload failed'}>
          <TriangleAlert className="h-5 w-5" aria-hidden="true" />
        </div>
      ) : song.coverUrl ? (
        <img src={song.coverUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-500 via-fuchsia-500 to-pink-500 text-xs font-bold text-white">
          {song.coverLabel}
        </div>
      )}
      {song.status === 'uploading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/45">
          <LoaderCircle className="h-5 w-5 animate-spin text-white" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
