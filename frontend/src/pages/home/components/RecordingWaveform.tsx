import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RecordingsAPI, type Recording } from '@/lib/api/RecordingsAPI';

type Props = {
  recording: Recording;
  audioElement: HTMLAudioElement | null;
  currentTime: number;
  isActive: boolean;
  onSeek: (seconds: number) => void;
  onRetry: () => void;
  retrying: boolean;
};

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function RecordingWaveform({
  recording,
  audioElement,
  currentTime,
  isActive,
  onSeek,
  onRetry,
  retrying,
}: Props) {
  const pointerId = useRef<number | null>(null);
  const [animatedTime, setAnimatedTime] = useState(currentTime);
  const waveformQuery = useQuery({
    queryKey: ['recording-waveform', recording.id],
    queryFn: () => RecordingsAPI.waveform(recording.id),
    enabled: recording.waveformStatus === 'ready',
    staleTime: Infinity,
  });
  const duration = recording.durationSeconds;
  const displayTime = isActive ? animatedTime : currentTime;
  const progress = duration > 0 ? Math.min(1, Math.max(0, displayTime / duration)) : 0;
  const waveform = waveformQuery.data;

  useEffect(() => {
    if (!isActive || !audioElement || audioElement.dataset.recordingId !== recording.id) return;

    let frameId = 0;
    const updateTime = () => {
      if (audioElement.paused) return;
      setAnimatedTime(audioElement.currentTime);
      frameId = requestAnimationFrame(updateTime);
    };
    frameId = requestAnimationFrame(updateTime);

    return () => cancelAnimationFrame(frameId);
  }, [audioElement, isActive, recording.id]);

  const seekFromPointer = (element: HTMLDivElement, clientX: number) => {
    const bounds = element.getBoundingClientRect();
    const progressAtPointer = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
    onSeek(progressAtPointer * duration);
  };

  const peakPath = useMemo(() => {
    if (!waveform) return '';
    const groupSize = Math.max(1, Math.ceil(waveform.peaks.length / 600));
    const displayedPeaks: [number, number][] = [];
    for (let start = 0; start < waveform.peaks.length; start += groupSize) {
      let minimum = 1;
      let maximum = -1;
      for (let index = start; index < Math.min(start + groupSize, waveform.peaks.length); index += 1) {
        minimum = Math.min(minimum, waveform.peaks[index][0]);
        maximum = Math.max(maximum, waveform.peaks[index][1]);
      }
      displayedPeaks.push([minimum, maximum]);
    }

    const center = 28;
    const halfHeight = 24;
    return displayedPeaks.map(([minimum, maximum], index) => {
      const x = ((index + 0.5) * 1000) / displayedPeaks.length;
      const top = center - maximum * halfHeight;
      const bottom = center - minimum * halfHeight;
      return `M${x.toFixed(1)} ${top.toFixed(1)}V${bottom.toFixed(1)}`;
    }).join('');
  }, [waveform]);

  if (recording.waveformStatus === 'failed') {
    return (
      <div className="flex h-14 items-center justify-between gap-3 text-xs text-amber-200">
        <span>Waveform processing failed.</span>
        <button
          type="button"
          className="shrink-0 underline underline-offset-2 disabled:opacity-50"
          disabled={retrying}
          onClick={onRetry}
        >
          {retrying ? 'Retrying...' : 'Retry'}
        </button>
      </div>
    );
  }

  if (waveformQuery.isError) {
    return (
      <div className="flex h-14 items-center justify-between gap-3 text-xs text-amber-200">
        <span>Waveform is temporarily unavailable.</span>
        <button
          type="button"
          className="shrink-0 underline underline-offset-2"
          onClick={() => void waveformQuery.refetch()}
        >
          Try again
        </button>
      </div>
    );
  }

  if (recording.waveformStatus !== 'ready' || waveformQuery.isPending || !waveform) {
    const label = recording.waveformStatus !== 'ready'
      ? 'Waveform is processing'
      : 'Loading waveform';
    return (
      <div
        className="flex h-14 items-center text-xs text-slate-400"
        role="img"
        aria-label={label}
      >
        <span className="h-1 w-full overflow-hidden rounded bg-white/10">
          <span className="block h-full w-1/3 animate-pulse rounded bg-cyan-300/50" />
        </span>
        <span className="sr-only">{label}</span>
      </div>
    );
  }

  const clipId = `waveform-progress-${recording.id}`;
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={`${recording.title} playback position`}
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={Math.min(duration, Math.max(0, displayTime))}
      aria-valuetext={`${formatTime(displayTime)} of ${formatTime(duration)}`}
      className="group relative flex h-14 w-full cursor-pointer touch-none items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
      onPointerDown={(event) => {
        pointerId.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        seekFromPointer(event.currentTarget, event.clientX);
      }}
      onPointerMove={(event) => {
        if (pointerId.current === event.pointerId) {
          seekFromPointer(event.currentTarget, event.clientX);
        }
      }}
      onPointerUp={(event) => {
        if (pointerId.current === event.pointerId) {
          pointerId.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        pointerId.current = null;
      }}
      onKeyDown={(event) => {
        let nextTime = displayTime;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nextTime -= 5;
        else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nextTime += 5;
        else if (event.key === 'PageDown') nextTime -= 30;
        else if (event.key === 'PageUp') nextTime += 30;
        else if (event.key === 'Home') nextTime = 0;
        else if (event.key === 'End') nextTime = duration;
        else return;
        event.preventDefault();
        onSeek(Math.min(duration, Math.max(0, nextTime)));
      }}
    >
      <svg
        aria-hidden="true"
        className="h-full w-full overflow-visible"
        viewBox="0 0 1000 56"
        preserveAspectRatio="none"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={progress * 1000} height="56" />
          </clipPath>
        </defs>
        <line
          x1="0"
          x2="1000"
          y1="28"
          y2="28"
          stroke="#475569"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1="0"
          x2={progress * 1000}
          y1="28"
          y2="28"
          stroke={isActive ? '#67e8f9' : '#3b82f6'}
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <path d={peakPath} fill="none" stroke="#64748b" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <path
          d={peakPath}
          fill="none"
          stroke={isActive ? '#67e8f9' : '#3b82f6'}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          clipPath={`url(#${clipId})`}
        />
        <line
          x1={progress * 1000}
          x2={progress * 1000}
          y1="1"
          y2="55"
          stroke="#fff"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="sr-only">
        {formatTime(displayTime)} of {formatTime(duration)}
      </span>
    </div>
  );
}

export default RecordingWaveform;
