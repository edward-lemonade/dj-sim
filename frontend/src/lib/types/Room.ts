export type ListedRoomMember = {
  userId: string;
  username: string;
  avatarUrl: string;
};

export type ListedRoom = {
  id: string;
  visibility: 'public' | 'private';
  members: ListedRoomMember[];
  memberCount: number;
  capacity: number;
  createdAt: string;
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

export type CreatedRoom = {
  id: string;
  code: string;
  visibility: 'public' | 'private';
  capacity: number;
  status: 'active';
  createdAt: string;
  eventUrl: string;
  eventTicket: string;
  members?: ListedRoomMember[];
  alreadyMember?: boolean;
};

export type RoomJoinResult = {
  room: ListedRoom;
  alreadyMember: boolean;
  code?: string;
  eventUrl: string;
  eventTicket: string;
};

export type RoomLeaveResult = {
  roomClosed: boolean;
};
