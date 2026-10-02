import { LocalAudioTrack, Room, RoomEvent, Track } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ENV } from '@/config/env';
import API_ROUTES from '@/config/api';
import type { StreamConnection, StreamEvent, StudioSnapshot } from '@/lib/types/Stream';
import { endStream, joinStream } from '@/lib/api/StreamsAPI';
import type { MixerAudioEngine } from '@/hooks/useAudioEngine';
import { ApiError, axiosClient } from '@/lib/clients/axios';
import { diffStudioSnapshots, reduceStudioSnapshot, type StudioAction } from './studioState';

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
        type: 'snapshot',
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
      if (event.type === 'viewer-count') setViewerCount(event.count ?? 0);
      if (event.type === 'error') setError('The stream event relay rejected an update.');
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
        type: 'snapshot',
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
        socket.send(JSON.stringify({ type: 'end' }));
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
          if (action.action === 'pointer') {
            socket.send(JSON.stringify({ type: 'pointer', t: engine?.context.currentTime ?? 0, payload: action.value }));
          } else {
            socket.send(JSON.stringify({ type: 'event', t: engine?.context.currentTime ?? 0, payload: action }));
            if (action.action === 'track-load') {
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
  const [status, setStatus] = useState<'joining' | 'live' | 'ended' | 'error'>('joining');
  const [error, setError] = useState<string | null>(null);
  const [needsAudioGesture, setNeedsAudioGesture] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [remotePointer, setRemotePointer] = useState<{ x: number; y: number } | null>(null);
  const snapshotRef = useRef<StudioSnapshot | null>(null);
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
    setStatus('joining');
    setError(null);
    endedRef.current = false;
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
        const audio = track.attach();
        audio.autoplay = true;
        audioElementsRef.current.push(audio);
        void audio.play().catch(() => setNeedsAudioGesture(true));
      });
      connectedRoom.on(RoomEvent.Disconnected, () => {
        if (!disposedRef.current && attempt === attemptRef.current && !endedRef.current) {
          stopViewerAudio();
          snapshotRef.current = null;
          setRemotePointer(null);
          setSnapshot(null);
          setStatus('error');
          setError('Connection to this stream was lost.');
          queueReconnect(2000);
        }
      });
      connectedRoom.on(RoomEvent.Reconnected, () => {
        if (!disposedRef.current && attempt === attemptRef.current) setStatus('live');
      });
      await connectedRoom.connect(connection.liveKitUrl, connection.liveKitToken);
      roomRef.current = connectedRoom;
      const socket = new WebSocket(eventSocketUrl(connection));
      socketRef.current = socket;
      socket.addEventListener('open', () => {
        if (!disposedRef.current && attempt === attemptRef.current) {
          if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
          setStatus('live');
        }
      });
      socket.addEventListener('message', (message) => {
        if (disposedRef.current || attempt !== attemptRef.current) return;
        const event = JSON.parse(String(message.data)) as StreamEvent;
        if (event.type === 'joined' || event.type === 'snapshot') {
          const next = (event.payload as StudioSnapshot | undefined) ?? null;
          snapshotRef.current = next;
          setRemotePointer(next?.pointer ?? null);
          setSnapshot(next ? { ...next, capturedAt: Date.now() } : null);
        } else if (event.type === 'event' && event.payload && snapshotRef.current) {
          const next = reduceStudioSnapshot(snapshotRef.current, event.payload as StudioAction);
          snapshotRef.current = next;
          setSnapshot({ ...next, capturedAt: Date.now() });
        } else if (event.type === 'pointer') {
          const p = event.payload as { x: number; y: number } | null;
          setRemotePointer(p);
          if (snapshotRef.current) {
            const next = reduceStudioSnapshot(snapshotRef.current, { action: 'pointer', value: p });
            snapshotRef.current = next;
            setSnapshot({ ...next, capturedAt: Date.now() });
          }
        } else if (event.type === 'viewer-count') {
          setViewerCount(event.count ?? 0);
        } else if (event.type === 'ended') {
          endedRef.current = true;
          attemptRef.current++;
          if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
          setStatus('ended');
          stopViewerAudio();
          socket.close();
        } else if (event.type === 'error') {
          setStatus('error');
          setError('The stream connection returned an error.');
        }
      });
      socket.addEventListener('error', () => {
        if (!disposedRef.current && attempt === attemptRef.current && !endedRef.current) {
          stopViewerAudio();
          snapshotRef.current = null;
          setRemotePointer(null);
          setSnapshot(null);
          setStatus('error');
          setError('Could not connect to the stream event relay.');
          queueReconnect(2000);
        }
      });
      socket.addEventListener('close', () => {
        if (!disposedRef.current && attempt === attemptRef.current && !endedRef.current) {
          stopViewerAudio();
          snapshotRef.current = null;
          setRemotePointer(null);
          setSnapshot(null);
          setStatus('error');
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
        setStatus('ended');
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
      setStatus('error');
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
