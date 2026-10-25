import { type Dispatch, type SetStateAction, useCallback } from 'react';
import { coverLabelFromTitle, readTrackMetadata, type ParsedTrackMetadata } from '@/lib/utils/trackMetadata';
import { computeOverviewFromFile } from '@/lib/utils/threeBandWaveform';
import { uploadTrack } from '@/lib/api/TrackAPI';
import { ApiError } from '@/lib/clients/axios';
import { TrackAnalysisStatus, TrackLibraryStatus, type Track } from '@/lib/types/Track';
import { emptyCues, normalizeCues } from '@/lib/types/Cues';
import { useToast } from '@/components/ui/toast';
import { ToastVariant } from '@/components/ui/toast';

export type PreparedTrackFile = {
  id: string;
  file: File;
  metadata: ParsedTrackMetadata | null;
  error: string | null;
};

const AUDIO_EXTENSIONS = new Set([
  'aac', 'aif', 'aiff', 'alac', 'flac', 'm4a', 'mp3', 'oga', 'ogg',
  'opus', 'wav', 'wave', 'wma',
]);

function isAudioFile(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return file.type.startsWith('audio/') || AUDIO_EXTENSIONS.has(extension);
}

export function useTrackUpload({
  setSongs,
  sessionReady,
}: {
  setSongs: Dispatch<SetStateAction<Track[]>>;
  sessionReady: boolean;
}) {
  const { showToast } = useToast();

  const prepareFiles = useCallback(async (files: File[]): Promise<PreparedTrackFile[]> => {
    return Promise.all(files.map(async (file) => {
      const id = `staged-${crypto.randomUUID()}`;
      if (!isAudioFile(file)) {
        return { id, file, metadata: null, error: 'This file does not appear to be a supported audio track.' };
      }
      try {
        const metadata = await readTrackMetadata(file);
        return { id, file, metadata, error: null };
      } catch (cause) {
        return {
          id,
          file,
          metadata: null,
          error: cause instanceof Error ? cause.message : 'Could not read track metadata.',
        };
      }
    }));
  }, []);

  const uploadOne = useCallback(async (item: PreparedTrackFile) => {
    const { file, metadata } = item;
    if (!metadata) return;
    if (!sessionReady) {
      showToast('Your session is still being prepared. Please try again shortly.', ToastVariant.Info);
      return;
    }
    const pendingId = `upload-${crypto.randomUUID()}`;
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

  const uploadFiles = useCallback(async (files: PreparedTrackFile[]) => {
    if (files.length === 0) return;
    if (!sessionReady) {
      showToast('Your session is still being prepared. Please try again shortly.', ToastVariant.Info);
      return;
    }

    await Promise.all(files.map((file) => uploadOne(file)));
  }, [sessionReady, showToast, uploadOne]);

  return {
    prepareFiles,
    uploadFiles,
  };
}