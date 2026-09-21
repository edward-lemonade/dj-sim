import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchTrackAudioBlob } from '@/lib/api/TrackAPI';
import {
  computeThreeBandPeaks,
  decodeToAudioBuffer,
  HIRES_COLUMNS,
  type ThreeBandPeaks,
} from '@/lib/utils/threeBandWaveform';

export type PlayerStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'error';

const MIN_ZOOM = 1;
const MAX_ZOOM = 48;

export function useTrackPlayer() {
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [currentTime, setCurrentTime] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [viewStart, setViewStart] = useState(0);
  const [hiResPeaks, setHiResPeaks] = useState<ThreeBandPeaks | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const peaksCacheRef = useRef<Map<string, ThreeBandPeaks>>(new Map());
  const interactingRef = useRef(false);
  const openedIdRef = useRef<string | null>(null);
  openedIdRef.current = openedId;

  const viewWidth = 1 / zoom;
  const viewEnd = Math.min(1, viewStart + viewWidth);

  const revokeBlob = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
  }, []);

  const close = useCallback(() => {
    stopAudio();
    revokeBlob();
    setOpenedId(null);
    setStatus('idle');
    setCurrentTime(0);
    setDurationSeconds(0);
    setZoom(1);
    setViewStart(0);
    setHiResPeaks(null);
    setErrorMessage(null);
  }, [revokeBlob, stopAudio]);

  const open = useCallback(async (trackId: string) => {
    if (openedIdRef.current === trackId && audioRef.current?.src) {
      return;
    }

    stopAudio();
    revokeBlob();
    setOpenedId(trackId);
    setStatus('loading');
    setCurrentTime(0);
    setDurationSeconds(0);
    setZoom(1);
    setViewStart(0);
    setHiResPeaks(peaksCacheRef.current.get(trackId) ?? null);
    setErrorMessage(null);

    try {
      const blob = await fetchTrackAudioBlob(trackId);
      if (openedIdRef.current !== trackId) return;

      const blobUrl = URL.createObjectURL(blob);
      blobUrlRef.current = blobUrl;

      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audio.preload = 'auto';
      audio.src = blobUrl;
      await new Promise<void>((resolve, reject) => {
        const onReady = () => {
          audio.removeEventListener('loadedmetadata', onReady);
          audio.removeEventListener('error', onError);
          resolve();
        };
        const onError = () => {
          audio.removeEventListener('loadedmetadata', onReady);
          audio.removeEventListener('error', onError);
          reject(new Error('Could not load audio'));
        };
        audio.addEventListener('loadedmetadata', onReady);
        audio.addEventListener('error', onError);
        audio.load();
      });

      if (openedIdRef.current !== trackId) return;
      setDurationSeconds(Number.isFinite(audio.duration) ? audio.duration : 0);
      setStatus('ready');

      if (!peaksCacheRef.current.has(trackId)) {
        const buffer = await decodeToAudioBuffer(blob);
        if (openedIdRef.current !== trackId) return;
        const peaks = computeThreeBandPeaks(buffer, HIRES_COLUMNS);
        peaksCacheRef.current.set(trackId, peaks);
        setHiResPeaks(peaks);
      } else {
        setHiResPeaks(peaksCacheRef.current.get(trackId) ?? null);
      }
    } catch (error) {
      if (openedIdRef.current !== trackId) return;
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Could not open track');
    }
  }, [revokeBlob, stopAudio]);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const next = Math.min(Math.max(0, seconds), audio.duration);
    audio.currentTime = next;
    setCurrentTime(next);
  }, []);

  const seekFraction = useCallback((fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    seek(fraction * audio.duration);
  }, [seek]);

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !openedIdRef.current) return;
    await audio.play();
    setStatus('playing');
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    if (openedIdRef.current) setStatus('ready');
  }, []);

  const togglePlay = useCallback(() => {
    if (status === 'playing') {
      pause();
      return;
    }
    if (status === 'ready') {
      void play();
    }
  }, [pause, play, status]);

  const skip = useCallback((deltaSeconds: number) => {
    seek((audioRef.current?.currentTime ?? currentTime) + deltaSeconds);
  }, [currentTime, seek]);

  const jumpStart = useCallback(() => seek(0), [seek]);
  const jumpEnd = useCallback(() => {
    const duration = audioRef.current?.duration ?? durationSeconds;
    seek(Math.max(0, duration - 0.05));
    pause();
  }, [durationSeconds, pause, seek]);

  const setView = useCallback((start: number, nextZoom = zoom) => {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    const width = 1 / z;
    setZoom(z);
    setViewStart(Math.min(Math.max(0, start), 1 - width));
  }, [zoom]);

  const setInteracting = useCallback((value: boolean) => {
    interactingRef.current = value;
  }, []);

  useEffect(() => {
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    const onEnded = () => {
      setStatus('ready');
      setCurrentTime(audio.duration || 0);
    };
    const onPause = () => {
      if (!audio.ended && openedIdRef.current) setStatus((current) => (current === 'playing' ? 'ready' : current));
    };
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('pause', onPause);
    return () => {
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('pause', onPause);
    };
  }, []);

  useEffect(() => {
    if (status !== 'playing') return;
    let frame = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        const time = audio.currentTime;
        setCurrentTime(time);
        const duration = audio.duration || durationSeconds;
        if (duration > 0 && !interactingRef.current) {
          const frac = time / duration;
          const width = 1 / zoom;
          const third = width / 3;
          if (frac < viewStart + third || frac > viewStart + third * 2) {
            setViewStart(Math.min(Math.max(0, frac - width / 2), 1 - width));
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [durationSeconds, status, viewStart, zoom]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (!openedIdRef.current) return;
      event.preventDefault();
      if (audioRef.current?.paused) {
        void audioRef.current.play().then(() => setStatus('playing')).catch(() => undefined);
      } else {
        audioRef.current?.pause();
        setStatus('ready');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    return () => {
      stopAudio();
      revokeBlob();
    };
  }, [revokeBlob, stopAudio]);

  return {
    openedId,
    status,
    currentTime,
    durationSeconds,
    zoom,
    viewStart,
    viewEnd,
    hiResPeaks,
    errorMessage,
    open,
    close,
    play,
    pause,
    togglePlay,
    seek,
    seekFraction,
    skip,
    jumpStart,
    jumpEnd,
    setView,
    setInteracting,
  };
}

export type TrackPlayer = ReturnType<typeof useTrackPlayer>;
