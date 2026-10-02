import { LocalAudioTrack, Room, RoomEvent, Track } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ENV } from '@/config/env';
import API_ROUTES from '@/config/api';
import {
  StreamConnectionStatus,
  StreamDeckId,
  StreamEventType,
  type StreamConnection,
  type StreamEvent,
  type StudioSnapshot,
} from '@/lib/types/Stream';
import { endStream, joinStream } from '@/lib/api/StreamsAPI';
import type { MixerAudioEngine } from '@/hooks/useAudioEngine';
import { ApiError, axiosClient } from '@/lib/clients/axios';
import {
  diffStudioSnapshots,
  interpolateDeckPosition,
  interpolateMixerState,
  interpolatePointer,
  reduceStudioSnapshot,
  STREAM_PLAYBACK_BUFFER_SECONDS,
  StudioActionType,
  type StudioAction,
  type MixerSample,
  type PointerSample,
  type TransportSample,
} from './studioState';

const PLAYBACK_RENDER_INTERVAL_MS = 1000 / 30;

function isStudioSnapshot(value: unknown): value is StudioSnapshot {
  return typeof value === 'object' && value !== null && 'decks' in value && 'mixer' in value;
}

function getSnapshotTransportSamples(snapshot: StudioSnapshot, time: number): Record<StreamDeckId, TransportSample> {
  return {
    A: { time, trackId: snapshot.decks.A.track?.id ?? null, transport: snapshot.decks.A },
    B: { time, trackId: snapshot.decks.B.track?.id ?? null, transport: snapshot.decks.B },
  };
}

function eventSocketUrl(connection: StreamConnection): string {
  const url = new URL(connection.eventUrl, ENV.apiBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('ticket', connection.eventTicket);
  return url.toString();
}

export function useStreamPublisher(engine: MixerAudioEngine | null, snapshot: StudioSnapshot | null) {
  const [live, setLive] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const roomRef = useRef<Room | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioTrackRef = useRef<LocalAudioTrack | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const exitTicketRef = useRef<string | null>(null);
  const publisherActiveRef = useRef(false);
  const publisherRetryRef = useRef<number | null>(null);
  const snapshotRef = useRef(snapshot);
  const lastSentSnapshotRef = useRef<StudioSnapshot | null>(null);
  const lastCheckpointAtRef = useRef(0);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);
  const connectPublisherRef = useRef<(streamId: string) => Promise<void>>(async () => undefined);

  const publishSnapshot = useCallback((next: StudioSnapshot) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: StreamEventType.Snapshot,
        t: engine?.context.currentTime ?? 0,
        payload: { ...next, pointer: null },
      }));
    }
  }, [engine]);

  const connectPublisherEvents = useCallback(async (streamId: string, initialConnection?: StreamConnection) => {
    const connection = initialConnection ?? await joinStream(streamId);
    exitTicketRef.current = connection.exitTicket ?? exitTicketRef.current;
    const socket = new WebSocket(eventSocketUrl(connection));
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        window.clearTimeout(timeout);
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('error', onError);
        socket.removeEventListener('close', onClose);
      };
      const fail = (cause: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        socket.close();
        reject(cause);
      };
      const onOpen = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onError = () => {
        fail(new Error('Could not reconnect to the stream event relay.'));
      };
      const onClose = () => {
        fail(new Error('The stream event relay closed before connecting.'));
      };
      const timeout = window.setTimeout(() => {
        fail(new Error('Timed out reconnecting to stream events.'));
      }, 10000);
      socket.addEventListener('open', onOpen);
      socket.addEventListener('error', onError);
      socket.addEventListener('close', onClose);
    });
    if (!publisherActiveRef.current) {
      socket.close();
      return;
    }
    socketRef.current = socket;
    socket.addEventListener('message', (message) => {
      const event = JSON.parse(String(message.data)) as StreamEvent;
      if (event.type === StreamEventType.ViewerCount) setViewerCount(event.count ?? 0);
      if (event.type === StreamEventType.Error) setError('The stream event relay rejected an update.');
    });
    socket.addEventListener('close', () => {
      if (!publisherActiveRef.current || socketRef.current !== socket) return;
      setError('Stream event connection lost; reconnecting...');
      const retry = () => {
        if (!publisherActiveRef.current) return;
        if (publisherRetryRef.current !== null) window.clearTimeout(publisherRetryRef.current);
        publisherRetryRef.current = window.setTimeout(() => {
          void connectPublisherRef.current(streamId).then(() => setError(null)).catch((cause: unknown) => {
          if (cause instanceof ApiError && cause.status === 404) {
            publisherActiveRef.current = false;
            setLive(false);
            setError('The stream session ended.');
            roomRef.current?.disconnect();
            return;
          }
          setError(cause instanceof Error ? cause.message : 'Could not reconnect to stream events.');
          retry();
        });
        }, 1500);
      };
      retry();
    });
    if (snapshotRef.current) {
      socket.send(JSON.stringify({
        type: StreamEventType.Snapshot,
        t: engine?.context.currentTime ?? 0,
        payload: { ...snapshotRef.current, pointer: null },
      }));
      lastSentSnapshotRef.current = snapshotRef.current;
      lastCheckpointAtRef.current = Date.now();
    }
  }, [engine]);
  useEffect(() => {
    connectPublisherRef.current = (streamId) => connectPublisherEvents(streamId);
  }, [connectPublisherEvents]);

  useEffect(() => {
    const endOnPageExit = () => {
      const socket = socketRef.current;
      const sessionId = sessionIdRef.current;
      if (sessionId && socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: StreamEventType.End }));
      }
      if (sessionId && exitTicketRef.current) {
        const url = axiosClient.getUri({ url: API_ROUTES.stream.endOnExit(sessionId) });
        navigator.sendBeacon(url, exitTicketRef.current);
      }
    };
    window.addEventListener('pagehide', endOnPageExit);
    return () => window.removeEventListener('pagehide', endOnPageExit);
  }, []);

  const start = useCallback(async (connection: StreamConnection, audioEngine: MixerAudioEngine) => {
    setError(null);
    publisherActiveRef.current = true;
    sessionIdRef.current = connection.session.id;
    exitTicketRef.current = connection.exitTicket ?? null;
    let room: Room | null = null;
    let destination: MediaStreamAudioDestinationNode | null = null;
    try {
      room = new Room({
        publishDefaults: { forceStereo: true, dtx: false },
        disconnectOnPageLeave: true,
      });
      await room.connect(connection.liveKitUrl, connection.liveKitToken);
      destination = audioEngine.createStreamingAudioDestination();
      const mediaTrack = destination.stream.getAudioTracks()[0];
      if (!mediaTrack) throw new Error('Could not create the studio audio stream.');
      const localAudioTrack = new LocalAudioTrack(mediaTrack, {}, false, audioEngine.context);
      await room.localParticipant.publishTrack(localAudioTrack, {
        name: 'studio-mix',
        source: Track.Source.Microphone,
        forceStereo: true,
        dtx: false,
      });
      roomRef.current = room;
      destinationRef.current = destination;
      audioTrackRef.current = localAudioTrack;
      await connectPublisherEvents(connection.session.id, connection);
      setLive(true);
    } catch (cause) {
      publisherActiveRef.current = false;
      socketRef.current?.close();
      sessionIdRef.current = null;
      exitTicketRef.current = null;
      if (destination) audioEngine.master.disconnect(destination);
      room?.disconnect();
      let message = cause instanceof Error ? cause.message : 'Could not start streaming.';
      try {
        await endStream(connection.session.id);
      } catch (cleanupCause) {
        const cleanupMessage = cleanupCause instanceof Error ? cleanupCause.message : 'stream cleanup failed';
        message = `${message} The stream session could not be closed: ${cleanupMessage}`;
      }
      setError(message);
      throw new Error(message, { cause });
    }
  }, [connectPublisherEvents]);

  const stop = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    const socket = socketRef.current;
    const room = roomRef.current;
    const destination = destinationRef.current;
    publisherActiveRef.current = false;
    if (publisherRetryRef.current !== null) window.clearTimeout(publisherRetryRef.current);
    socket?.close();
    if (destination && engine) engine.master.disconnect(destination);
    audioTrackRef.current?.stop();
    room?.disconnect();
    socketRef.current = null;
    roomRef.current = null;
    destinationRef.current = null;
    audioTrackRef.current = null;
    sessionIdRef.current = null;
    exitTicketRef.current = null;
    setLive(false);
    if (sessionId) {
      try {
        await endStream(sessionId);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not end the stream session.');
        throw cause;
      }
    }
  }, [engine]);

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      const current = snapshotRef.current;
      const socket = socketRef.current;
      if (!current || socket?.readyState !== WebSocket.OPEN) return;
      const previous = lastSentSnapshotRef.current;
      if (previous) {
        for (const action of diffStudioSnapshots(previous, current)) {
          if (action.action === StudioActionType.Pointer) {
            socket.send(JSON.stringify({ type: StreamEventType.Pointer, t: engine?.context.currentTime ?? 0, payload: action.value }));
          } else {
            socket.send(JSON.stringify({ type: StreamEventType.Event, t: engine?.context.currentTime ?? 0, payload: action }));
            if (action.action === StudioActionType.TrackLoad) {
              publishSnapshot(current);
              lastCheckpointAtRef.current = Date.now();
            }
          }
        }
      }
      lastSentSnapshotRef.current = current;
      if (Date.now() - lastCheckpointAtRef.current >= 1000) {
        publishSnapshot(current);
        lastCheckpointAtRef.current = Date.now();
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [engine, live, publishSnapshot]);

  useEffect(() => () => {
    publisherActiveRef.current = false;
    if (publisherRetryRef.current !== null) window.clearTimeout(publisherRetryRef.current);
    socketRef.current?.close();
    roomRef.current?.disconnect();
    audioTrackRef.current?.stop();
    if (destinationRef.current && engine) engine.master.disconnect(destinationRef.current);
  }, [engine]);

  return { live, viewerCount, error, start, stop, publishSnapshot };
}

export function useStreamViewer(id: string) {
  const [session, setSession] = useState<StreamConnection['session'] | null>(null);
  const [snapshot, setSnapshot] = useState<StudioSnapshot | null>(null);
  const [status, setStatus] = useState<StreamConnectionStatus>(StreamConnectionStatus.Joining);
  const [error, setError] = useState<string | null>(null);
  const [needsAudioGesture, setNeedsAudioGesture] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [remotePointer, setRemotePointer] = useState<{ x: number; y: number } | null>(null);
  const snapshotRef = useRef<StudioSnapshot | null>(null);
  const eventQueueRef = useRef<StreamEvent[]>([]);
  const transportSamplesRef = useRef<Record<StreamDeckId, TransportSample[]>>({
    [StreamDeckId.A]: [],
    [StreamDeckId.B]: [],
  });
  const mixerSamplesRef = useRef<MixerSample[]>([]);
  const pointerSamplesRef = useRef<PointerSample[]>([]);
  const latestTimelineRef = useRef<{ time: number; receivedAt: number } | null>(null);
  const roomRef = useRef<Room | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const audioElementsRef = useRef<HTMLAudioElement[]>([]);
  const endedRef = useRef(false);
  const attemptRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const disposedRef = useRef(false);
  const connectRef = useRef<() => Promise<void>>(async () => undefined);
  const stopViewerAudio = useCallback(() => {
    const room = roomRef.current;
    roomRef.current = null;
    room?.disconnect();
    audioElementsRef.current.forEach((audio) => {
      audio.pause();
      audio.remove();
    });
    audioElementsRef.current = [];
    setNeedsAudioGesture(false);
  }, []);

  const connect = useCallback(async () => {
    const attempt = ++attemptRef.current;
    disposedRef.current = false;
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    const queueReconnect = (delay: number) => {
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = window.setTimeout(() => void connectRef.current(), delay);
    };
    setStatus(StreamConnectionStatus.Joining);
    setError(null);
    endedRef.current = false;
    snapshotRef.current = null;
    eventQueueRef.current = [];
    transportSamplesRef.current = { [StreamDeckId.A]: [], [StreamDeckId.B]: [] };
    mixerSamplesRef.current = [];
    pointerSamplesRef.current = [];
    latestTimelineRef.current = null;
    setSnapshot(null);
    const oldSocket = socketRef.current;
    socketRef.current = null;
    oldSocket?.close();
    stopViewerAudio();
    let room: Room | null = null;
    try {
      const connection = await joinStream(id);
      setSession(connection.session);
      const connectedRoom = new Room({ adaptiveStream: false, dynacast: false });
      room = connectedRoom;
      connectedRoom.on(RoomEvent.TrackSubscribed, (track) => {
        if (disposedRef.current || attempt !== attemptRef.current || track.kind !== Track.Kind.Audio) return;
        track.setPlayoutDelay(STREAM_PLAYBACK_BUFFER_SECONDS);
        const audio = track.attach();
        audio.autoplay = true;
        audioElementsRef.current.push(audio);
        void audio.play().catch(() => setNeedsAudioGesture(true));
      });
      connectedRoom.on(RoomEvent.Disconnected, () => {
        if (!disposedRef.current && attempt === attemptRef.current && !endedRef.current) {
          stopViewerAudio();
          snapshotRef.current = null;
          eventQueueRef.current = [];
          transportSamplesRef.current = { [StreamDeckId.A]: [], [StreamDeckId.B]: [] };
          mixerSamplesRef.current = [];
          pointerSamplesRef.current = [];
          latestTimelineRef.current = null;
          setRemotePointer(null);
          setSnapshot(null);
          setStatus(StreamConnectionStatus.Error);
          setError('Connection to this stream was lost.');
          queueReconnect(2000);
        }
      });
      connectedRoom.on(RoomEvent.Reconnected, () => {
        if (!disposedRef.current && attempt === attemptRef.current) setStatus(StreamConnectionStatus.Live);
      });
      await connectedRoom.connect(connection.liveKitUrl, connection.liveKitToken);
      roomRef.current = connectedRoom;
      const socket = new WebSocket(eventSocketUrl(connection));
      socketRef.current = socket;
      socket.addEventListener('open', () => {
        if (!disposedRef.current && attempt === attemptRef.current) {
          if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
          setStatus(StreamConnectionStatus.Live);
        }
      });
      socket.addEventListener('message', (message) => {
        if (disposedRef.current || attempt !== attemptRef.current) return;
        const event = JSON.parse(String(message.data)) as StreamEvent;
        if (event.type === StreamEventType.ViewerCount) {
          setViewerCount(event.count ?? 0);
        } else if (event.type === StreamEventType.Ended) {
          endedRef.current = true;
          attemptRef.current++;
          eventQueueRef.current = [];
          transportSamplesRef.current = { [StreamDeckId.A]: [], [StreamDeckId.B]: [] };
          mixerSamplesRef.current = [];
          pointerSamplesRef.current = [];
          latestTimelineRef.current = null;
          if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
          setStatus(StreamConnectionStatus.Ended);
          stopViewerAudio();
          socket.close();
        } else if (event.type === StreamEventType.Error) {
          setStatus(StreamConnectionStatus.Error);
          setError('The stream connection returned an error.');
        } else if (
          (event.type === StreamEventType.Joined ||
            event.type === StreamEventType.Snapshot ||
            event.type === StreamEventType.Event ||
            event.type === StreamEventType.Pointer) &&
          Number.isFinite(event.t)
        ) {
          const time = event.t!;
          const receivedAt = performance.now();
          const latest = latestTimelineRef.current;
          if (!latest || time > latest.time) latestTimelineRef.current = { time, receivedAt };
          eventQueueRef.current.push(event);

          if ((event.type === StreamEventType.Joined || event.type === StreamEventType.Snapshot) && isStudioSnapshot(event.payload)) {
            const snapshotSamples = getSnapshotTransportSamples(event.payload, time);
            for (const deck of [StreamDeckId.A, StreamDeckId.B]) {
              transportSamplesRef.current[deck].push(snapshotSamples[deck]);
            }
            mixerSamplesRef.current.push({ time, value: event.payload.mixer });
            if (event.payload.pointer) pointerSamplesRef.current.push({ time, value: event.payload.pointer });
          } else if (event.type === StreamEventType.Event && event.payload && typeof event.payload === 'object') {
            const action = event.payload as StudioAction;
            if (action.action === StudioActionType.Transport) {
              const samples = transportSamplesRef.current[action.deck];
              const previous = samples[samples.length - 1];
              samples.push({
                time,
                trackId: snapshotRef.current?.decks[action.deck].track?.id ?? previous?.trackId ?? null,
                transport: action.value,
              });
            } else if (action.action === StudioActionType.TrackLoad) {
              const samples = transportSamplesRef.current[action.deck];
              samples.push({
                time,
                trackId: action.value?.id ?? null,
                transport: {
                  playing: false,
                  positionSeconds: 0,
                  durationSeconds: action.value?.durationSeconds ?? 0,
                  rate: 1,
                },
              });
            } else if (action.action === StudioActionType.MixerChange) {
              mixerSamplesRef.current.push({ time, value: action.value });
            } else if (action.action === StudioActionType.Pointer) {
              pointerSamplesRef.current.push({ time, value: action.value });
            }
          }
        }
      });
      socket.addEventListener('error', () => {
        if (!disposedRef.current && attempt === attemptRef.current && !endedRef.current) {
          stopViewerAudio();
          snapshotRef.current = null;
          eventQueueRef.current = [];
          transportSamplesRef.current = { A: [], B: [] };
          mixerSamplesRef.current = [];
          pointerSamplesRef.current = [];
          latestTimelineRef.current = null;
          setRemotePointer(null);
          setSnapshot(null);
          setStatus(StreamConnectionStatus.Error);
          setError('Could not connect to the stream event relay.');
          queueReconnect(2000);
        }
      });
      socket.addEventListener('close', () => {
        if (!disposedRef.current && attempt === attemptRef.current && !endedRef.current) {
          stopViewerAudio();
          snapshotRef.current = null;
          eventQueueRef.current = [];
          transportSamplesRef.current = { A: [], B: [] };
          mixerSamplesRef.current = [];
          pointerSamplesRef.current = [];
          latestTimelineRef.current = null;
          setRemotePointer(null);
          setSnapshot(null);
          setStatus(StreamConnectionStatus.Error);
          setError('The stream event connection closed.');
          queueReconnect(2000);
        }
      });
    } catch (cause) {
      if (attempt !== attemptRef.current) return;
      if (cause instanceof ApiError && cause.status === 404) {
        stopViewerAudio();
        socketRef.current?.close();
        socketRef.current = null;
        endedRef.current = true;
        setStatus(StreamConnectionStatus.Ended);
        return;
      }
      room?.disconnect();
      if (roomRef.current === room) roomRef.current = null;
      socketRef.current?.close();
      audioElementsRef.current.forEach((audio) => {
        audio.pause();
        audio.remove();
      });
      audioElementsRef.current = [];
      snapshotRef.current = null;
      eventQueueRef.current = [];
      transportSamplesRef.current = { A: [], B: [] };
      latestTimelineRef.current = null;
      setStatus(StreamConnectionStatus.Error);
      setError(cause instanceof Error ? cause.message : 'Could not join this stream.');
      const retryable = !(cause instanceof ApiError && cause.status !== undefined && (cause.status < 500 || cause.status === 503));
      if (!disposedRef.current && retryable) {
        queueReconnect(3000);
      }
    }
  }, [id, stopViewerAudio]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const latest = latestTimelineRef.current;
      if (!latest || endedRef.current) return;

      const elapsedSinceLatest = Math.max(0, performance.now() - latest.receivedAt) / 1000;
      const presentationTime = Math.max(
        0,
        latest.time + elapsedSinceLatest - STREAM_PLAYBACK_BUFFER_SECONDS,
      );

      while (eventQueueRef.current[0] && (eventQueueRef.current[0].t ?? Infinity) <= presentationTime) {
        const event = eventQueueRef.current.shift()!;
        if ((event.type === StreamEventType.Joined || event.type === StreamEventType.Snapshot) && isStudioSnapshot(event.payload)) {
          const next = event.payload;
          snapshotRef.current = next;
          setRemotePointer(next.pointer);
          for (const deck of [StreamDeckId.A, StreamDeckId.B]) {
            const samples = transportSamplesRef.current[deck];
            const sampleIndex = samples.findIndex((sample) => sample.time === event.t);
            if (sampleIndex >= 0) {
              samples[sampleIndex] = {
                ...samples[sampleIndex],
                trackId: next.decks[deck].track?.id ?? null,
                transport: next.decks[deck],
              };
            }
          }
        } else if (event.type === StreamEventType.Event && event.payload && snapshotRef.current) {
          snapshotRef.current = reduceStudioSnapshot(snapshotRef.current, event.payload as StudioAction);
        } else if (event.type === StreamEventType.Pointer) {
          const pointer = (event.payload as { x: number; y: number } | null) ?? null;
          setRemotePointer(pointer);
          if (snapshotRef.current) {
            snapshotRef.current = reduceStudioSnapshot(snapshotRef.current, {
              action: StudioActionType.Pointer,
              value: pointer,
            });
          }
        }
      }

      const current = snapshotRef.current;
      if (!current) return;

      const decks = { ...current.decks };
      for (const deck of [StreamDeckId.A, StreamDeckId.B]) {
        const samples = transportSamplesRef.current[deck];
        let previousIndex = -1;
        let nextIndex = -1;
        for (let index = 0; index < samples.length; index++) {
          if (samples[index].time <= presentationTime) previousIndex = index;
          else {
            nextIndex = index;
            break;
          }
        }
        if (previousIndex >= 0) {
          const previous = samples[previousIndex];
          const next = nextIndex >= 0 ? samples[nextIndex] : undefined;
          decks[deck] = {
            ...decks[deck],
            positionSeconds: interpolateDeckPosition(
              decks[deck].track?.id ?? null,
              previous,
              next,
              presentationTime,
            ),
          };
          if (previousIndex > 0) samples.splice(0, previousIndex);
        }
      }

      const previousMixerIndex = mixerSamplesRef.current.findLastIndex((sample) => sample.time <= presentationTime);
      const mixer = previousMixerIndex >= 0
        ? interpolateMixerState(
            mixerSamplesRef.current[previousMixerIndex],
            mixerSamplesRef.current[previousMixerIndex + 1],
            presentationTime,
          )
        : current.mixer;
      if (previousMixerIndex > 0) mixerSamplesRef.current.splice(0, previousMixerIndex);

      const previousPointerIndex = pointerSamplesRef.current.findLastIndex((sample) => sample.time <= presentationTime);
      const pointer = previousPointerIndex >= 0
        ? interpolatePointer(
            pointerSamplesRef.current[previousPointerIndex],
            pointerSamplesRef.current[previousPointerIndex + 1],
            presentationTime,
          )
        : current.pointer;
      if (previousPointerIndex > 0) pointerSamplesRef.current.splice(0, previousPointerIndex);

      setSnapshot({ ...current, decks, mixer, pointer, capturedAt: presentationTime * 1000 });
    }, PLAYBACK_RENDER_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const joinTimer = window.setTimeout(() => void connect(), 0);
    return () => {
      window.clearTimeout(joinTimer);
      disposedRef.current = true;
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
      socketRef.current?.close();
      roomRef.current?.disconnect();
      audioElementsRef.current.forEach((audio) => {
        audio.pause();
        audio.remove();
      });
      audioElementsRef.current = [];
    };
  }, [connect]);

  const playAudio = useCallback(() => {
    audioElementsRef.current.forEach((audio) => void audio.play().catch(() => {
      setError('Audio playback could not be started.');
    }));
    setNeedsAudioGesture(false);
  }, []);

  return { session, snapshot, status, error, needsAudioGesture, viewerCount, remotePointer, connect, playAudio };
}
