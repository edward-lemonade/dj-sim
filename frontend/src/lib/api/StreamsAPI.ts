import API_ROUTES from '@/config/api';
import { axiosClient } from '@/lib/clients/axios';
import type { ListedStream, StreamConnection } from '@/lib/types/Stream';

export async function listStreams(): Promise<ListedStream[]> {
  const { data } = await axiosClient.get<ListedStream[]>(API_ROUTES.stream.list);
  return data ?? [];
}

export async function createStream(name: string, avatarUrl: string, roomId?: string): Promise<StreamConnection> {
  const { data } = await axiosClient.post<StreamConnection>(API_ROUTES.stream.create, { name, avatarUrl, roomId });
  return data;
}

export async function joinStream(id: string): Promise<StreamConnection> {
  const { data } = await axiosClient.post<StreamConnection>(API_ROUTES.stream.join(id));
  return data;
}

export async function endStream(id: string): Promise<void> {
  await axiosClient.post(API_ROUTES.stream.end(id));
}
