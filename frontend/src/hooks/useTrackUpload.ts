import { type ChangeEvent, type Dispatch, type SetStateAction, useCallback, useRef } from 'react';
import { coverLabelFromTitle, readTrackMetadata } from '@/lib/utils/trackMetadata';
import { computeOverviewFromFile } from '@/lib/utils/threeBandWaveform';
import { uploadTrack } from '@/lib/api/TrackAPI';
import { ApiError } from '@/lib/clients/axios';
import type { Track } from '@/lib/types/Track';
import { emptyCues, normalizeCues } from '@/lib/types/Cues';

export function useTrackUpload({
  setSongs,
  isSignedIn,
}: {
  setSongs: Dispatch<SetStateAction<Track[]>>;
  isSignedIn: boolean | undefined;
}) {
  const uploadRef = useRef<HTMLInputElement | null>(null);

  const uploadOne = useCallback(async (file: File) => {
    const pendingId = `upload-${crypto.randomUUID()}`;
    const metadata = await readTrackMetadata(file);
    const pending: Track = {
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
      cues: emptyCues(),
      libraryStatus: 'uploading',
      uploadProgress: 0,
    };

    setSongs((current) => [pending, ...current]);

    const setProgress = (percent: number) => {
      setSongs((current) =>
        current.map((song) =>
          song.id === pendingId ? { ...song, uploadProgress: percent } : song,
        ),
      );
    };

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

      const saved = await uploadTrack(file, { ...metadata, waveformOverview }, setProgress);
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
                libraryStatus: 'ready',
                uploadProgress: undefined,
                cues: normalizeCues(saved.cues),
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
            ? { ...song, libraryStatus: 'error', uploadProgress: undefined, errorMessage: message }
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