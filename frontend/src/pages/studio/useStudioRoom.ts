import { useUser } from '@clerk/react';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ENV } from '@/config/env';
import { createRoom, fetchRoomTrackAudioBlob, getRoomLibrary, leaveRoom } from '@/lib/api/RoomsAPI';
import { fetchTrackAudioBlob } from '@/lib/api/TrackAPI';
import {
  RoomTransportCommandType,
  type CreatedRoom,
  type RoomCursor,
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
import { DeckId as AudioDeckId, type MixerAudioEngine } from '@/hooks/useAudioEngine';
import type { MixerState } from '@/hooks/useMixerState';
import { ControlId, type ControlLease, type ControlReleaseReason } from '@/lib/types/Control';

type StudioCommand = StudioAction | { action: StudioActionType.Hydrate; value: StudioSnapshot };
type MixerChangeAction = Extract<StudioAction, { action: StudioActionType.MixerChange }>;

const ROOM_MIXER_UPDATE_INTERVAL_MS = 33;
const ROOM_POINTER_UPDATE_INTERVAL_MS = 1000 / 30;

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

function parseRoomLeases(value: unknown): ControlLease[] {
  if (!Array.isArray(value)) return [];
  const knownControlIds = new Set<string>(Object.values(ControlId));
  return value.flatMap((entry): ControlLease[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const lease = entry as Partial<ControlLease> & { expiresAt?: number | string };
    const expiresAt = typeof lease.expiresAt === 'number'
      ? lease.expiresAt
      : typeof lease.expiresAt === 'string' ? Date.parse(lease.expiresAt) : NaN;
    if (
      typeof lease.controlId !== 'string'
      || !knownControlIds.has(lease.controlId)
      || typeof lease.ownerId !== 'string'
      || typeof lease.ownerUsername !== 'string'
      || !Number.isFinite(expiresAt)
    ) return [];
    return [{
      controlId: lease.controlId as ControlId,
      ownerId: lease.ownerId,
      ownerUsername: lease.ownerUsername,
      expiresAt,
    }];
  });
}

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

function mergeMixerControl(current: MixerState, incoming: MixerState, controlId: ControlId): MixerState {
  const channelValue = (deck: AudioDeckId, field: keyof MixerState['channelState'][AudioDeckId.A]) => ({
    ...current,
    channelState: {
      ...current.channelState,
      [deck]: { ...current.channelState[deck], [field]: incoming.channelState[deck][field] },
    },
  });

  switch (controlId) {
    case ControlId.MasterVolume:
      return { ...current, master: incoming.master };
    case ControlId.ChannelAGain:
      return channelValue(AudioDeckId.A, 'volume');
    case ControlId.ChannelAEqHigh:
      return channelValue(AudioDeckId.A, 'high');
    case ControlId.ChannelAEqMid:
      return channelValue(AudioDeckId.A, 'mid');
    case ControlId.ChannelAEqLow:
      return channelValue(AudioDeckId.A, 'low');
    case ControlId.ChannelAFilter:
      return channelValue(AudioDeckId.A, 'filter');
    case ControlId.DeckATempo:
      return channelValue(AudioDeckId.A, 'tempo');
    case ControlId.ChannelBGain:
      return channelValue(AudioDeckId.B, 'volume');
    case ControlId.ChannelBEqHigh:
      return channelValue(AudioDeckId.B, 'high');
    case ControlId.ChannelBEqMid:
      return channelValue(AudioDeckId.B, 'mid');
    case ControlId.ChannelBEqLow:
      return channelValue(AudioDeckId.B, 'low');
    case ControlId.ChannelBFilter:
      return channelValue(AudioDeckId.B, 'filter');
    case ControlId.DeckBTempo:
      return channelValue(AudioDeckId.B, 'tempo');
    case ControlId.FxWet:
      return { ...current, fx: { ...current.fx, wet: incoming.fx.wet } };
    case ControlId.FxDivision:
      return { ...current, fx: { ...current.fx, division: incoming.fx.division } };
    case ControlId.FxType:
      return { ...current, fx: { ...current.fx, type: incoming.fx.type } };
    case ControlId.FxAssignA:
      return { ...current, fx: { ...current.fx, assign: { ...current.fx.assign, [AudioDeckId.A]: incoming.fx.assign[AudioDeckId.A] } } };
    case ControlId.FxAssignB:
      return { ...current, fx: { ...current.fx, assign: { ...current.fx.assign, [AudioDeckId.B]: incoming.fx.assign[AudioDeckId.B] } } };
    case ControlId.TempoMaster:
      return { ...current, tempoMaster: incoming.tempoMaster };
    case ControlId.DeckAPlatter:
    case ControlId.DeckBPlatter:
      return current;
  }
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
  const username = user?.username ?? user?.firstName ?? 'DJ';
  const [room, setRoom] = useState<CreatedRoom | null>(null);
  const [roomUserId, setRoomUserId] = useState<string | null>(null);
  const [roomLibraryState, setRoomLibraryState] = useState<{ roomId: string; tracks: RoomTrack[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leases, setLeases] = useState<ControlLease[]>([]);
  const [roomCursors, setRoomCursors] = useState<Record<string, RoomCursor>>({});
  const [transportCommands, setTransportCommands] = useState<Record<StreamDeckId, RoomTransportCommand | null>>({
    [StreamDeckId.A]: null,
    [StreamDeckId.B]: null,
  });
  const roomSocketRef = useRef<WebSocket | null>(null);
  const roomEventsReadyRef = useRef(false);
  const publishRoomSnapshotsRef = useRef(false);
  const endingRoomRef = useRef(false);
  const studioSnapshotRef = useRef(studioState);
  const pendingMixerEventsRef = useRef<Map<ControlId, MixerChangeAction>>(new Map());
  const mixerEventTimerRef = useRef<number | null>(null);
  const pointerEventTimerRef = useRef<number | null>(null);
  const pendingPointerRef = useRef<{ x: number; y: number } | null>(null);
  const lastPointerSentAtRef = useRef(0);
  const initialIncomingRoom = (location.state as { roomSession?: CreatedRoom } | null)?.roomSession;
  const incomingRoomRef = useRef(initialIncomingRoom);
  const [incomingRoomPending, setIncomingRoomPending] = useState(Boolean(initialIncomingRoom));
  const roomMemberKey = room?.members?.map((member) => member.userId).sort().join(',') ?? '';
  const roomLibrary = roomLibraryState && roomLibraryState.roomId === room?.id
    ? roomLibraryState.tracks
    : [];

  const commitStudioLocal = useCallback((command: StudioCommand) => {
    if (command.action === StudioActionType.Hydrate) {
      studioSnapshotRef.current = command.value;
    } else {
      studioSnapshotRef.current = reduceStudioSnapshot(studioSnapshotRef.current, command);
    }
    dispatchStudio(command);
  }, [dispatchStudio]);

  const commitStudio = useCallback((command: StudioCommand) => {
    commitStudioLocal(command);
    if (command.action === StudioActionType.Hydrate) return;
    const socket = roomSocketRef.current;
    if (!roomEventsReadyRef.current || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      type: 'event',
      t: engine?.context.currentTime ?? 0,
      payload: command,
    }));
  }, [commitStudioLocal, engine]);

  const flushMixerEvents = useCallback(() => {
    if (mixerEventTimerRef.current !== null) {
      window.clearTimeout(mixerEventTimerRef.current);
      mixerEventTimerRef.current = null;
    }
    const pending = [...pendingMixerEventsRef.current.values()];
    pendingMixerEventsRef.current.clear();
    const socket = roomSocketRef.current;
    if (!roomEventsReadyRef.current || !socket || socket.readyState !== WebSocket.OPEN) return;
    pending.forEach((command) => {
      socket.send(JSON.stringify({
        type: 'event',
        t: engine?.context.currentTime ?? 0,
        payload: command,
      }));
    });
  }, [engine]);

  const commitMixer = useCallback((controlId: ControlId, update: (current: MixerState) => MixerState) => {
    const command: MixerChangeAction = {
      action: StudioActionType.MixerChange,
      value: update(studioSnapshotRef.current.mixer),
      controlId,
    };
    commitStudioLocal(command);
    const socket = roomSocketRef.current;
    if (!roomEventsReadyRef.current || !socket || socket.readyState !== WebSocket.OPEN) return;
    pendingMixerEventsRef.current.set(controlId, command);
    if (mixerEventTimerRef.current === null) {
      mixerEventTimerRef.current = window.setTimeout(flushMixerEvents, ROOM_MIXER_UPDATE_INTERVAL_MS);
    }
  }, [commitStudioLocal, flushMixerEvents]);

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
      payload: {
        action: 'transport-command',
        deck,
        command,
        positionSeconds,
        platterAngleDegrees,
        ...(platterAngleDegrees === undefined
          ? {}
          : { controlId: deck === StreamDeckId.A ? ControlId.DeckAPlatter : ControlId.DeckBPlatter }),
      },
    }));
  }, [engine, room?.id]);

  const sendControlLeaseEvent = useCallback((event: {
    type: string;
    controlId: ControlId;
    reason?: ControlReleaseReason;
  }) => {
    if (event.type === 'control-release' || event.type === 'control-cancel') {
      flushMixerEvents();
    }
    const socket = roomSocketRef.current;
    if (!room?.id || !roomEventsReadyRef.current || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      type: event.type,
      t: engine?.context.currentTime ?? 0,
      payload: { controlId: event.controlId, ...(event.reason ? { reason: event.reason } : {}) },
    }));
  }, [engine, flushMixerEvents, room?.id]);

  const flushRoomPointer = useCallback(() => {
    pointerEventTimerRef.current = null;
    const socket = roomSocketRef.current;
    if (!roomEventsReadyRef.current || !socket || socket.readyState !== WebSocket.OPEN) {
      pendingPointerRef.current = null;
      return;
    }
    socket.send(JSON.stringify({
      type: 'pointer',
      t: engine?.context.currentTime ?? 0,
      payload: pendingPointerRef.current,
    }));
    pendingPointerRef.current = null;
    lastPointerSentAtRef.current = performance.now();
  }, [engine]);

  const sendRoomPointer = useCallback((pointer: { x: number; y: number } | null) => {
    if (!room?.id) return;
    pendingPointerRef.current = pointer;
    if (pointerEventTimerRef.current !== null) return;
    const delay = Math.max(
      0,
      ROOM_POINTER_UPDATE_INTERVAL_MS - (performance.now() - lastPointerSentAtRef.current),
    );
    pointerEventTimerRef.current = window.setTimeout(flushRoomPointer, delay);
  }, [flushRoomPointer, room?.id]);

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
          pendingPointerRef.current = null;
          if (pointerEventTimerRef.current !== null) window.clearTimeout(pointerEventTimerRef.current);
          pointerEventTimerRef.current = null;
          setRoom(null);
          setRoomUserId(null);
          setLeases([]);
          setRoomCursors({});
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
          if (event.type === 'joined' && typeof event.payload === 'object' && event.payload !== null && 'leases' in event.payload) {
            setLeases(parseRoomLeases(event.payload.leases));
          }
          if (event.type === 'joined' && typeof event.payload === 'object' && event.payload !== null && 'userId' in event.payload) {
            const userId = (event.payload as { userId?: unknown }).userId;
            if (typeof userId === 'string' && userId.length > 0) setRoomUserId(userId);
          }
          if (event.type === 'joined' && typeof event.payload === 'object' && event.payload !== null && 'members' in event.payload) {
            const members = (event.payload as { members?: CreatedRoom['members'] }).members;
            if (members) setRoom((current) => current ? { ...current, members } : current);
          }
          if (snapshot) {
            const localSnapshot = { ...snapshot, pointer: studioSnapshotRef.current.pointer };
            studioSnapshotRef.current = localSnapshot;
            dispatchStudio({ action: StudioActionType.Hydrate, value: localSnapshot });
            if (event.type === 'joined') {
              const commandId = String(event.seq ?? Date.now());
              setTransportCommands({
                [StreamDeckId.A]: {
                  id: `${commandId}:A`, command: RoomTransportCommandType.Sync,
                  playing: localSnapshot.decks[StreamDeckId.A].playing,
                  positionSeconds: localSnapshot.decks[StreamDeckId.A].positionSeconds,
                  receivedAtMs: performance.now(),
                },
                [StreamDeckId.B]: {
                  id: `${commandId}:B`, command: RoomTransportCommandType.Sync,
                  playing: localSnapshot.decks[StreamDeckId.B].playing,
                  positionSeconds: localSnapshot.decks[StreamDeckId.B].positionSeconds,
                  receivedAtMs: performance.now(),
                },
              });
            } else {
              const receivedAtMs = performance.now();
              setTransportCommands((currentCommands) => ({
                ...currentCommands,
                ...(localSnapshot.decks[StreamDeckId.A].playing ? {
                  [StreamDeckId.A]: {
                    id: `${event.seq ?? Date.now()}:A`, command: RoomTransportCommandType.Sync, playing: true,
                    positionSeconds: localSnapshot.decks[StreamDeckId.A].positionSeconds, receivedAtMs,
                    platterRevision: currentCommands[StreamDeckId.A]?.platterRevision,
                    platterAngleDegrees: currentCommands[StreamDeckId.A]?.platterAngleDegrees,
                  },
                } : {}),
                ...(localSnapshot.decks[StreamDeckId.B].playing ? {
                  [StreamDeckId.B]: {
                    id: `${event.seq ?? Date.now()}:B`, command: RoomTransportCommandType.Sync, playing: true,
                    positionSeconds: localSnapshot.decks[StreamDeckId.B].positionSeconds, receivedAtMs,
                    platterRevision: currentCommands[StreamDeckId.B]?.platterRevision,
                    platterAngleDegrees: currentCommands[StreamDeckId.B]?.platterAngleDegrees,
                  },
                } : {}),
              }));
            }
          }
          return;
        }
        if (event.type === 'leases') {
          setLeases(parseRoomLeases(event.payload));
          return;
        }
        if (event.type === 'pointer' && event.userId) {
          const pointer = event.payload as { x: number; y: number } | null;
          setRoomCursors((currentCursors) => {
            if (pointer === null) {
              if (!(event.userId! in currentCursors)) return currentCursors;
              const nextCursors = { ...currentCursors };
              delete nextCursors[event.userId!];
              return nextCursors;
            }
            return {
              ...currentCursors,
              [event.userId!]: {
                userId: event.userId!,
                username: event.username ?? '',
                pointer,
              },
            };
          });
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
          setRoomCursors((currentCursors) => {
            if (!(event.userId! in currentCursors)) return currentCursors;
            const nextCursors = { ...currentCursors };
            delete nextCursors[event.userId!];
            return nextCursors;
          });
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
          const action = event.payload.action === StudioActionType.MixerChange && event.payload.controlId
            ? {
              ...event.payload,
              value: mergeMixerControl(studioSnapshotRef.current.mixer, event.payload.value, event.payload.controlId),
            }
            : event.payload;
          studioSnapshotRef.current = reduceStudioSnapshot(studioSnapshotRef.current, action);
          dispatchStudio(action);
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
        setRoomCursors({});
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
    setRoomCursors({});
    setRoom(nextRoom);
    setRoomUserId(null);
    setLeases([]);
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
      await attachRoomSession(created, true);
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
  }, [attachRoomSession, avatarUrl]);

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
      roomEventsReadyRef.current = false;
      setRoom(null);
      setRoomUserId(null);
      setLeases([]);
      setRoomCursors({});
    } catch (cause) {
      endingRoomRef.current = false;
      setError(cause instanceof Error ? cause.message : 'Could not end the room.');
      publishRoomSnapshotsRef.current = false;
      roomSocketRef.current?.close();
      roomSocketRef.current = null;
      roomEventsReadyRef.current = false;
      setRoom(null);
      setRoomUserId(null);
      setLeases([]);
      setRoomCursors({});
    }
    pendingPointerRef.current = null;
    if (pointerEventTimerRef.current !== null) window.clearTimeout(pointerEventTimerRef.current);
    pointerEventTimerRef.current = null;
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
        payload: studioSnapshotRef.current,
      }));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [engine, room]);

  useEffect(() => () => {
    roomSocketRef.current?.close();
    roomSocketRef.current = null;
    if (pointerEventTimerRef.current !== null) window.clearTimeout(pointerEventTimerRef.current);
  }, []);

  return {
    room,
    roomLibrary,
    leases,
    roomCursors: Object.values(roomCursors),
    avatarUrl,
    currentUserId: roomUserId,
    currentUsername: username,
    busy,
    error,
    transportCommands,
    commitStudioLocal,
    commitStudio,
    commitMixer,
    sendTransportCommand,
    sendControlLeaseEvent,
    sendRoomPointer,
    loadTrackAudio,
    startRoom,
    endRoom,
    hasIncomingRoom: incomingRoomPending,
  };
}
