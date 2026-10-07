import { useCallback, useEffect, useMemo, type SetStateAction } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import { coverLabelFromTitle, revokeCoverUrl } from '@/lib/utils/trackMetadata';
import { analyzeTrack, cancelTrackAnalysis, deleteTrack, listTracks, updateTrack } from '@/lib/api/TrackAPI';
import { ensureCurrentUser } from '@/lib/api/UserAPI';
import { queryKeys } from '@/lib/queryClient';
import { ApiError } from '@/lib/clients/axios';
import {
  TrackAnalysisStatus,
  TrackLibraryStatus,
  type Track,
  type TrackDTO,
  type TrackUpdateFields,
} from '@/lib/types/Track';
import { useTrackUpload } from './useTrackUpload';
import { normalizeCues } from '@/lib/types/Cues';
import { useToast } from '@/components/ui/toast';
import { ToastVariant } from '@/components/ui/toast';

export function trackToPool(track: TrackDTO): Track {
  const libraryStatus =
    track.analysisStatus === TrackAnalysisStatus.Pending
      ? TrackLibraryStatus.Analyzing
      : track.analysisStatus === TrackAnalysisStatus.Failed
        ? TrackLibraryStatus.Error
        : TrackLibraryStatus.Ready;

  return {
    id: track.id,
    createdAt: track.createdAt,
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
    errorMessage: track.analysisStatus === TrackAnalysisStatus.Failed ? 'Analysis failed — BPM and key were not detected' : undefined,
  };
}

export function useTrackLibrary() {
  const { user, isLoaded, isSignedIn } = useUser();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const trackLibraryKey = useMemo(() => queryKeys.trackLibrary(user?.id ?? null), [user?.id]);
  const setSongs = useCallback((updater: SetStateAction<Track[]>) => {
    queryClient.setQueryData<Track[]>(trackLibraryKey, (current) =>
      typeof updater === 'function' ? updater(current ?? []) : updater,
    );
  }, [queryClient, trackLibraryKey]);
  const tracksQuery = useQuery({
    queryKey: trackLibraryKey,
    enabled: isLoaded && Boolean(isSignedIn && user),
    queryFn: async () => {
      if (!user) throw new Error('Cannot load tracks without a signed-in user.');
      const username =
        user.username ||
        user.primaryEmailAddress?.emailAddress?.split('@')[0] ||
        `user-${user.id.slice(-8)}`;
      await ensureCurrentUser(username);
      const tracks = await listTracks();
      const stillUploading = (queryClient.getQueryData<Track[]>(trackLibraryKey) ?? [])
        .filter((song) => song.libraryStatus === TrackLibraryStatus.Uploading);
      return [...stillUploading, ...tracks.map(trackToPool)];
    },
    refetchInterval: (query) =>
      query.state.data?.some((song) => song.libraryStatus === TrackLibraryStatus.Analyzing) ? 4000 : false,
  });
  const songs = tracksQuery.data ?? [];
  const isLoadingTracks = isLoaded && Boolean(isSignedIn) && tracksQuery.isPending;
  useEffect(() => {
    if (tracksQuery.isLoadingError && isLoaded && isSignedIn) {
      showToast(tracksQuery.error instanceof Error ? tracksQuery.error.message : 'Could not load your tracks.', ToastVariant.Error, {
        dedupeKey: 'tracks-library-load',
      });
    }
  }, [isLoaded, isSignedIn, showToast, tracksQuery.error, tracksQuery.isLoadingError]);
  const { uploadRef, handleUpload } = useTrackUpload({ setSongs, isSignedIn });

  const removeSong = useCallback(async (song: Track) => {
    if (song.libraryStatus === TrackLibraryStatus.Uploading) return;

    // Was previously gated on libraryStatus === 'ready' — 'error' tracks
    // were only removed locally, leaving a ghost row server-side. Any
    // non-'uploading' status means a real server row exists (including
    // the new 'analyzing' status), so it should always be deleted there.
    try {
      await deleteTrack(song.id);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Could not delete track';
      showToast(message, ToastVariant.Error, { dedupeKey: `track-delete-${song.id}` });
      setSongs((current) =>
        current.map((item) =>
          item.id === song.id ? { ...item, libraryStatus: TrackLibraryStatus.Error, errorMessage: message } : item,
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
  }, [setSongs, showToast]);

  const analyzeSong = useCallback(async (song: Track) => {
    if (song.libraryStatus === TrackLibraryStatus.Uploading || song.libraryStatus === TrackLibraryStatus.Analyzing) return;

    setSongs((current) =>
      current.map((item) =>
        item.id === song.id ? { ...item, libraryStatus: TrackLibraryStatus.Analyzing, errorMessage: undefined } : item,
      ),
    );

    try {
      await analyzeTrack(song.id);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Could not start analysis';
      showToast(message, ToastVariant.Error, { dedupeKey: `track-analysis-${song.id}` });
      setSongs((current) =>
        current.map((item) =>
          item.id === song.id ? { ...item, libraryStatus: TrackLibraryStatus.Error, errorMessage: message } : item,
        ),
      );
    }
  }, [setSongs, showToast]);

  const cancelAnalysis = useCallback(async (song: Track) => {
    if (song.libraryStatus !== TrackLibraryStatus.Analyzing) return;

    try {
      await cancelTrackAnalysis(song.id);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : 'Could not cancel track analysis.', ToastVariant.Error, {
        dedupeKey: `track-analysis-cancel-${song.id}`,
      });
      return;
    }

    setSongs((current) =>
      current.map((item) => (item.id === song.id ? { ...item, libraryStatus: TrackLibraryStatus.Ready } : item)),
    );
  }, [setSongs, showToast]);

  const patchTrack = useCallback(async (id: string, fields: TrackUpdateFields) => {
    const previous = (queryClient.getQueryData<Track[]>(trackLibraryKey) ?? []).find((song) => song.id === id);
    if (!previous || previous.libraryStatus !== TrackLibraryStatus.Ready) {
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
  }, [queryClient, setSongs, trackLibraryKey]);

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