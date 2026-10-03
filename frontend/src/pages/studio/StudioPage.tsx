import { useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { CDJ } from '../../components/CDJ';
import { Mixer } from '@/components/Mixer';
import type { MixerState } from '@/hooks/useMixerState';
import { StudioTopbar } from '@/components/StudioTopbar';
import { StudioConsoleLayout } from '@/components/StudioConsoleLayout';
import { getStudioDeckLayout } from '@/lib/utils/studioGrid';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { clamp, DECK_IDS, DeckId } from '../../hooks/useAudioEngine';
import { useTrackLibrary } from '@/hooks/useTrackLibrary';
import { MAX_PLAYER_ZOOM, MIN_PLAYER_ZOOM } from '@/hooks/useTrackPlayer';
import type { Track } from '@/lib/types/Track';
import { normalizeCues } from '@/lib/types/Cues';
import { StreamDeckId, StreamPopupKind, type StreamDeckSnapshot, type StudioSnapshot } from '@/lib/types/Stream';
import type { CreatedRoom, RoomTrack } from '@/lib/types/Room';
import { ENV } from '@/config/env';
import { createRoom, fetchRoomTrackAudioBlob, getRoomLibrary, leaveRoom } from '@/lib/api/RoomsAPI';
import { fetchTrackAudioBlob } from '@/lib/api/TrackAPI';
import { ControlSelectionProvider } from '@/components/ControlSelection';
import { useStudioRecording } from '../../hooks/useStudioRecording';
import { useToast } from '@/components/ui/toast';
import { createStream } from '@/lib/api/StreamsAPI';
import { useStreamPublisher } from '@/pages/stream/useStreamConnection';
import {
  createInitialStudioSnapshot,
  reduceStudioSnapshot,
  StudioActionType,
  type StudioAction,
} from '@/pages/stream/studioState';

// Matches the tempo slider's range in CDJ
const TEMPO_RANGE_PERCENT = 50;
const ABSOLUTE_MIN_BEATS_PER_VIEW = 0.01;
const ABSOLUTE_MAX_BEATS_PER_VIEW = 65536;

function parseTrackDuration(value: string): number {
  const parts = value.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

const MAX_STREAM_COVER_URL_LENGTH = 48 * 1024;
const STREAM_COVER_SIZE = 192;
const streamCoverThumbnails = new Map<string, Promise<string | null>>();

function roomSocketUrl(room: CreatedRoom): string {
  const url = new URL(room.eventUrl, ENV.apiBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('ticket', room.eventTicket);
  return url.toString();
}

type StudioCommand = StudioAction | { action: 'hydrate'; value: StudioSnapshot };
type RoomTransportCommand = {
  id: string;
  platterRevision?: string;
  command: 'play' | 'pause' | 'seek' | 'sync';
  playing?: boolean;
  positionSeconds?: number;
  platterAngleDegrees?: number;
  receivedAtMs: number;
};
type RoomTransportCommandPayload = {
  action: 'transport-command';
  deck: StreamDeckId;
  command: 'play' | 'pause' | 'seek';
  positionSeconds?: number;
  platterAngleDegrees?: number;
};

function reduceStudio(state: StudioSnapshot, command: StudioCommand): StudioSnapshot {
  if (command.action === 'hydrate') return command.value;
  return reduceStudioSnapshot(state, command);
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
    && (command.command === 'play' || command.command === 'pause' || command.command === 'seek')
    && (command.platterAngleDegrees === undefined || Number.isFinite(command.platterAngleDegrees));
}

function connectRoomRelay(room: CreatedRoom): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(roomSocketUrl(room));
    const buffered = {
      messages: [] as MessageEvent[],
      closeEvent: null as CloseEvent | null,
      onMessage: (event: MessageEvent) => buffered.messages.push(event),
      onClose: (event: CloseEvent) => { buffered.closeEvent = event; },
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

const pendingRoomSocketEvents = new WeakMap<WebSocket, {
  messages: MessageEvent[];
  closeEvent: CloseEvent | null;
  onMessage: (event: MessageEvent) => void;
  onClose: (event: CloseEvent) => void;
}>();

function toStreamCoverUrl(value: string | null): Promise<string | null> {
  if (!value) return Promise.resolve(null);
  const cached = streamCoverThumbnails.get(value);
  if (cached) return cached;

  const thumbnail = createStreamCoverThumbnail(value);
  streamCoverThumbnails.set(value, thumbnail);
  return thumbnail;
}

async function createStreamCoverThumbnail(value: string): Promise<string | null> {
  if (!value.startsWith('data:image/')) {
    if (value.length > MAX_STREAM_COVER_URL_LENGTH) return null;
    return isSafeStreamImageUrl(value) ? value : null;
  }
  if (!/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;

  try {
    const image = await createImageBitmap(await (await fetch(value)).blob());
    const canvas = document.createElement('canvas');
    canvas.width = STREAM_COVER_SIZE;
    canvas.height = STREAM_COVER_SIZE;
    const context = canvas.getContext('2d');
    if (!context) return null;

    const scale = Math.min(STREAM_COVER_SIZE / image.width, STREAM_COVER_SIZE / image.height);
    const width = Math.round(image.width * scale);
    const height = Math.round(image.height * scale);
    context.drawImage(image, (STREAM_COVER_SIZE - width) / 2, (STREAM_COVER_SIZE - height) / 2, width, height);
    image.close();

    let quality = 0.78;
    let thumbnail = canvas.toDataURL('image/jpeg', quality);
    while (thumbnail.length > MAX_STREAM_COVER_URL_LENGTH && quality > 0.35) {
      quality -= 0.1;
      thumbnail = canvas.toDataURL('image/jpeg', quality);
    }
    return thumbnail.length <= MAX_STREAM_COVER_URL_LENGTH ? thumbnail : null;
  } catch (cause) {
    console.warn('Could not prepare track cover for streaming', cause);
    return null;
  }
}

function isSafeStreamImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

async function toStreamTrack(track: Track): Promise<StreamDeckSnapshot['track']> {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    bpm: track.bpm,
    beatOffset: track.beatOffset,
    key: track.key,
    durationSeconds: parseTrackDuration(track.duration),
    cues: [...(track.cues ?? [])],
    waveformOverview: track.waveformOverview,
    coverUrl: await toStreamCoverUrl(track.coverUrl),
  };
}

function trackFromSnapshot(track: StreamDeckSnapshot['track']): Track | null {
  if (!track) return null;
  const duration = Math.max(0, Math.floor(track.durationSeconds));
  return {
    ...track,
    duration: `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`,
    coverLabel: '',
    libraryStatus: 'ready',
  };
}

function trackFromRoomLibrary(track: RoomTrack): Track {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    bpm: track.bpm,
    beatOffset: 0,
    key: track.key,
    waveformOverview: null,
    cues: normalizeCues(null),
    duration: '0:00',
    coverLabel: '',
    coverUrl: track.coverUrl,
    libraryStatus: 'ready',
  };
}

function StudioPage() {
  const { showToast } = useToast();
  const { user } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const library = useTrackLibrary();
  const [studioState, dispatchStudio] = useReducer(
    reduceStudio,
    undefined,
    createInitialStudioSnapshot,
  );
  const engine = useAudioEngine(studioState.mixer);
  const recording = useStudioRecording(engine);
  const { status: recordingStatus, hasPendingSave, stopAndSave } = recording;
  const shouldBlockExit = recordingStatus === 'recording' || (recordingStatus === 'error' && hasPendingSave);
  const navigationBlocker = useBlocker(shouldBlockExit);
  const autoSaveNavigation = useRef(false);
  const loadedTrackIds = useMemo<Record<DeckId, string | null>>(() => ({
    [DeckId.A]: studioState.decks.A.track?.id ?? null,
    [DeckId.B]: studioState.decks.B.track?.id ?? null,
  }), [studioState.decks]);
  const [deckBeatCounts, setDeckBeatCounts] = useState<Record<DeckId, number | null>>({
    [DeckId.A]: null,
    [DeckId.B]: null,
  });
  const [streamStartError, setStreamStartError] = useState<string | null>(null);
  const [collabRoom, setCollabRoom] = useState<CreatedRoom | null>(null);
  const [roomLibraryState, setRoomLibraryState] = useState<{ roomId: string; tracks: RoomTrack[] } | null>(null);
  const [collabBusy, setCollabBusy] = useState(false);
  const [collabError, setCollabError] = useState<string | null>(null);
  const roomMemberKey = collabRoom?.members?.map((member) => member.userId).sort().join(',') ?? '';
  const roomLibrary = roomLibraryState && roomLibraryState.roomId === collabRoom?.id
    ? roomLibraryState.tracks
    : [];
  const roomSocketRef = useRef<WebSocket | null>(null);
  const roomEventsReadyRef = useRef(false);
  const publishRoomSnapshotsRef = useRef(false);
  const [roomTransportCommands, setRoomTransportCommands] = useState<Record<StreamDeckId, RoomTransportCommand | null>>({
    [StreamDeckId.A]: null,
    [StreamDeckId.B]: null,
  });
  const incomingRoomRef = useRef((location.state as { roomSession?: CreatedRoom } | null)?.roomSession);
  const applyingRemoteRef = useRef(false);
  const studioSnapshotRef = useRef(studioState);
  const commitStudio = useCallback((command: StudioCommand) => {
    if (command.action === 'hydrate') {
      studioSnapshotRef.current = command.value;
    } else {
      studioSnapshotRef.current = reduceStudioSnapshot(studioSnapshotRef.current, command);
    }
    dispatchStudio(command);
    if (command.action === 'hydrate' || applyingRemoteRef.current) return;
    const socket = roomSocketRef.current;
    if (!roomEventsReadyRef.current || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      type: 'event',
      t: engine?.context.currentTime ?? 0,
      payload: command,
    }));
  }, [engine]);
  const lastPointerUpdate = useRef(0);
  const setChannel = useCallback((id: DeckId, patch: Partial<MixerState['channelState'][DeckId.A]>) => {
    const current = studioSnapshotRef.current.mixer;
    commitStudio({
      action: StudioActionType.MixerChange,
      value: {
        ...current,
        channelState: { ...current.channelState, [id]: { ...current.channelState[id], ...patch } },
      },
    });
  }, [commitStudio]);
  const setFx = useCallback((patch: Partial<MixerState['fx']>) => {
    const current = studioSnapshotRef.current.mixer;
    commitStudio({ action: StudioActionType.MixerChange, value: { ...current, fx: { ...current.fx, ...patch } } });
  }, [commitStudio]);
  const setMaster = useCallback((value: number) => {
    const current = studioSnapshotRef.current.mixer;
    commitStudio({ action: StudioActionType.MixerChange, value: { ...current, master: value } });
  }, [commitStudio]);
  const setTempoMaster = useCallback((id: DeckId | null) => {
    const current = studioSnapshotRef.current.mixer;
    commitStudio({ action: StudioActionType.MixerChange, value: { ...current, tempoMaster: id } });
  }, [commitStudio]);

  const loadedBeatCounts = DECK_IDS
    .map((id) => deckBeatCounts[id])
    .filter((count): count is number => count !== null);
  const minBeatsPerView = loadedBeatCounts.length
    ? Math.max(ABSOLUTE_MIN_BEATS_PER_VIEW, Math.max(...loadedBeatCounts) / MAX_PLAYER_ZOOM)
    : ABSOLUTE_MIN_BEATS_PER_VIEW;
  const maxBeatsPerView = loadedBeatCounts.length
    ? Math.min(ABSOLUTE_MAX_BEATS_PER_VIEW, Math.min(...loadedBeatCounts) / MIN_PLAYER_ZOOM)
    : ABSOLUTE_MAX_BEATS_PER_VIEW;

  const reportDeckBeatCount = useCallback((id: DeckId, count: number | null) => {
    setDeckBeatCounts((current) => current[id] === count ? current : { ...current, [id]: count });
  }, []);

  const adjustWaveformZoom = useCallback((factor: number) => {
    const next = Math.min(maxBeatsPerView, Math.max(minBeatsPerView, studioState.beatsPerView * factor));
    dispatchStudio({ action: StudioActionType.WaveformView, value: next });
  }, [maxBeatsPerView, minBeatsPerView, studioState.beatsPerView]);

  useEffect(() => {
    const next = Math.min(maxBeatsPerView, Math.max(minBeatsPerView, studioState.beatsPerView));
    dispatchStudio({ action: StudioActionType.WaveformView, value: next });
  }, [maxBeatsPerView, minBeatsPerView, studioState.beatsPerView]);

  useEffect(() => {
    const shouldAutoSave =
      recordingStatus === 'recording' || (recordingStatus === 'error' && hasPendingSave);
    if (navigationBlocker.state !== 'blocked' || !shouldAutoSave || autoSaveNavigation.current) {
      if (navigationBlocker.state === 'blocked' && !shouldAutoSave) {
        navigationBlocker.proceed();
      }
      return;
    }
    autoSaveNavigation.current = true;
    void stopAndSave().then((saved) => {
      if (saved) navigationBlocker.proceed();
      else navigationBlocker.reset();
    }).catch(() => {
      navigationBlocker.reset();
    }).finally(() => {
      autoSaveNavigation.current = false;
    });
  }, [navigationBlocker, hasPendingSave, recordingStatus, stopAndSave]);

  // Auto-load the first N ready tracks into the N decks, in DECK_IDS order.
  useEffect(() => {
    if (collabRoom || incomingRoomRef.current) return;
    const next = library.songs.filter((song) => song.libraryStatus === 'ready');
    let cancelled = false;

    const syncTracks = async () => {
      for (const [index, id] of DECK_IDS.entries()) {
        const deck = id === DeckId.A ? StreamDeckId.A : StreamDeckId.B;
        const currentTrackId = loadedTrackIds[id];
        const track = currentTrackId
          ? library.songs.find((song) => song.id === currentTrackId)
          : next[index];
        if (!track) continue;
        const streamTrack = await toStreamTrack(track);
        if (cancelled) return;
        if (JSON.stringify(studioState.decks[deck].track) !== JSON.stringify(streamTrack)) {
          dispatchStudio({ action: StudioActionType.TrackLoad, deck, value: streamTrack });
        }
      }
    };

    void syncTracks();
    return () => {
      cancelled = true;
    };
  }, [library.songs, loadedTrackIds, studioState.decks, collabRoom]);

  const trackBpm = useCallback(
    (id: DeckId) => studioState.decks[id === DeckId.A ? StreamDeckId.A : StreamDeckId.B].track?.bpm ?? 0,
    [studioState.decks],
  );

  const reportTransport = useCallback((id: DeckId, next: { playing: boolean; positionSeconds: number; durationSeconds: number; rate: number }) => {
      const previous = studioState.decks[id === DeckId.A ? 'A' : 'B'];
      if (
        previous.playing === next.playing &&
        Math.abs(previous.positionSeconds - next.positionSeconds) < 0.2 &&
        Math.abs(previous.durationSeconds - next.durationSeconds) < 0.1 &&
        previous.rate === next.rate
      ) return;
      dispatchStudio({
        action: StudioActionType.Transport,
        deck: id === DeckId.A ? StreamDeckId.A : StreamDeckId.B,
        value: next,
      });
  }, [studioState.decks]);

  const streaming = useStreamPublisher(engine, studioState);
  const { start: startStream, stop: stopStream } = streaming;
  const avatarUrl = user?.imageUrl ?? '';
  const collabRoomId = collabRoom?.id;
  const sendRoomTransportCommand = useCallback((
    deck: DeckId,
    command: 'play' | 'pause' | 'seek',
    positionSeconds?: number,
    platterAngleDegrees?: number,
  ) => {
    const socket = roomSocketRef.current;
    if (!collabRoomId || !roomEventsReadyRef.current || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      type: 'event',
      t: engine?.context.currentTime ?? 0,
      payload: {
        action: 'transport-command',
        deck: deck === DeckId.A ? StreamDeckId.A : StreamDeckId.B,
        command,
        positionSeconds,
        platterAngleDegrees,
      },
    }));
  }, [collabRoomId, engine]);
  const loadTrackAudio = useCallback((trackId: string) => (
    collabRoomId
      ? fetchRoomTrackAudioBlob(collabRoomId, trackId)
      : fetchTrackAudioBlob(trackId)
  ), [collabRoomId]);

  useEffect(() => {
    const roomId = collabRoom?.id;
    if (!roomId) return;
    let active = true;
    void getRoomLibrary(roomId).then((tracks) => {
      if (active) setRoomLibraryState({ roomId, tracks });
    }).catch((cause: unknown) => {
      if (active) setCollabError(cause instanceof Error ? cause.message : 'Could not load the room library.');
    });
    return () => { active = false; };
  }, [collabRoom?.id, roomMemberKey]);

  useEffect(() => {
    studioSnapshotRef.current = studioState;
  }, [studioState]);

  const cleanupStudioSession = useEffectEvent(() => {
      if (streaming.live) {
        stopStream().catch((cause: unknown) => {
          console.error('Failed to stop stream on beforeunload', cause);
        });
      }
      if (collabRoom) {
        leaveRoom(collabRoom.id).catch((cause: unknown) => {
          console.error('Failed to leave room on beforeunload', cause);
        });
      }
  });

  useEffect(() => {
    const handleBeforeUnload = () => cleanupStudioSession();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      cleanupStudioSession();
    };
  }, []);

  const attachRoomSession = useCallback(async (room: CreatedRoom, publishSnapshots: boolean) => {
    const socket = await connectRoomRelay(room);
    const handleMessage = (message: MessageEvent) => {
      try {
        const event = JSON.parse(String(message.data)) as {
          type?: string;
          payload?: unknown;
          seq?: number;
          userId?: string;
          username?: string;
          avatarUrl?: string;
        };
        if (event.type === 'closed') {
          roomSocketRef.current = null;
          roomEventsReadyRef.current = false;
          publishRoomSnapshotsRef.current = false;
          setCollabRoom(null);
          socket.close();
          navigate('/community', { replace: true, state: { roomClosed: true } });
          return;
        }
        if (event.type === 'error') {
          setCollabError('The room relay rejected an update.');
          return;
        }
        if ((event.type === 'joined' || event.type === 'snapshot')) {
          const snapshot = snapshotFromRoomEvent(event.type, event.payload);
          if (event.type === 'joined' && typeof event.payload === 'object' && event.payload !== null && 'members' in event.payload) {
            const members = (event.payload as { members?: CreatedRoom['members'] }).members;
            if (members) {
              setCollabRoom((current) => current ? { ...current, members } : current);
            }
          }
          if (snapshot) {
            studioSnapshotRef.current = snapshot;
            dispatchStudio({ action: 'hydrate', value: snapshot });
            if (event.type === 'joined') {
              const commandId = String(event.seq ?? Date.now());
              setRoomTransportCommands({
                [StreamDeckId.A]: {
                  id: `${commandId}:A`, command: 'sync',
                  playing: snapshot.decks[StreamDeckId.A].playing,
                  positionSeconds: snapshot.decks[StreamDeckId.A].positionSeconds,
                  receivedAtMs: performance.now(),
                },
                [StreamDeckId.B]: {
                  id: `${commandId}:B`, command: 'sync',
                  playing: snapshot.decks[StreamDeckId.B].playing,
                  positionSeconds: snapshot.decks[StreamDeckId.B].positionSeconds,
                  receivedAtMs: performance.now(),
                },
              });
            } else {
              const commandId = String(event.seq ?? Date.now());
              const receivedAtMs = performance.now();
              setRoomTransportCommands((currentCommands) => ({
                ...currentCommands,
                ...(snapshot.decks[StreamDeckId.A].playing ? {
                  [StreamDeckId.A]: {
                    id: `${commandId}:A`, command: 'sync', playing: true,
                    positionSeconds: snapshot.decks[StreamDeckId.A].positionSeconds, receivedAtMs,
                    platterRevision: currentCommands[StreamDeckId.A]?.platterRevision,
                    platterAngleDegrees: currentCommands[StreamDeckId.A]?.platterAngleDegrees,
                  },
                } : {}),
                ...(snapshot.decks[StreamDeckId.B].playing ? {
                  [StreamDeckId.B]: {
                    id: `${commandId}:B`, command: 'sync', playing: true,
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
          const member = {
            userId: event.userId,
            username: event.username ?? '',
            avatarUrl: event.avatarUrl ?? '',
          };
          setCollabRoom((current) => current ? {
            ...current,
            members: [...(current.members ?? []).filter((existing) => existing.userId !== member.userId), member],
          } : current);
          return;
        }
        if (event.type === 'member-left' && event.userId) {
          setCollabRoom((current) => current ? {
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
              playing: command.command === 'play' ? true : command.command === 'pause' ? false : current.playing,
              positionSeconds: command.command === 'seek' && Number.isFinite(command.positionSeconds)
                ? command.positionSeconds!
                : current.positionSeconds,
            },
          };
          studioSnapshotRef.current = reduceStudioSnapshot(studioSnapshotRef.current, action);
          dispatchStudio(action);
          setRoomTransportCommands((currentCommands) => ({
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
        setCollabError('The room relay returned an unreadable message.');
      }
    };
    const handleClose = () => {
      if (roomSocketRef.current === socket) {
        roomSocketRef.current = null;
        roomEventsReadyRef.current = false;
        publishRoomSnapshotsRef.current = false;
        setCollabError('Room connection lost. The last shared state is still playing locally.');
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
    setCollabRoom(room);
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
  }, [engine, navigate]);

  const startCollabRoom = useCallback(async (visibility: 'public' | 'private') => {
    setCollabBusy(true);
    setCollabError(null);
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
      setCollabError(message);
      throw cause;
    } finally {
      setCollabBusy(false);
    }
  }, [attachRoomSession, avatarUrl, user]);

  useEffect(() => {
    const incoming = incomingRoomRef.current;
    incomingRoomRef.current = undefined;
    if (!incoming) return;
    navigate('/studio', { replace: true, state: null });
    setCollabBusy(true);
    setCollabError(null);
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
      setCollabError(message);
    }).finally(() => setCollabBusy(false));
  }, [attachRoomSession, navigate]);

  const stopCollabRoom = useCallback(async () => {
    if (!collabRoom) return;
    setCollabError(null);
    try {
      await Promise.race([
        leaveRoom(collabRoom.id),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Leave room timed out')), 5000))
      ]);
      publishRoomSnapshotsRef.current = false;
      roomSocketRef.current?.close();
      roomSocketRef.current = null;
      setCollabRoom(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not leave the room.';
      setCollabError(message);
      publishRoomSnapshotsRef.current = false;
      roomSocketRef.current?.close();
      roomSocketRef.current = null;
      setCollabRoom(null);
    }
  }, [collabRoom]);

  useEffect(() => {
    if (!collabRoom) return;
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
  }, [collabRoom, engine]);

  useEffect(() => () => {
    roomSocketRef.current?.close();
    roomSocketRef.current = null;
  }, []);

  const startStreaming = useCallback(async () => {
    if (!engine) return;
    const name = window.prompt('Name your stream');
    if (name === null) return;
    setStreamStartError(null);
    try {
      const connection = await createStream(name, avatarUrl, collabRoom?.id);
      await startStream(connection, engine);
    } catch (cause) {
      setStreamStartError(cause instanceof Error ? cause.message : 'Could not start streaming.');
    }
  }, [engine, startStream, avatarUrl, collabRoom?.id]);

  const stopStreaming = useCallback(() => {
    if (window.confirm('Stop streaming? Viewers will be told the stream has ended.')) {
      void stopStream().catch((cause: unknown) => {
        console.error('Failed to stop stream', cause);
        showToast(cause instanceof Error ? cause.message : 'Could not stop streaming.', 'error', {
          dedupeKey: 'studio-stop-stream',
        });
      });
    }
  }, [showToast, stopStream]);

  const masterId = studioState.mixer.tempoMaster;
  const effectiveDeckBpm = (id: DeckId) => trackBpm(id) * (1 + studioState.mixer.channelState[id].tempo / 100);
  const masterBpm = masterId === null ? 0 : effectiveDeckBpm(masterId);
  const automationBpm = masterBpm > 0 ? masterBpm : DECK_IDS.map(effectiveDeckBpm).find((bpm) => bpm > 0) ?? 0;
  const isFollowing = (id: DeckId) => masterId !== null && id !== masterId && masterBpm > 0 && trackBpm(id) > 0;

  // Followers match the master's effective BPM (track BPM with its tempo applied)
  useEffect(() => {
    if (masterId === null || masterBpm <= 0) return;
    DECK_IDS.forEach((id) => {
      const bpm = trackBpm(id);
      if (id === masterId || bpm <= 0) return;
      const target = clamp((masterBpm / bpm - 1) * 100, -TEMPO_RANGE_PERCENT, TEMPO_RANGE_PERCENT);
      if (Math.abs(target - studioState.mixer.channelState[id].tempo) > 0.001) {
        setChannel(id, { tempo: target });
      }
    });
  }, [masterId, masterBpm, trackBpm, studioState.mixer.channelState, setChannel]);

  // Web Audio requires a user gesture before it will actually produce sound.
  // Resume on the first pointerdown anywhere in the studio, once.
  const resumed = useRef(false);
  useEffect(() => {
    const handler = () => {
      if (resumed.current) return;
      resumed.current = true;
      void engine.resume();
    };
    window.addEventListener('pointerdown', handler);
    return () => window.removeEventListener('pointerdown', handler);
  }, [engine]);

  const ready = library.songs.filter((song) => song.libraryStatus === 'ready');
  const roomLibraryTracks = roomLibrary.map(trackFromRoomLibrary);
  const availableTracks = [
    ...ready,
    ...roomLibraryTracks.filter((track) => !ready.some((localTrack) => localTrack.id === track.id)),
  ];

  const { leftDeckIds, rightDeckIds, gridTemplateColumns } = getStudioDeckLayout();

  const renderDeck = (id: DeckId) => (
    <CDJ
      key={id}
      deckId={id}
      label={id}
      engine={engine}
      loadAudio={loadTrackAudio}
      roomTransportCommand={collabRoom ? roomTransportCommands[id === DeckId.A ? StreamDeckId.A : StreamDeckId.B] ?? undefined : undefined}
      roomTracks={collabRoom ? roomLibrary : undefined}
      currentUserId={user?.id}
      track={library.songs.find((song) => song.id === loadedTrackIds[id])
        ?? trackFromSnapshot(studioState.decks[id === DeckId.A ? StreamDeckId.A : StreamDeckId.B].track)}
      tracks={availableTracks}
      onLoadTrack={async (trackId: string) => {
        const track = availableTracks.find((song) => song.id === trackId);
        commitStudio({
          action: StudioActionType.TrackLoad,
          deck: id === DeckId.A ? StreamDeckId.A : StreamDeckId.B,
          value: track ? await toStreamTrack(track) : null,
        });
      }}
      onPatch={library.patchTrack}
      tempo={studioState.mixer.channelState[id].tempo}
      onTempoChange={(value) => setChannel(id, { tempo: value })}
      syncMaster={masterId === id}
      onSyncMasterChange={(on) => setTempoMaster(on ? id : null)}
      tempoFollowing={isFollowing(id)}
      sharedBeatsPerView={studioState.beatsPerView}
      showZoomControls={id === DeckId.A}
      onSharedZoomBy={adjustWaveformZoom}
      onBeatCountChange={reportDeckBeatCount}
      onTransportUpdate={reportTransport}
      onTransportCommand={(deck, command, positionSeconds, platterAngleDegrees) => (
        sendRoomTransportCommand(deck, command, positionSeconds, platterAngleDegrees)
      )}
      onPopupChange={(deckId, open) => dispatchStudio({
        action: StudioActionType.Popup,
        value: open
          ? {
              kind: StreamPopupKind.TrackPicker,
              deck: deckId === DeckId.A ? StreamDeckId.A : StreamDeckId.B,
            }
          : null,
      })}
    />
  );

  return (
    <ControlSelectionProvider bpm={automationBpm}>
      <StudioConsoleLayout
        className="h-svh bg-[#0b0d10]"
        topbar={
          <StudioTopbar
            recordingStatus={recording.status}
            recordingError={recording.error}
            hasPendingSave={recording.hasPendingSave}
            onStartRecording={() => void recording.start()}
            onStopAndSave={recording.stopAndSave}
            onRetrySave={recording.retrySave}
            onDiscard={recording.discard}
            streamLive={streaming.live}
            streamViewerCount={streaming.viewerCount}
            streamError={streamStartError ?? streaming.error}
            onStartStream={() => void startStreaming()}
            onStopStream={stopStreaming}
            collabRoom={collabRoom}
            collabBusy={collabBusy}
            collabError={collabError}
            onCreateRoom={startCollabRoom}
            onLeaveRoom={stopCollabRoom}
          />
        }
        leftDecks={leftDeckIds.map(renderDeck)}
        rightDecks={rightDeckIds.map(renderDeck)}
        mixer={
          <Mixer
            state={studioState.mixer}
            onChannelChange={setChannel}
            onFxChange={setFx}
            onMasterChange={setMaster}
          />
        }
        gridTemplateColumns={gridTemplateColumns}
        onPointerMove={(event) => {
          const now = performance.now();
          if (now - lastPointerUpdate.current < 50) return;
          lastPointerUpdate.current = now;
          const bounds = event.currentTarget.getBoundingClientRect();
          dispatchStudio({ action: StudioActionType.Pointer, value: {
            x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
            y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
          } });
        }}
      />
    </ControlSelectionProvider>
  );
}

export default StudioPage;