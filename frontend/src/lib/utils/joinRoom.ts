import { ApiError } from '@/lib/clients/axios';
import type { CreatedRoom, RoomJoinResult } from '@/lib/types/Room';

export const PENDING_ROOM_CODE_KEY = 'dj-sim.pendingRoomCode';
export const PENDING_PUBLIC_ROOM_KEY = 'dj-sim.pendingPublicRoomId';

export function normalizeRoomCode(value: string): string {
  return value.trim();
}

export function roomCodeInputError(value: string): string | null {
  const code = normalizeRoomCode(value);
  if (!code) return 'Enter a six-digit room code.';
  if (/\s/.test(code) || !/^\d+$/.test(code)) {
    return 'Room codes are six digits with no spaces or other characters.';
  }
  if (code.length !== 6) return 'Room codes are exactly six digits.';
  return null;
}

export function roomJoinErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 409) return 'Room full';
    if (cause.status === 404) return 'This room is not available.';
    if (cause.status === 400 && typeof cause.message === 'string' && cause.message) {
      return cause.message;
    }
  }
  if (cause instanceof Error && cause.message) return cause.message;
  return 'Could not join this room.';
}

export function createdRoomFromJoin(joined: RoomJoinResult, fallbackCode = ''): CreatedRoom {
  return {
    id: joined.room.id,
    code: joined.code || fallbackCode,
    visibility: joined.room.visibility,
    capacity: joined.room.capacity,
    status: 'active',
    createdAt: joined.room.createdAt,
    eventUrl: joined.eventUrl,
    eventTicket: joined.eventTicket,
    members: joined.room.members,
    alreadyMember: joined.alreadyMember,
  };
}

export function readSessionValue(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

export function writeSessionValue(key: string, value: string): void {
  try {
    if (!value) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Private browsing or disabled storage should not block sign-in.
  }
}

export function safeAuthRedirect(value: string | null | undefined): string {
  if (value === '/community') return '/community';
  return '/';
}
