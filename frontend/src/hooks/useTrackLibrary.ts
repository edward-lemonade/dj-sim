import { useCallback, useEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { coverLabelFromTitle, revokeCoverUrl } from '@/lib/utils/trackMetadata';
import { deleteTrack, listTracks, updateTrack } from '@/lib/api/TrackAPI';
import { getCurrentUser, registerUser } from '@/lib/api/UserAPI';
import { ApiError } from '@/lib/clients/axios';
import type { TrackDTO, TrackUpdateFields } from '@/lib/types/Track';
import type { Track } from '@/lib/types/Track';
import { useTrackUpload } from './useTrackUpload';
import { normalizeCues } from '@/lib/types/Cues';

export function trackToPool(track: TrackDTO): Track {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    bpm: track.bpm,
    beatOffset: track.beatOffset ?? 0,
    key: track.key ?? '',
    duration: track.duration,
    coverLabel: coverLabelFromTitle(track.title),
    coverUrl: track.cover && (track.cover.startsWith('data:image/') || track.cover.startsWith('http')) ? track.cover : null,
    waveformOverview: track.waveformOverview ?? null,
    cues: normalizeCues(track.cues),
    libraryStatus: 'ready',
  };
}

export function useTrackLibrary() {
  const { user, isLoaded, isSignedIn } = useUser();
  const [songs, setSongs] = useState<Track[]>([]);
  const songsRef = useRef<Track[]>([]);
  const { uploadRef, handleUpload } = useTrackUpload({ setSongs, isSignedIn });
  songsRef.current = songs;

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
        setSongs(tracks.map(trackToPool));
      } catch {
        if (!cancelled) setSongs([]);
      }
    }

    void loadPool();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, user]);

  useEffect(() => {
    return () => {
      songsRef.current.forEach((song) => revokeCoverUrl(song.coverUrl));
    };
  }, []);

  const removeSong = useCallback(async (song: Track) => {
    if (song.libraryStatus === 'uploading') return;

    if (song.libraryStatus === 'ready') {
      try {
        await deleteTrack(song.id);
      } catch (error) {
        const message = error instanceof ApiError ? error.message : 'Could not delete track';
        setSongs((current) =>
          current.map((item) =>
            item.id === song.id ? { ...item, libraryStatus: 'error', errorMessage: message } : item,
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
  }, []);

  const patchTrack = useCallback(async (id: string, fields: TrackUpdateFields) => {
    const previous = songsRef.current.find((song) => song.id === id);
    if (!previous || previous.libraryStatus !== 'ready') {
      throw new ApiError('Track is not ready', 400);
    }

    setSongs((current) =>
      current.map((song) => (song.id === id ? { ...song, ...fields, errorMessage: undefined } : song)),
    );

    try {
      const saved = await updateTrack(id, fields);
      setSongs((current) => current.map((song) => (song.id === id ? { ...trackToPool(saved), coverUrl: song.coverUrl } : song)));
      return saved;
    } catch (error) {
      setSongs((current) => current.map((song) => (song.id === id ? previous : song)));
      throw error;
    }
  }, []);

  return {
    songs,
    setSongs,
    isLoaded,
    isSignedIn,
    uploadRef,
    handleUpload,
    removeSong,
    patchTrack,
  };
}
