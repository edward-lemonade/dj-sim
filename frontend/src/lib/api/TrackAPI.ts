import API_ROUTES from '@/config/api';
import { axiosClient } from '@/lib/clients/axios';
import type { TrackDTO, TrackUpdateFields, WaveformOverview } from '@/lib/types/Track';

export type UploadTrackMetadata = {
  title: string;
  artist: string;
  bpm: number;
  duration: string;
  key?: string;
  coverDataUrl?: string | null;
  waveformOverview?: WaveformOverview | null;
};

export async function listTracks(): Promise<TrackDTO[]> {
  const { data } = await axiosClient.get<TrackDTO[]>(API_ROUTES.track.list);
  return data ?? [];
}

export async function uploadTrack(file: File, metadata: UploadTrackMetadata): Promise<TrackDTO> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('title', metadata.title);
  formData.append('artist', metadata.artist);
  formData.append('bpm', String(metadata.bpm));
  formData.append('duration', metadata.duration);
  formData.append('key', metadata.key ?? '');
  if (metadata.coverDataUrl) {
    formData.append('cover', metadata.coverDataUrl);
  }
  if (metadata.waveformOverview) {
    formData.append('waveformOverview', JSON.stringify(metadata.waveformOverview));
  }

  const { data } = await axiosClient.post<TrackDTO>(API_ROUTES.track.upload, formData);
  return data;
}

export async function updateTrack(id: string, fields: TrackUpdateFields): Promise<TrackDTO> {
  const { data } = await axiosClient.patch<TrackDTO>(API_ROUTES.track.update(id), fields);
  return data;
}

export async function fetchTrackAudioBlob(id: string): Promise<Blob> {
  const { data } = await axiosClient.get<Blob>(API_ROUTES.track.audio(id), {
    responseType: 'blob',
  });
  return data;
}

export async function deleteTrack(id: string): Promise<void> {
  await axiosClient.delete(API_ROUTES.track.remove(id));
}
