import API_ROUTES from '@/config/api';
import { axiosClient } from '@/lib/clients/axios';
import type { Track } from '@/lib/types/track';

export async function listTracks(): Promise<Track[]> {
  const { data } = await axiosClient.get<Track[]>(API_ROUTES.track.list);
  return data ?? [];
}

export async function uploadTrack(file: File, metadata: {
  title: string;
  artist: string;
  bpm: number;
  duration: string;
  coverDataUrl?: string | null;
}): Promise<Track> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('title', metadata.title);
  formData.append('artist', metadata.artist);
  formData.append('bpm', String(metadata.bpm));
  formData.append('duration', metadata.duration);
  if (metadata.coverDataUrl) {
    formData.append('cover', metadata.coverDataUrl);
  }

  const { data } = await axiosClient.post<Track>(API_ROUTES.track.upload, formData);
  return data;
}

export async function deleteTrack(id: string): Promise<void> {
  await axiosClient.delete(API_ROUTES.track.remove(id));
}
