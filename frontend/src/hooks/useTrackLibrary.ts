import { useCallback, useEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { coverLabelFromTitle, revokeCoverUrl } from '@/lib/utils/trackMetadata';
import { analyzeTrack, cancelTrackAnalysis, deleteTrack, listTracks, updateTrack } from '@/lib/api/TrackAPI';
import { getCurrentUser, registerUser } from '@/lib/api/UserAPI';
import { ApiError } from '@/lib/clients/axios';
import type { TrackDTO, TrackUpdateFields } from '@/lib/types/Track';
import type { Track } from '@/lib/types/Track';
import { useTrackUpload } from './useTrackUpload';
import { normalizeCues } from '@/lib/types/Cues';

export function trackToPool(track: TrackDTO): Track {
  const libraryStatus =
    track.analysisStatus === 'pending'
      ? 'analyzing'
      : track.analysisStatus === 'failed'
        ? 'error'
        : 'ready';

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
    libraryStatus,
    errorMessage: track.analysisStatus === 'failed' ? 'Analysis failed — BPM and key were not detected' : undefined,
  };
}

export function useTrackLibrary() {
  const { user, isLoaded, isSignedIn } = useUser();
  const [songs, setSongs] = useState<Track[]>([]);
  const [isLoadingTracks, setIsLoadingTracks] = useState(true);
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
        setSongs((current) => {
          const stillUploading = current.filter((song) => song.libraryStatus === 'uploading');
          return [...stillUploading, ...tracks.map(trackToPool)];
        });
      } catch {
        if (!cancelled) setSongs([]);
      }
    }

    void loadPool().finally(() => {
      if (!cancelled) setIsLoadingTracks(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, user?.id]);

  // Poll while anything is still being analyzed server-side. The effect
  // re-runs whenever hasAnalyzing flips: React clears the previous
  // interval on every re-run, so once nothing is 'analyzing' anymore the
  // cleanup fires and no new interval is set — this stops on its own
  // rather than needing separate start/stop plumbing.
  const hasAnalyzing = songs.some((song) => song.libraryStatus === 'analyzing');

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !hasAnalyzing) return;

    const interval = window.setInterval(async () => {
      try {
        const tracks = await listTracks();
        setSongs((current) => {
          const stillUploading = current.filter((song) => song.libraryStatus === 'uploading');
          return [...stillUploading, ...tracks.map(trackToPool)];
        });
      } catch {
        // Transient poll failure — just try again on the next tick rather
        // than surfacing an error for a background refresh.
      }
    }, 4000);

    return () => window.clearInterval(interval);
  }, [isLoaded, isSignedIn, hasAnalyzing]);

  useEffect(() => {
    return () => {
      songsRef.current.forEach((song) => revokeCoverUrl(song.coverUrl));
    };
  }, []);

  const removeSong = useCallback(async (song: Track) => {
    if (song.libraryStatus === 'uploading') return;

    // Was previously gated on libraryStatus === 'ready' — 'error' tracks
    // were only removed locally, leaving a ghost row server-side. Any
    // non-'uploading' status means a real server row exists (including
    // the new 'analyzing' status), so it should always be deleted there.
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

    setSongs((current) => {
      const next = current.filter((item) => item.id !== song.id);
      if (!next.some((item) => item.coverUrl === song.coverUrl)) {
        revokeCoverUrl(song.coverUrl);
      }
      return next;
    });
  }, []);

  const analyzeSong = useCallback(async (song: Track) => {
    if (song.libraryStatus === 'uploading' || song.libraryStatus === 'analyzing') return;

    setSongs((current) =>
      current.map((item) =>
        item.id === song.id ? { ...item, libraryStatus: 'analyzing', errorMessage: undefined } : item,
      ),
    );

    try {
      await analyzeTrack(song.id);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Could not start analysis';
      setSongs((current) =>
        current.map((item) =>
          item.id === song.id ? { ...item, libraryStatus: 'error', errorMessage: message } : item,
        ),
      );
    }
  }, []);

  const cancelAnalysis = useCallback(async (song: Track) => {
    if (song.libraryStatus !== 'analyzing') return;

    try {
      await cancelTrackAnalysis(song.id);
    } catch {
      return;
    }

    setSongs((current) =>
      current.map((item) => (item.id === song.id ? { ...item, libraryStatus: 'ready' } : item)),
    );
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
    analyzeSong,
    cancelAnalysis,
    patchTrack,
    isLoadingTracks,
  };
}