import API_ROUTES from '@/config/api';
import { axiosClient } from '@/lib/clients/axios';
import type { CreatedRoom, ListedRoom, RoomJoinResult, RoomLeaveResult, RoomTrack } from '@/lib/types/Room';

export async function listRooms(): Promise<ListedRoom[]> {
  const { data } = await axiosClient.get<ListedRoom[]>(API_ROUTES.room.list);
  return data ?? [];
}

export async function getRoom(roomId: string): Promise<ListedRoom> {
  const { data } = await axiosClient.get<ListedRoom>(API_ROUTES.room.get(roomId));
  return data;
}

export async function getRoomLibrary(roomId: string): Promise<RoomTrack[]> {
  const { data } = await axiosClient.get<RoomTrack[]>(API_ROUTES.room.get(roomId) + '/library');
  return data ?? [];
}

export async function createRoom(
  visibility: 'public' | 'private',
  avatarUrl: string,
): Promise<CreatedRoom> {
  const { data } = await axiosClient.post<CreatedRoom>(API_ROUTES.room.create, { visibility, avatarUrl });
  return data;
}

export async function joinRoomByCode(code: string, avatarUrl: string): Promise<RoomJoinResult> {
  const { data } = await axiosClient.post<RoomJoinResult>(API_ROUTES.room.joinByCode, { code, avatarUrl });
  return data;
}

export async function joinPublicRoom(roomId: string, avatarUrl: string): Promise<RoomJoinResult> {
  const { data } = await axiosClient.post<RoomJoinResult>(API_ROUTES.room.join(roomId), { avatarUrl });
  return data;
}

export async function leaveRoom(roomId: string): Promise<RoomLeaveResult> {
  const { data } = await axiosClient.post<RoomLeaveResult>(API_ROUTES.room.leave(roomId));
  return data;
}
