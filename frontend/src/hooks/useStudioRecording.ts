import { useCallback, useEffect, useRef, useState } from 'react';
import { RecordingsAPI } from '@/lib/api/RecordingsAPI';
import {
  EncoderRequestType,
  EncoderResponseType,
  RecordingTapMessageType,
} from '@/lib/types/RecordingEncoder';
import type { MixerAudioEngine } from './useAudioEngine';
import { useToast } from '@/components/ui/toast';
import { ToastVariant } from '@/components/ui/toast';

export enum RecordingStatus {
  Idle = 'idle',
  Starting = 'starting',
  Recording = 'recording',
  Saving = 'saving',
  Error = 'error',
}
type EncoderMessage =
  | { type: EncoderResponseType.Ready }
  | { type: EncoderResponseType.Chunk; data: Uint8Array }
  | { type: EncoderResponseType.Finalized }
  | { type: EncoderResponseType.Error; message: string };
type RecordingTapMessage =
  | { type: RecordingTapMessageType.Samples; durationSeconds?: number; samples?: Float32Array }
  | { type: RecordingTapMessageType.Stopped; durationSeconds?: number }
  | { type: RecordingTapMessageType.Limit };

const HOUR_SECONDS = 60 * 60;

function localRecordingTitle(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function useStudioRecording(engine: MixerAudioEngine) {
  const { showToast } = useToast();
  const [status, setStatus] = useState<RecordingStatus>(RecordingStatus.Idle);
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
    if (pendingBlobRef.current && status === RecordingStatus.Idle) {
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
    setStatus(RecordingStatus.Saving);
    setError(null);
    try {
      await RecordingsAPI.upload(blob, startTitleRef.current, durationRef.current);
      pendingBlobRef.current = null;
      chunksRef.current = [];
      setHasPendingSave(false);
      setStatus(RecordingStatus.Idle);
      showToast('Recording saved.', ToastVariant.Success);
      return true;
    } catch (cause) {
      setStatus(RecordingStatus.Error);
      setError(cause instanceof Error ? cause.message : 'Could not save this recording. Retry or discard it.');
      return false;
    }
  }, [showToast]);

  const stopAndSave = useCallback(async (): Promise<boolean> => {
    if (savingPromiseRef.current) return savingPromiseRef.current;

    const operation = (async () => {
      setError(null);
      const tap = tapRef.current;
      const worker = encoderRef.current;

      if (pendingBlobRef.current) return uploadPending();
      if (status === RecordingStatus.Error) {
        return false;
      }
      if (!tap || !worker) {
        return status === RecordingStatus.Idle;
      }

      setStatus(RecordingStatus.Saving);
      try {
        await new Promise<void>((resolve, reject) => {
          stopResolveRef.current = resolve;
          finalizedRejectRef.current = reject;
          tap.port.postMessage({ type: RecordingTapMessageType.Stop });
        });
        worker.postMessage({ type: EncoderRequestType.Finish });
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
        setStatus(RecordingStatus.Error);
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
    if (status !== RecordingStatus.Idle && !(status === RecordingStatus.Error && !pendingBlobRef.current)) return;
    setStatus(RecordingStatus.Starting);
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
        if (message.type === EncoderResponseType.Ready) {
          readyResolveRef.current?.();
          readyResolveRef.current = null;
        } else if (message.type === EncoderResponseType.Chunk) {
          const copy = new Uint8Array(message.data.byteLength);
          copy.set(message.data);
          chunksRef.current.push(copy.buffer);
        } else if (message.type === EncoderResponseType.Finalized) {
          finalizedResolveRef.current?.();
          finalizedResolveRef.current = null;
        } else if (message.type === EncoderResponseType.Error) {
          const failure = new Error(message.message);
          readyRejectRef.current?.(failure);
          finalizedRejectRef.current?.(failure);
          stopResolveRef.current?.();
          readyRejectRef.current = null;
          finalizedRejectRef.current = null;
          if (tapRef.current) {
            tapRef.current.port.postMessage({ type: RecordingTapMessageType.Stop });
          }
          cleanCapture();
          setStatus(RecordingStatus.Error);
          setError(failure.message);
        }
      };
      worker.onerror = (event) => {
        const failure = new Error(event.message || 'MP3 encoder worker failed.');
        readyRejectRef.current?.(failure);
        finalizedRejectRef.current?.(failure);
        cleanCapture();
        setStatus(RecordingStatus.Error);
        setError(failure.message);
      };
      await new Promise<void>((resolve, reject) => {
        readyResolveRef.current = resolve;
        readyRejectRef.current = reject;
        worker.postMessage({ type: EncoderRequestType.Start, sampleRate: engine.context.sampleRate });
      });
      readyRejectRef.current = null;

      const tap = await engine.createRecordingTap();
      tapRef.current = tap;
      tap.port.onmessage = (event: MessageEvent<RecordingTapMessage>) => {
        if (event.data.type === RecordingTapMessageType.Samples && event.data.samples) {
          worker.postMessage(
            { type: EncoderRequestType.Samples, samples: event.data.samples },
            [event.data.samples.buffer],
          );
        } else if (event.data.type === RecordingTapMessageType.Stopped) {
          durationRef.current = Math.min(HOUR_SECONDS, event.data.durationSeconds ?? 0);
          stopResolveRef.current?.();
          stopResolveRef.current = null;
        } else if (event.data.type === RecordingTapMessageType.Limit) {
          durationRef.current = HOUR_SECONDS;
          void stopAndSave();
        }
      };
      tap.port.start();
      startTitleRef.current = localRecordingTitle(new Date());
      tap.port.postMessage({ type: RecordingTapMessageType.Start });
      setStatus(RecordingStatus.Recording);
    } catch (cause) {
      cleanCapture();
      setStatus(RecordingStatus.Error);
      setError(cause instanceof Error ? cause.message : 'Could not start recording.');
    }
  }, [cleanCapture, engine, status, stopAndSave]);

  const discard = useCallback(() => {
    cleanCapture();
    chunksRef.current = [];
    pendingBlobRef.current = null;
    setHasPendingSave(false);
    setError(null);
    setStatus(RecordingStatus.Idle);
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
