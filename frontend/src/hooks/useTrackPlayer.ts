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

export function useTrackPlayer(options?: { enableSpacebar?: boolean }) {
  const enableSpacebar = options?.enableSpacebar !== false;
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [currentTime, setCurrentTime] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [viewStart, setViewStart] = useState(0);
  const [hiResPeaks, setHiResPeaks] = useState<ThreeBandPeaks | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Stable for the component's lifetime (created once, via the useState
  // initializer form). Exposed below so a consumer (e.g. CDJ) can hand this
  // exact element to MixerAudioEngine.connectMediaElement — the engine needs
  // a real, persistent HTMLMediaElement to create a MediaElementAudioSourceNode
  // from, which a private ref never let it reach.
  const [audioElement] = useState(() => new Audio());

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
    audioElement.pause();
    audioElement.removeAttribute('src');
    audioElement.load();
  }, [audioElement]);

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
    if (openedIdRef.current === trackId && audioElement.src) {
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
      // fetchTrackAudioBlob downloads the actual audio bytes (rather than
      // pointing the element at a remote URL directly), and the object URL
      // below is same-origin by construction. That's required, not just
      // convenient: MixerAudioEngine.connectMediaElement() calls
      // createMediaElementSource() on this element, and if its `src` were a
      // bare cross-origin URL (e.g. a raw S3 link) instead of a locally
      // downloaded blob, the element would be CORS-tainted and Web Audio
      // would silently produce silence from it — no error, just no sound.
      const blob = await fetchTrackAudioBlob(trackId);
      if (openedIdRef.current !== trackId) return;

      const blobUrl = URL.createObjectURL(blob);
      blobUrlRef.current = blobUrl;

      const audio = audioElement;
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
  }, [audioElement, revokeBlob, stopAudio]);

  const seek = useCallback((seconds: number) => {
    if (!Number.isFinite(audioElement.duration) || audioElement.duration <= 0) return;
    const next = Math.min(Math.max(0, seconds), audioElement.duration);
    audioElement.currentTime = next;
    setCurrentTime(next);
  }, [audioElement]);

  const seekFraction = useCallback((fraction: number) => {
    if (!Number.isFinite(audioElement.duration)) return;
    seek(fraction * audioElement.duration);
  }, [audioElement, seek]);

  const play = useCallback(async () => {
    if (!openedIdRef.current) return;
    await audioElement.play();
    setStatus('playing');
  }, [audioElement]);

  const pause = useCallback(() => {
    audioElement.pause();
    if (openedIdRef.current) setStatus('ready');
  }, [audioElement]);

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
    seek(audioElement.currentTime + deltaSeconds);
  }, [audioElement, seek]);

  const jumpStart = useCallback(() => seek(0), [seek]);
  const jumpEnd = useCallback(() => {
    // Kept as `??` for parity with the original behavior: audio.duration is
    // NaN (not null/undefined) before metadata loads, so this only falls
    // back to durationSeconds in the same narrow case the prior code did.
    const duration = audioElement.duration ?? durationSeconds;
    seek(Math.max(0, duration - 0.05));
    pause();
  }, [audioElement, durationSeconds, pause, seek]);

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
    const audio = audioElement;
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
  }, [audioElement]);

  useEffect(() => {
    if (status !== 'playing') return;
    let frame = 0;
    const tick = () => {
      const time = audioElement.currentTime;
      setCurrentTime(time);
      const duration = audioElement.duration || durationSeconds;
      if (duration > 0 && !interactingRef.current) {
        const frac = time / duration;
        const width = 1 / zoom;
        const third = width / 3;
        if (frac < viewStart + third || frac > viewStart + third * 2) {
          setViewStart(Math.min(Math.max(0, frac - width / 2), 1 - width));
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [audioElement, durationSeconds, status, viewStart, zoom]);

  useEffect(() => {
    if (!enableSpacebar) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (!openedIdRef.current) return;
      event.preventDefault();
      if (audioElement.paused) {
        void audioElement.play().then(() => setStatus('playing')).catch(() => undefined);
      } else {
        audioElement.pause();
        setStatus('ready');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [audioElement, enableSpacebar]);

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
    audioElement,
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