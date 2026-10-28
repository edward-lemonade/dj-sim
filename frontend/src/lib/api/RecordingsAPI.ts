import API_ROUTES from '@/config/api';
import { axiosClient } from '@/lib/clients/axios';

export type Recording = {
  id: string;
  title: string;
  contentType: string;
  durationSeconds: number;
  waveformStatus: 'pending' | 'ready' | 'failed';
  createdAt: string;
  updatedAt: string;
};

export type RecordingWaveform = {
  version: 1;
  durationSeconds: number;
  peaks: [number, number][];
};

export const RecordingsAPI = {
  async list(): Promise<Recording[]> {
    const response = await axiosClient.get<Recording[]>(API_ROUTES.recording.list);
    return response.data;
  },

  async upload(blob: Blob, title: string, durationSeconds: number): Promise<Recording> {
    const body = new FormData();
    body.append('file', blob, `${title}.mp3`);
    body.append('title', title);
    body.append('durationSeconds', String(durationSeconds));
    const response = await axiosClient.post<Recording>(API_ROUTES.recording.upload, body);
    return response.data;
  },

  async updateTitle(id: string, title: string): Promise<Recording> {
    const response = await axiosClient.patch<Recording>(API_ROUTES.recording.update(id), { title });
    return response.data;
  },

  async audio(id: string): Promise<Blob> {
    const response = await axiosClient.get<Blob>(API_ROUTES.recording.audio(id), {
      responseType: 'blob',
    });
    return response.data;
  },

  async playbackUrl(id: string): Promise<string> {
    const response = await axiosClient.get<{ url: string }>(API_ROUTES.recording.playbackUrl(id));
    return response.data.url;
  },

  async waveform(id: string): Promise<RecordingWaveform> {
    const response = await axiosClient.get<RecordingWaveform>(API_ROUTES.recording.waveform(id));
    return response.data;
  },

  async retryWaveform(id: string): Promise<void> {
    await axiosClient.post(API_ROUTES.recording.retryWaveform(id));
  },

  async download(id: string): Promise<Blob> {
    const response = await axiosClient.get<Blob>(API_ROUTES.recording.download(id), {
      responseType: 'blob',
    });
    return response.data;
  },

  async remove(id: string): Promise<void> {
    await axiosClient.delete(API_ROUTES.recording.remove(id));
  },
};
