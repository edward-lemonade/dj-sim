import { TrackLibraryStatus, type Track } from '@/lib/types/Track';
import { normalizeCues } from '@/lib/types/Cues';
import type { RoomTrack } from '@/lib/types/Room';
import type { StreamDeckSnapshot } from '@/lib/types/Stream';

function parseTrackDuration(value: string): number {
  const parts = value.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

const MAX_STREAM_COVER_URL_LENGTH = 48 * 1024;
const STREAM_COVER_SIZE = 192;
const streamCoverThumbnails = new Map<string, Promise<string | null>>();

function isSafeStreamImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function createStreamCoverThumbnail(value: string): Promise<string | null> {
  return (async () => {
    if (!value.startsWith('data:image/')) {
      if (value.length > MAX_STREAM_COVER_URL_LENGTH) return null;
      return isSafeStreamImageUrl(value) ? value : null;
    }
    if (!/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;

    try {
      const image = await createImageBitmap(await (await fetch(value)).blob());
      const canvas = document.createElement('canvas');
      canvas.width = STREAM_COVER_SIZE;
      canvas.height = STREAM_COVER_SIZE;
      const context = canvas.getContext('2d');
      if (!context) {
        image.close();
        return null;
      }

      const scale = Math.min(STREAM_COVER_SIZE / image.width, STREAM_COVER_SIZE / image.height);
      const width = Math.round(image.width * scale);
      const height = Math.round(image.height * scale);
      context.drawImage(image, (STREAM_COVER_SIZE - width) / 2, (STREAM_COVER_SIZE - height) / 2, width, height);
      image.close();

      let quality = 0.78;
      let thumbnail = canvas.toDataURL('image/jpeg', quality);
      while (thumbnail.length > MAX_STREAM_COVER_URL_LENGTH && quality > 0.35) {
        quality -= 0.1;
        thumbnail = canvas.toDataURL('image/jpeg', quality);
      }
      return thumbnail.length <= MAX_STREAM_COVER_URL_LENGTH ? thumbnail : null;
    } catch (cause) {
      console.warn('Could not prepare track cover for streaming', cause);
      return null;
    }
  })();
}

function toStreamCoverUrl(value: string | null): Promise<string | null> {
  if (!value) return Promise.resolve(null);
  const cached = streamCoverThumbnails.get(value);
  if (cached) return cached;

  const thumbnail = createStreamCoverThumbnail(value);
  streamCoverThumbnails.set(value, thumbnail);
  return thumbnail;
}

export async function toStreamTrack(track: Track): Promise<StreamDeckSnapshot['track']> {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    bpm: track.bpm,
    beatOffset: track.beatOffset,
    key: track.key,
    durationSeconds: parseTrackDuration(track.duration),
    cues: [...(track.cues ?? [])],
    waveformOverview: track.waveformOverview,
    coverUrl: await toStreamCoverUrl(track.coverUrl),
  };
}

export function trackFromSnapshot(track: StreamDeckSnapshot['track']): Track | null {
  if (!track) return null;
  const duration = Math.max(0, Math.floor(track.durationSeconds));
  return {
    ...track,
    duration: `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`,
    coverLabel: '',
    libraryStatus: TrackLibraryStatus.Ready,
  };
}

export function trackFromRoomLibrary(track: RoomTrack): Track {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    bpm: track.bpm,
    beatOffset: 0,
    key: track.key,
    waveformOverview: null,
    cues: normalizeCues(null),
    duration: '0:00',
    coverLabel: '',
    coverUrl: track.coverUrl,
    libraryStatus: TrackLibraryStatus.Ready,
  };
}
