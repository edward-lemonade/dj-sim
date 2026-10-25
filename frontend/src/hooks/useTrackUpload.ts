import { type ChangeEvent, type Dispatch, type SetStateAction, useCallback, useRef } from 'react';
import { coverLabelFromTitle, readTrackMetadata } from '@/lib/utils/trackMetadata';
import { computeOverviewFromFile } from '@/lib/utils/threeBandWaveform';
import { uploadTrack } from '@/lib/api/TrackAPI';
import { ApiError } from '@/lib/clients/axios';
import { TrackAnalysisStatus, TrackLibraryStatus, type Track } from '@/lib/types/Track';
import { emptyCues, normalizeCues } from '@/lib/types/Cues';
import { useToast } from '@/components/ui/toast';
import { ToastVariant } from '@/components/ui/toast';

export function useTrackUpload({
  setSongs,
  sessionReady,
}: {
  setSongs: Dispatch<SetStateAction<Track[]>>;
  sessionReady: boolean;
}) {
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const { showToast } = useToast();

  const uploadOne = useCallback(async (file: File) => {
    if (!sessionReady) {
      showToast('Your session is still being prepared. Please try again shortly.', ToastVariant.Info);
      return;
    }
    const pendingId = `upload-${crypto.randomUUID()}`;
    let metadata: Awaited<ReturnType<typeof readTrackMetadata>>;
    try {
      metadata = await readTrackMetadata(file);
    } catch (cause) {
      showToast(`${file.name}: ${cause instanceof Error ? cause.message : 'Could not read track metadata.'}`, ToastVariant.Error, {
        dedupeKey: `track-upload-${pendingId}`,
      });
      return;
    }
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
      libraryStatus: TrackLibraryStatus.Uploading,
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
                libraryStatus: saved.analysisStatus === TrackAnalysisStatus.Pending
                  ? TrackLibraryStatus.Analyzing
                  : TrackLibraryStatus.Ready,
                uploadProgress: undefined,
                cues: normalizeCues(saved.cues),
                errorMessage: undefined,
              }
            : song,
        ),
      );
      showToast(`${metadata.title || file.name} uploaded.`, ToastVariant.Success);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Upload failed';
      showToast(`${file.name}: ${message}`, ToastVariant.Error, { dedupeKey: `track-upload-${pendingId}` });
      setSongs((current) =>
        current.map((song) =>
          song.id === pendingId
            ? { ...song, libraryStatus: TrackLibraryStatus.Error, uploadProgress: undefined, errorMessage: message }
            : song,
        ),
      );
    }
  }, [sessionReady, setSongs, showToast]);

  const handleUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    if (!sessionReady) {
      showToast('Your session is still being prepared. Please try again shortly.', ToastVariant.Info);
      return;
    }

    await Promise.all(files.map((file) => uploadOne(file)));
  }, [sessionReady, showToast, uploadOne]);

  return {
    uploadRef,
    handleUpload,
  };
}