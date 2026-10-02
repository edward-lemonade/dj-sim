import { useCallback, useEffect, useRef, useState } from 'react';
import { RecordingsAPI } from '@/lib/api/RecordingsAPI';
import type { MixerAudioEngine } from './useAudioEngine';

type RecordingStatus = 'idle' | 'starting' | 'recording' | 'saving' | 'error';
type EncoderMessage =
  | { type: 'ready' }
  | { type: 'chunk'; data: Uint8Array }
  | { type: 'finalized' }
  | { type: 'error'; message: string };

const HOUR_SECONDS = 60 * 60;

function localRecordingTitle(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function useStudioRecording(engine: MixerAudioEngine) {
  const [status, setStatus] = useState<RecordingStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hasPendingSave, setHasPendingSave] = useState(false);
  const encoderRef = useRef<Worker | null>(null);
  const tapRef = useRef<AudioWorkletNode | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const pendingBlobRef = useRef<Blob | null>(null);
  const startTitleRef = useRef('');
  const durationRef = useRef(0);
  const readyResolveRef = useRef<(() => void) | null>(null);
  const readyRejectRef = useRef<((error: Error) => void) | null>(null);
  const finalizedResolveRef = useRef<(() => void) | null>(null);
  const finalizedRejectRef = useRef<((error: Error) => void) | null>(null);
  const stopResolveRef = useRef<(() => void) | null>(null);
  const savingPromiseRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    if (pendingBlobRef.current && status === 'idle') {
      console.warn('Recording state inconsistent: pending blob exists but status is idle. Cleaning up.');
      pendingBlobRef.current = null;
      chunksRef.current = [];
      setHasPendingSave(false);
    }
  }, [status]);

  const cleanCapture = useCallback(() => {
    const tap = tapRef.current;
    if (tap) {
      tap.port.onmessage = null;
      engine.disconnectRecordingTap(tap);
      tapRef.current = null;
    }
    encoderRef.current?.terminate();
    encoderRef.current = null;
  }, [engine]);

  const uploadPending = useCallback(async (): Promise<boolean> => {
    const blob = pendingBlobRef.current;
    if (!blob) return true;
    setStatus('saving');
    setError(null);
    try {
      await RecordingsAPI.upload(blob, startTitleRef.current, durationRef.current);
      pendingBlobRef.current = null;
      chunksRef.current = [];
      setHasPendingSave(false);
      setStatus('idle');
      return true;
    } catch (cause) {
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Could not save this recording. Retry or discard it.');
      return false;
    }
  }, []);

  const stopAndSave = useCallback(async (): Promise<boolean> => {
    if (savingPromiseRef.current) return savingPromiseRef.current;

    const operation = (async () => {
      setError(null);
      const tap = tapRef.current;
      const worker = encoderRef.current;

      if (pendingBlobRef.current) return uploadPending();
      if (status === 'error') {
        return false;
      }
      if (!tap || !worker) {
        return status === 'idle';
      }

      setStatus('saving');
      try {
        await new Promise<void>((resolve, reject) => {
          stopResolveRef.current = resolve;
          finalizedRejectRef.current = reject;
          tap.port.postMessage({ type: 'stop' });
        });
        worker.postMessage({ type: 'finish' });
        await new Promise<void>((resolve, reject) => {
          finalizedResolveRef.current = resolve;
          finalizedRejectRef.current = reject;
        });

        pendingBlobRef.current = new Blob(chunksRef.current, { type: 'audio/mpeg' });
        if (pendingBlobRef.current.size === 0) {
          throw new Error('The recording is empty and could not be saved.');
        }
        setHasPendingSave(true);
        cleanCapture();
        return await uploadPending();
      } catch (cause) {
        cleanCapture();
        setStatus('error');
        setError(cause instanceof Error ? cause.message : 'Could not finalize the MP3 recording.');
        return false;
      }
    })();
    savingPromiseRef.current = operation;
    try {
      return await operation;
    } finally {
      savingPromiseRef.current = null;
    }
  }, [cleanCapture, status, uploadPending]);

  const start = useCallback(async () => {
    if (status !== 'idle' && !(status === 'error' && !pendingBlobRef.current)) return;
    setStatus('starting');
    setError(null);
    chunksRef.current = [];
    pendingBlobRef.current = null;
    setHasPendingSave(false);

    try {
      await engine.resume();
      const worker = new Worker(new URL('../lib/utils/recordingEncoder.worker.ts', import.meta.url), { type: 'module' });
      encoderRef.current = worker;
      worker.onmessage = (event: MessageEvent<EncoderMessage>) => {
        const message = event.data;
        if (message.type === 'ready') {
          readyResolveRef.current?.();
          readyResolveRef.current = null;
        } else if (message.type === 'chunk') {
          const copy = new Uint8Array(message.data.byteLength);
          copy.set(message.data);
          chunksRef.current.push(copy.buffer);
        } else if (message.type === 'finalized') {
          finalizedResolveRef.current?.();
          finalizedResolveRef.current = null;
        } else if (message.type === 'error') {
          const failure = new Error(message.message);
          readyRejectRef.current?.(failure);
          finalizedRejectRef.current?.(failure);
          stopResolveRef.current?.();
          readyRejectRef.current = null;
          finalizedRejectRef.current = null;
          if (tapRef.current) {
            tapRef.current.port.postMessage({ type: 'stop' });
          }
          cleanCapture();
          setStatus('error');
          setError(failure.message);
        }
      };
      worker.onerror = (event) => {
        const failure = new Error(event.message || 'MP3 encoder worker failed.');
        readyRejectRef.current?.(failure);
        finalizedRejectRef.current?.(failure);
        cleanCapture();
        setStatus('error');
        setError(failure.message);
      };
      await new Promise<void>((resolve, reject) => {
        readyResolveRef.current = resolve;
        readyRejectRef.current = reject;
        worker.postMessage({ type: 'start', sampleRate: engine.context.sampleRate });
      });
      readyRejectRef.current = null;

      const tap = await engine.createRecordingTap();
      tapRef.current = tap;
      tap.port.onmessage = (event: MessageEvent<{ type: string; durationSeconds?: number; samples?: Float32Array }>) => {
        if (event.data.type === 'samples' && event.data.samples) {
          worker.postMessage({ type: 'samples', samples: event.data.samples }, [event.data.samples.buffer]);
        } else if (event.data.type === 'stopped') {
          durationRef.current = Math.min(HOUR_SECONDS, event.data.durationSeconds ?? 0);
          stopResolveRef.current?.();
          stopResolveRef.current = null;
        } else if (event.data.type === 'limit') {
          durationRef.current = HOUR_SECONDS;
          void stopAndSave();
        }
      };
      tap.port.start();
      startTitleRef.current = localRecordingTitle(new Date());
      tap.port.postMessage({ type: 'start' });
      setStatus('recording');
    } catch (cause) {
      cleanCapture();
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Could not start recording.');
    }
  }, [cleanCapture, engine, status, stopAndSave]);

  const discard = useCallback(() => {
    cleanCapture();
    chunksRef.current = [];
    pendingBlobRef.current = null;
    setHasPendingSave(false);
    setError(null);
    setStatus('idle');
  }, [cleanCapture]);

  return {
    status,
    error,
    hasPendingSave,
    start,
    stopAndSave,
    retrySave: uploadPending,
    discard,
  };
}
