export enum RoomVisibility {
  Public = 'public',
  Private = 'private',
}

export enum RoomTransportCommandType {
  Play = 'play',
  Pause = 'pause',
  Seek = 'seek',
  Sync = 'sync',
}

export enum RoomStatus {
  Active = 'active',
}

export type ListedRoomMember = {
  userId: string;
  username: string;
  avatarUrl: string;
};

export type RoomCursor = {
  userId: string;
  username: string;
  pointer: { x: number; y: number };
};

export type CreatedRoom = {
  id: string;
  code: string;
  visibility: RoomVisibility;
  capacity: number;
  status: RoomStatus;
  createdAt: string;
  eventUrl: string;
  eventTicket: string;
  members?: ListedRoomMember[];
  alreadyMember?: boolean;
};

export type ListedRoom = Pick<CreatedRoom, 
  'id' | 
  'visibility' | 
  'capacity' | 
  'createdAt'
> & {
  members: ListedRoomMember[];
  memberCount: number;
  coverArts: [string | null, string | null];
  userId?: string;
};

export type RoomTrack = {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  key: string;
  coverUrl: string | null;
  ownerId: string;
  ownerUsername: string;
  ownerAvatarUrl: string;
};

export type RoomJoinResult = Pick<CreatedRoom, 'eventUrl' | 'eventTicket'> &
  Required<Pick<CreatedRoom, 'alreadyMember'>> &
  Partial<Pick<CreatedRoom, 'code'>> & {
    room: ListedRoom;
  };

export type RoomLeaveResult = {
  roomClosed: boolean;
};