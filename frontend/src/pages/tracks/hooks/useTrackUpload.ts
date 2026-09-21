import { type ChangeEvent, type Dispatch, type SetStateAction, useCallback, useRef } from 'react';
import { coverLabelFromTitle, readTrackMetadata } from '@/lib/audio/trackMetadata';
import { computeOverviewFromFile } from '@/lib/audio/threeBandWaveform';
import { uploadTrack } from '@/lib/api/TrackAPI';
import { ApiError } from '@/lib/clients/axios';
import type { PoolTrack } from '@/lib/types/track';

export function useTrackUpload({
  setSongs,
  isSignedIn,
}: {
  setSongs: Dispatch<SetStateAction<PoolTrack[]>>;
  isSignedIn: boolean | undefined;
}) {
  const uploadRef = useRef<HTMLInputElement | null>(null);

  const uploadOne = useCallback(async (file: File) => {
    const pendingId = `upload-${crypto.randomUUID()}`;
    const metadata = await readTrackMetadata(file);
    const pending: PoolTrack = {
      id: pendingId,
      title: metadata.title,
      artist: metadata.artist,
      bpm: metadata.bpm,
      beatOffset: 0,
      key: metadata.key,
      duration: metadata.duration,
      coverLabel: metadata.coverLabel,
      coverUrl: metadata.coverUrl,
      waveformOverview: null,
      status: 'uploading',
    };

    setSongs((current) => [pending, ...current]);

    try {
      if (!isSignedIn) {
        throw new ApiError('Sign in to upload tracks', 401);
      }

      let waveformOverview = null;
      try {
        waveformOverview = await computeOverviewFromFile(file);
      } catch (error) {
        console.warn('Could not compute waveform overview', error);
      }

      const saved = await uploadTrack(file, { ...metadata, waveformOverview });
      const finalCoverUrl = saved.cover && (saved.cover.startsWith('data:image/') || saved.cover.startsWith('http'))
        ? saved.cover
        : metadata.coverDataUrl ?? metadata.coverUrl ?? null;

      setSongs((current) =>
        current.map((song) =>
          song.id === pendingId
            ? {
                ...song,
                id: saved.id,
                title: metadata.title || saved.title,
                artist: metadata.artist || saved.artist,
                bpm: metadata.bpm || saved.bpm,
                beatOffset: saved.beatOffset ?? 0,
                key: metadata.key || saved.key || '',
                duration: metadata.duration !== '--:--' ? metadata.duration : saved.duration,
                coverLabel: coverLabelFromTitle(saved.title || metadata.title),
                coverUrl: finalCoverUrl,
                waveformOverview: saved.waveformOverview ?? waveformOverview,
                status: 'ready',
                errorMessage: undefined,
              }
            : song,
        ),
      );
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Upload failed';
      setSongs((current) =>
        current.map((song) =>
          song.id === pendingId
            ? { ...song, status: 'error', errorMessage: message }
            : song,
        ),
      );
    }
  }, [isSignedIn, setSongs]);

  const handleUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    await Promise.all(files.map((file) => uploadOne(file)));
  }, [uploadOne]);

  return {
    uploadRef,
    handleUpload,
  };
}
