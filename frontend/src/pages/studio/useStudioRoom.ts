import { useUser } from '@clerk/react';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ENV } from '@/config/env';
import { createRoom, fetchRoomTrackAudioBlob, getRoomLibrary, leaveRoom } from '@/lib/api/RoomsAPI';
import { fetchTrackAudioBlob } from '@/lib/api/TrackAPI';
import {
  RoomTransportCommandType,
  type CreatedRoom,
  type RoomTrack,
  type RoomVisibility,
} from '@/lib/types/Room';
import {
  StreamDeckId,
  type StudioSnapshot,
} from '@/lib/types/Stream';
import {
  reduceStudioSnapshot,
  StudioActionType,
  type StudioAction,
} from '@/pages/stream/studioState';
import type { MixerAudioEngine } from '@/hooks/useAudioEngine';
import type { MixerState } from '@/hooks/useMixerState';

type StudioCommand = StudioAction | { action: StudioActionType.Hydrate; value: StudioSnapshot };

export type RoomTransportCommand = {
  id: string;
  platterRevision?: string;
  command: RoomTransportCommandType;
  playing?: boolean;
  positionSeconds?: number;
  platterAngleDegrees?: number;
  receivedAtMs: number;
};

type RoomTransportCommandPayload = {
  action: 'transport-command';
  deck: StreamDeckId;
  command:
    | RoomTransportCommandType.Play
    | RoomTransportCommandType.Pause
    | RoomTransportCommandType.Seek;
  positionSeconds?: number;
  platterAngleDegrees?: number;
};

type RoomRelayEvent = {
  type?: string;
  payload?: unknown;
  seq?: number;
  userId?: string;
  username?: string;
  avatarUrl?: string;
};

type PendingRoomSocketEvents = {
  messages: MessageEvent[];
  closeEvent: CloseEvent | null;
  onMessage: (event: MessageEvent) => void;
  onClose: (event: CloseEvent) => void;
};

const pendingRoomSocketEvents = new WeakMap<WebSocket, PendingRoomSocketEvents>();

function roomSocketUrl(room: CreatedRoom): string {
  const url = new URL(room.eventUrl, ENV.apiBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('ticket', room.eventTicket);
  return url.toString();
}

function isStudioSnapshot(value: unknown): value is StudioSnapshot {
  return typeof value === 'object' && value !== null && 'decks' in value && 'mixer' in value;
}

function snapshotFromRoomEvent(type: string | undefined, payload: unknown): StudioSnapshot | null {
  if (type === 'snapshot' && isStudioSnapshot(payload)) return payload;
  if (type === 'joined' && typeof payload === 'object' && payload !== null && 'snapshot' in payload) {
    const snapshot = (payload as { snapshot: unknown }).snapshot;
    if (isStudioSnapshot(snapshot)) return snapshot;
  }
  return null;
}

function isStudioAction(value: unknown): value is StudioAction {
  return typeof value === 'object' && value !== null && 'action' in value;
}

function isRoomTransportCommand(value: unknown): value is RoomTransportCommandPayload {
  if (typeof value !== 'object' || value === null || !('action' in value) || !('deck' in value) || !('command' in value)) {
    return false;
  }
  const command = value as Partial<RoomTransportCommandPayload>;
  return command.action === 'transport-command'
    && (command.deck === StreamDeckId.A || command.deck === StreamDeckId.B)
    && (
      command.command === RoomTransportCommandType.Play
      || command.command === RoomTransportCommandType.Pause
      || command.command === RoomTransportCommandType.Seek
    )
    && (command.platterAngleDegrees === undefined || Number.isFinite(command.platterAngleDegrees));
}

function connectRoomRelay(room: CreatedRoom): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(roomSocketUrl(room));
    const buffered: PendingRoomSocketEvents = {
      messages: [],
      closeEvent: null,
      onMessage: (event) => buffered.messages.push(event),
      onClose: (event) => { buffered.closeEvent = event; },
    };
    socket.addEventListener('message', buffered.onMessage);
    socket.addEventListener('close', buffered.onClose);
    pendingRoomSocketEvents.set(socket, buffered);
    const timeout = window.setTimeout(() => {
      socket.close();
      reject(new Error('Timed out connecting to the room event relay.'));
    }, 10000);
    socket.addEventListener('open', () => {
      window.clearTimeout(timeout);
      resolve(socket);
    }, { once: true });
    socket.addEventListener('error', () => {
      window.clearTimeout(timeout);
      reject(new Error('Could not connect to the room event relay.'));
    }, { once: true });
    socket.addEventListener('close', () => {
      window.clearTimeout(timeout);
      reject(new Error('The room event relay closed before connecting.'));
    }, { once: true });
  });
}

export function useStudioRoom({
  studioState,
  dispatchStudio,
  engine,
}: {
  studioState: StudioSnapshot;
  dispatchStudio: (command: StudioCommand) => void;
  engine: MixerAudioEngine | null;
}) {
  const { user } = useUser();
  const location = useLocation();
  const navigate = useNavigate();
  const avatarUrl = user?.imageUrl ?? '';
  const [room, setRoom] = useState<CreatedRoom | null>(null);
  const [roomLibraryState, setRoomLibraryState] = useState<{ roomId: string; tracks: RoomTrack[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transportCommands, setTransportCommands] = useState<Record<StreamDeckId, RoomTransportCommand | null>>({
    [StreamDeckId.A]: null,
    [StreamDeckId.B]: null,
  });
  const roomSocketRef = useRef<WebSocket | null>(null);
  const roomEventsReadyRef = useRef(false);
  const publishRoomSnapshotsRef = useRef(false);
  const endingRoomRef = useRef(false);
  const studioSnapshotRef = useRef(studioState);
  const initialIncomingRoom = (location.state as { roomSession?: CreatedRoom } | null)?.roomSession;
  const incomingRoomRef = useRef(initialIncomingRoom);
  const [incomingRoomPending, setIncomingRoomPending] = useState(Boolean(initialIncomingRoom));
  const roomMemberKey = room?.members?.map((member) => member.userId).sort().join(',') ?? '';
  const roomLibrary = roomLibraryState && roomLibraryState.roomId === room?.id
    ? roomLibraryState.tracks
    : [];

  const commitStudio = useCallback((command: StudioCommand) => {
    if (command.action === StudioActionType.Hydrate) {
      studioSnapshotRef.current = command.value;
    } else {
      studioSnapshotRef.current = reduceStudioSnapshot(studioSnapshotRef.current, command);
    }
    dispatchStudio(command);
    if (command.action === StudioActionType.Hydrate) return;
    const socket = roomSocketRef.current;
    if (!roomEventsReadyRef.current || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      type: 'event',
      t: engine?.context.currentTime ?? 0,
      payload: command,
    }));
  }, [dispatchStudio, engine]);

  const commitMixer = useCallback((update: (current: MixerState) => MixerState) => {
    commitStudio({
      action: StudioActionType.MixerChange,
      value: update(studioSnapshotRef.current.mixer),
    });
  }, [commitStudio]);

  const sendTransportCommand = useCallback((
    deck: StreamDeckId,
    command:
      | RoomTransportCommandType.Play
      | RoomTransportCommandType.Pause
      | RoomTransportCommandType.Seek,
    positionSeconds?: number,
    platterAngleDegrees?: number,
  ) => {
    const socket = roomSocketRef.current;
    if (!room?.id || !roomEventsReadyRef.current || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      type: 'event',
      t: engine?.context.currentTime ?? 0,
      payload: { action: 'transport-command', deck, command, positionSeconds, platterAngleDegrees },
    }));
  }, [engine, room?.id]);

  const roomId = room?.id;
  const loadTrackAudio = useCallback((trackId: string) => (
    roomId ? fetchRoomTrackAudioBlob(roomId, trackId) : fetchTrackAudioBlob(trackId)
  ), [roomId]);

  const attachRoomSession = useCallback(async (nextRoom: CreatedRoom, publishSnapshots: boolean) => {
    const socket = await connectRoomRelay(nextRoom);
    const handleMessage = (message: MessageEvent) => {
      try {
        const event = JSON.parse(String(message.data)) as RoomRelayEvent;
        if (event.type === 'closed') {
          roomSocketRef.current = null;
          roomEventsReadyRef.current = false;
          publishRoomSnapshotsRef.current = false;
          setRoom(null);
          socket.close();
          if (endingRoomRef.current) {
            endingRoomRef.current = false;
          } else {
            navigate('/community', { replace: true, state: { roomClosed: true } });
          }
          return;
        }
        if (event.type === 'error') {
          setError('The room relay rejected an update.');
          return;
        }
        if (event.type === 'joined' || event.type === 'snapshot') {
          const snapshot = snapshotFromRoomEvent(event.type, event.payload);
          if (event.type === 'joined' && typeof event.payload === 'object' && event.payload !== null && 'members' in event.payload) {
            const members = (event.payload as { members?: CreatedRoom['members'] }).members;
            if (members) setRoom((current) => current ? { ...current, members } : current);
          }
          if (snapshot) {
            studioSnapshotRef.current = snapshot;
            dispatchStudio({ action: StudioActionType.Hydrate, value: snapshot });
            if (event.type === 'joined') {
              const commandId = String(event.seq ?? Date.now());
              setTransportCommands({
                [StreamDeckId.A]: {
                  id: `${commandId}:A`, command: RoomTransportCommandType.Sync,
                  playing: snapshot.decks[StreamDeckId.A].playing,
                  positionSeconds: snapshot.decks[StreamDeckId.A].positionSeconds,
                  receivedAtMs: performance.now(),
                },
                [StreamDeckId.B]: {
                  id: `${commandId}:B`, command: RoomTransportCommandType.Sync,
                  playing: snapshot.decks[StreamDeckId.B].playing,
                  positionSeconds: snapshot.decks[StreamDeckId.B].positionSeconds,
                  receivedAtMs: performance.now(),
                },
              });
            } else {
              const receivedAtMs = performance.now();
              setTransportCommands((currentCommands) => ({
                ...currentCommands,
                ...(snapshot.decks[StreamDeckId.A].playing ? {
                  [StreamDeckId.A]: {
                    id: `${event.seq ?? Date.now()}:A`, command: RoomTransportCommandType.Sync, playing: true,
                    positionSeconds: snapshot.decks[StreamDeckId.A].positionSeconds, receivedAtMs,
                    platterRevision: currentCommands[StreamDeckId.A]?.platterRevision,
                    platterAngleDegrees: currentCommands[StreamDeckId.A]?.platterAngleDegrees,
                  },
                } : {}),
                ...(snapshot.decks[StreamDeckId.B].playing ? {
                  [StreamDeckId.B]: {
                    id: `${event.seq ?? Date.now()}:B`, command: RoomTransportCommandType.Sync, playing: true,
                    positionSeconds: snapshot.decks[StreamDeckId.B].positionSeconds, receivedAtMs,
                    platterRevision: currentCommands[StreamDeckId.B]?.platterRevision,
                    platterAngleDegrees: currentCommands[StreamDeckId.B]?.platterAngleDegrees,
                  },
                } : {}),
              }));
            }
          }
          return;
        }
        if (event.type === 'member-joined' && event.userId) {
          const member = { userId: event.userId, username: event.username ?? '', avatarUrl: event.avatarUrl ?? '' };
          setRoom((current) => current ? {
            ...current,
            members: [...(current.members ?? []).filter((existing) => existing.userId !== member.userId), member],
          } : current);
          return;
        }
        if (event.type === 'member-left' && event.userId) {
          setRoom((current) => current ? {
            ...current,
            members: (current.members ?? []).filter((member) => member.userId !== event.userId),
          } : current);
          return;
        }
        if (event.type === 'event' && isRoomTransportCommand(event.payload)) {
          const command = event.payload;
          const current = studioSnapshotRef.current.decks[command.deck];
          const action: StudioAction = {
            action: StudioActionType.Transport,
            deck: command.deck,
            value: {
              ...current,
              playing: command.command === RoomTransportCommandType.Play
                ? true
                : command.command === RoomTransportCommandType.Pause ? false : current.playing,
              positionSeconds: command.command === RoomTransportCommandType.Seek && Number.isFinite(command.positionSeconds)
                ? command.positionSeconds!
                : current.positionSeconds,
            },
          };
          studioSnapshotRef.current = reduceStudioSnapshot(studioSnapshotRef.current, action);
          dispatchStudio(action);
          setTransportCommands((currentCommands) => ({
            ...currentCommands,
            [command.deck]: {
              id: String(event.seq ?? Date.now()),
              platterRevision: command.platterAngleDegrees === undefined
                ? currentCommands[command.deck]?.platterRevision
                : String(event.seq ?? Date.now()),
              command: command.command,
              positionSeconds: command.positionSeconds,
              platterAngleDegrees: command.platterAngleDegrees ?? currentCommands[command.deck]?.platterAngleDegrees,
              receivedAtMs: performance.now(),
            },
          }));
          return;
        }
        if (event.type === 'event' && isStudioAction(event.payload)) {
          studioSnapshotRef.current = reduceStudioSnapshot(studioSnapshotRef.current, event.payload);
          dispatchStudio(event.payload);
        }
      } catch {
        setError('The room relay returned an unreadable message.');
      }
    };
    const handleClose = () => {
      if (roomSocketRef.current === socket) {
        roomSocketRef.current = null;
        roomEventsReadyRef.current = false;
        publishRoomSnapshotsRef.current = false;
        setError('Room connection lost. The last shared state is still playing locally.');
      }
    };
    const buffered = pendingRoomSocketEvents.get(socket);
    if (buffered) {
      socket.removeEventListener('message', buffered.onMessage);
      socket.removeEventListener('close', buffered.onClose);
    }
    socket.addEventListener('message', handleMessage);
    socket.addEventListener('close', handleClose);
    roomSocketRef.current = socket;
    roomEventsReadyRef.current = true;
    publishRoomSnapshotsRef.current = publishSnapshots;
    setRoom(nextRoom);
    pendingRoomSocketEvents.delete(socket);
    for (const message of buffered?.messages ?? []) handleMessage(message);
    if (buffered?.closeEvent) handleClose();
    if (publishSnapshots) {
      socket.send(JSON.stringify({
        type: 'snapshot',
        t: engine?.context.currentTime ?? 0,
        payload: { ...studioSnapshotRef.current, pointer: null },
      }));
    }
  }, [dispatchStudio, engine, navigate]);

  const startRoom = useCallback(async (visibility: RoomVisibility) => {
    setBusy(true);
    setError(null);
    endingRoomRef.current = false;
    let created: CreatedRoom | null = null;
    try {
      created = await createRoom(visibility, avatarUrl);
      await attachRoomSession({
        ...created,
        members: user
          ? [{ userId: user.id, username: user.username ?? user.fullName ?? 'You', avatarUrl }]
          : created.members,
      }, true);
    } catch (cause) {
      let message = cause instanceof Error ? cause.message : 'Could not create a collaborative room.';
      if (created) {
        try {
          await leaveRoom(created.id);
        } catch (cleanupCause) {
          const cleanupMessage = cleanupCause instanceof Error ? cleanupCause.message : 'room cleanup failed';
          message = `${message} The room could not be closed: ${cleanupMessage}`;
        }
      }
      setError(message);
      throw cause;
    } finally {
      setBusy(false);
    }
  }, [attachRoomSession, avatarUrl, user]);

  useEffect(() => {
    const incoming = incomingRoomRef.current;
    incomingRoomRef.current = undefined;
    if (!incoming) return;
    navigate('/studio', { replace: true, state: null });
    setBusy(true);
    setError(null);
    endingRoomRef.current = false;
    void attachRoomSession(incoming, false).catch(async (cause: unknown) => {
      let message = cause instanceof Error ? cause.message : 'Could not connect to the room.';
      if (!incoming.alreadyMember) {
        try {
          await leaveRoom(incoming.id);
        } catch (cleanupCause) {
          const cleanupMessage = cleanupCause instanceof Error ? cleanupCause.message : 'room cleanup failed';
          message = `${message} The room could not be left: ${cleanupMessage}`;
        }
      }
      setError(message);
    }).finally(() => {
      setBusy(false);
      setIncomingRoomPending(false);
    });
  }, [attachRoomSession, navigate]);

  const endRoom = useCallback(async () => {
    if (!room) return;
    endingRoomRef.current = true;
    setError(null);
    try {
      await Promise.race([
        leaveRoom(room.id),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('End room timed out')), 5000)),
      ]);
      publishRoomSnapshotsRef.current = false;
      roomSocketRef.current?.close();
      roomSocketRef.current = null;
      setRoom(null);
    } catch (cause) {
      endingRoomRef.current = false;
      setError(cause instanceof Error ? cause.message : 'Could not end the room.');
      publishRoomSnapshotsRef.current = false;
      roomSocketRef.current?.close();
      roomSocketRef.current = null;
      setRoom(null);
    }
  }, [room]);

  useEffect(() => {
    const roomId = room?.id;
    if (!roomId) return;
    let active = true;
    void getRoomLibrary(roomId).then((tracks) => {
      if (active) setRoomLibraryState({ roomId, tracks });
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load the room library.');
    });
    return () => { active = false; };
  }, [room?.id, roomMemberKey]);

  useEffect(() => {
    studioSnapshotRef.current = studioState;
  }, [studioState]);

  const cleanupRoomSession = useEffectEvent(() => {
    if (room) {
      leaveRoom(room.id).catch((cause: unknown) => {
        console.error('Failed to leave room on beforeunload', cause);
      });
    }
  });

  useEffect(() => {
    const handleBeforeUnload = () => cleanupRoomSession();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      cleanupRoomSession();
    };
  }, []);

  useEffect(() => {
    if (!room) return;
    const interval = window.setInterval(() => {
      const socket = roomSocketRef.current;
      if (!publishRoomSnapshotsRef.current || socket?.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({
        type: 'snapshot',
        t: engine?.context.currentTime ?? 0,
        payload: { ...studioSnapshotRef.current, pointer: null },
      }));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [engine, room]);

  useEffect(() => () => {
    roomSocketRef.current?.close();
    roomSocketRef.current = null;
  }, []);

  return {
    room,
    roomLibrary,
    avatarUrl,
    currentUserId: user?.id,
    busy,
    error,
    transportCommands,
    commitStudio,
    commitMixer,
    sendTransportCommand,
    loadTrackAudio,
    startRoom,
    endRoom,
    hasIncomingRoom: incomingRoomPending,
  };
}
