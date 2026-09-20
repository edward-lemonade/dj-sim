import { useEffect, useRef, useState } from 'react';
import { GripVertical, MoreHorizontal, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useUser } from '@clerk/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { coverLabelFromTitle, revokeCoverUrl } from '@/lib/audio/trackMetadata';
import { deleteTrack, listTracks } from '@/lib/api/TrackAPI';
import { getCurrentUser, registerUser } from '@/lib/api/UserAPI';
import { ApiError } from '@/lib/clients/axios';
import { cn } from '@/lib/utils';
import { SongCover } from './SongCover';
import type { PoolTrack } from './types';
import { rowShift, useListItemMove } from './useListItemMove';
import { useTrackUpload } from './useTrackUpload';

function HomePage() {
  const { user, isLoaded, isSignedIn } = useUser();
  const [songs, setSongs] = useState<PoolTrack[]>([]);
  const songsRef = useRef<PoolTrack[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const { drag, draggedSong, stride, onRowPointerDown } = useListItemMove({ songs, setSongs, listRef });
  const { uploadRef, handleUpload } = useTrackUpload({ setSongs, isSignedIn })
  songsRef.current = songs;

  // fetch pool
  useEffect(() => {
    if (!isLoaded) return;

    let cancelled = false;

    async function loadPool() {
      if (!isSignedIn || !user) {
        if (!cancelled) setSongs([]);
        return;
      }

      try {
        const existing = await getCurrentUser();
        if (!existing) {
          const username =
            user.username ||
            user.primaryEmailAddress?.emailAddress?.split('@')[0] ||
            `user-${user.id.slice(-8)}`;
          await registerUser({ username });
        }

        const tracks = await listTracks();
        if (cancelled) return;
        setSongs(tracks.map((track) => ({
          id: track.id,
          title: track.title,
          artist: track.artist,
          bpm: track.bpm,
          duration: track.duration,
          coverLabel: coverLabelFromTitle(track.title),
          coverUrl: track.cover && (track.cover.startsWith('data:image/') || track.cover.startsWith('http')) ? track.cover : null,
          status: 'ready',
        })));
      } catch {
        if (!cancelled) setSongs([]);
      }
    }

    void loadPool();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, user]);

  // revoke urls
  useEffect(() => {
    return () => {
      songsRef.current.forEach((song) => revokeCoverUrl(song.coverUrl));
    };
  }, []);

  const removeSong = async (song: PoolTrack) => {
    if (song.status === 'uploading') return;

    if (song.status === 'ready') {
      try {
        await deleteTrack(song.id);
      } catch (error) {
        const message = error instanceof ApiError ? error.message : 'Could not delete track';
        setSongs((current) =>
          current.map((item) =>
            item.id === song.id ? { ...item, status: 'error', errorMessage: message } : item,
          ),
        );
        return;
      }
    }

    setSongs((current) => {
      const next = current.filter((item) => item.id !== song.id);
      if (!next.some((item) => item.coverUrl === song.coverUrl)) {
        revokeCoverUrl(song.coverUrl);
      }
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(120,95,220,0.18),_transparent_45%),linear-gradient(180deg,#f8f2ed_0%,#f4e7df_26%,#efe7dc_100%)] text-slate-800">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white/60 px-4 py-3 shadow-sm backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 via-fuchsia-500 to-pink-500 text-sm font-bold text-white shadow-md shadow-violet-500/20">
              DJ
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Library</p>
              <h1 className="text-xl font-semibold text-slate-900">DJ Sim</h1>
            </div>
          </div>

          <nav className="flex items-center gap-2">
            <Button variant="ghost" className="rounded-full text-slate-700 hover:bg-slate-200/80">Home</Button>
            <Button variant="ghost" className="rounded-full text-slate-700 hover:bg-slate-200/80">
              <Link to="/studio">Studio</Link>
            </Button>
          </nav>
        </header>

        <main className="mx-auto max-w-4xl">
          <Card className="border-slate-200/80 bg-white/65 shadow-[0_24px_55px_rgba(54,36,61,0.1)] backdrop-blur-md">
            <CardHeader className="flex flex-row items-center justify-between border-b border-slate-200/80 px-4 py-3 sm:px-5">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Your queue</p>
                <CardTitle className="mt-1 text-xl font-semibold text-slate-900">Song pool</CardTitle>
              </div>

              <div className="flex items-center gap-2">
                <div className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                  {songs.length} tracks
                </div>
                <input
                  ref={uploadRef}
                  type="file"
                  accept="audio/*"
                  multiple
                  className="hidden"
                  onChange={handleUpload}
                />
                <Button
                  className="bg-slate-900 text-white hover:bg-slate-800"
                  onClick={() => uploadRef.current?.click()}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Upload tracks
                </Button>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              <div ref={listRef} className="max-h-[560px] overflow-y-auto overscroll-contain px-2 py-2 sm:px-3">
                <div className="flex flex-col gap-2">
                  {songs.map((song, index) => {
                    const isBusy = song.status === 'uploading';
                    const isDragged = drag?.id === song.id;
                    const shift = drag && !isDragged
                      ? rowShift(index, drag.fromIndex, drag.toIndex, stride)
                      : 0;
                    return (
                      <div
                        key={song.id}
                        data-song-row
                        onPointerDown={(event) => onRowPointerDown(event, song)}
                        style={{ transform: shift ? `translateY(${shift}px)` : undefined }}
                        className={cn(
                          'group flex items-center gap-3 rounded-xl border p-2.5',
                          !isDragged && drag && 'transition-transform duration-200 ease-out',
                          isDragged && 'invisible',
                          song.status === 'uploading' && 'cursor-default border-slate-200 bg-slate-100/80 opacity-60',
                          song.status === 'ready' && !isDragged && 'cursor-grab border-slate-200 bg-[#f9f7f5] hover:border-slate-300 hover:bg-white',
                          song.status === 'error' && 'cursor-default border-red-200 bg-red-50/80',
                          drag && 'cursor-grabbing',
                        )}
                      >
                        <div className="flex items-center gap-2 text-slate-400">
                          <span className="flex h-8 w-6 touch-none items-center justify-center rounded-md">
                            <GripVertical className="h-4 w-4" />
                          </span>
                          <span className="w-5 text-center text-xs font-medium text-slate-500">{index + 1}</span>
                        </div>

                        <SongCover song={song} />

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <input
                              value={song.title}
                              disabled={isBusy}
                              onChange={(event) =>
                                setSongs((current) =>
                                  current.map((item) =>
                                    item.id === song.id ? { ...item, title: event.target.value } : item,
                                  ),
                                )
                              }
                              className="w-full bg-transparent text-sm font-medium text-slate-900 outline-none disabled:text-slate-500"
                            />
                          </div>
                          {song.status === 'uploading' ? (
                            <p className="text-xs text-slate-500">Uploading…</p>
                          ) : (
                            <>
                              <input
                                value={song.artist}
                                disabled={isBusy}
                                onChange={(event) =>
                                  setSongs((current) =>
                                    current.map((item) =>
                                      item.id === song.id ? { ...item, artist: event.target.value } : item,
                                    ),
                                  )
                                }
                                className="w-full bg-transparent text-xs text-slate-500 outline-none disabled:text-slate-500"
                              />
                              {song.status === 'error' && (
                                <p className="text-xs text-red-600">{song.errorMessage || 'Upload failed'}</p>
                              )}
                            </>
                          )}
                        </div>

                        <div className="hidden items-center gap-3 text-xs font-medium text-slate-500 md:flex">
                          <span>{song.bpm > 0 ? `${song.bpm} BPM` : '— BPM'}</span>
                          <span>{song.duration}</span>
                        </div>

                        <div className="flex items-center gap-1" data-no-drag>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-600 hover:bg-slate-200/80" disabled={isBusy}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-600 hover:bg-red-100 hover:text-red-600"
                            disabled={song.status === 'uploading'}
                            onClick={() => void removeSong(song)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-600 hover:bg-slate-200/80" disabled={isBusy}>
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}

                  {songs.length === 0 && (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
                      No tracks yet. Upload an audio file to start your pool.
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => uploadRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-4 text-sm font-medium text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-100/80 hover:text-slate-800"
                  >
                    <Plus className="h-4 w-4" />
                    Add track
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>

      {drag && draggedSong && (
        <div
          className="pointer-events-none fixed z-50"
          style={{
            width: drag.width,
            left: drag.x - drag.offsetX,
            top: drag.y - drag.offsetY,
            transform: 'rotate(-1.25deg) scale(1.03)',
          }}
        >
          <div className="flex items-center gap-3 rounded-xl border border-slate-300 bg-white p-2.5 shadow-2xl shadow-slate-900/20">
            <div className="flex items-center gap-2 text-slate-400">
              <GripVertical className="h-4 w-4" />
              <span className="w-5 text-center text-xs font-medium text-slate-500">{drag.toIndex + 1}</span>
            </div>
            <SongCover song={draggedSong} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">{draggedSong.title}</p>
              <p className="truncate text-xs text-slate-500">{draggedSong.artist}</p>
            </div>
            <div className="hidden items-center gap-3 text-xs font-medium text-slate-500 md:flex">
              <span>{draggedSong.bpm > 0 ? `${draggedSong.bpm} BPM` : '— BPM'}</span>
              <span>{draggedSong.duration}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default HomePage;
