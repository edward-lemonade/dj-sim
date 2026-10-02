import { Circle, Eye, Home, LoaderCircle, Radio, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ExitConfirmModal } from '@/components/ExitConfirmModal';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';

const RecordingStatus = {
  Idle: 'idle',
  Starting: 'starting',
  Recording: 'recording',
  Saving: 'saving',
  Error: 'error',
} as const;

type RecordingStatusValue = (typeof RecordingStatus)[keyof typeof RecordingStatus];

const controlHover = 'hover:bg-zinc-800 hover:text-zinc-300';

export function StudioTopbar({
  recordingStatus,
  recordingError,
  hasPendingSave,
  onStartRecording,
  onStopAndSave,
  onRetrySave,
  onDiscard,
  streamLive,
  streamViewerCount,
  streamError,
  onStartStream,
  onStopStream,
}: {
  recordingStatus: RecordingStatusValue;
  recordingError: string | null;
  hasPendingSave: boolean;
  onStartRecording: () => void;
  onStopAndSave: () => Promise<boolean>;
  onRetrySave: () => Promise<boolean>;
  onDiscard: () => void;
  streamLive: boolean;
  streamViewerCount: number;
  streamError: string | null;
  onStartStream: () => void;
  onStopStream: () => void;
}) {
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exiting, setExiting] = useState(false);

  const confirmExit = async () => {
    setExiting(true);
    const saved = await onStopAndSave();
    setExiting(false);
    if (!saved) return;
    setConfirmOpen(false);
    navigate('/');
  };

  return (
    <>
      <header className="flex min-h-8 shrink-0 items-center gap-2 border-b bg-[#0b0d10] px-2 py-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-zinc-300 hover:bg-zinc-800"
          aria-label="Exit studio"
          disabled={recordingStatus === RecordingStatus.Starting}
          onClick={() => setConfirmOpen(true)}
        >
          <Home />
        </Button>
        <div className="flex items-center gap-2">
          {recordingStatus === RecordingStatus.Recording ? (
            <Button type="button" variant="destructive" size="sm" onClick={() => void onStopAndSave()}>
              <Square />
              Stop recording
            </Button>
          ) : recordingStatus === RecordingStatus.Starting || recordingStatus === RecordingStatus.Saving ? (
            <Button type="button" size="sm" disabled aria-live="polite">
              <LoaderCircle className="animate-spin" />
              {recordingStatus === RecordingStatus.Starting ? 'Starting...' : 'Saving...'}
            </Button>
          ) : hasPendingSave ? (
            <>
              <Button type="button" size="sm" onClick={() => void onRetrySave()}>
                Retry save
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onDiscard}>
                Discard
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" className={controlHover} onClick={onStartRecording}>
              <Circle className="fill-red-500 text-red-500" />
              Record
            </Button>
          )}
        </div>
        {streamLive ? (
          <div className="flex items-center gap-2">
            <Button type="button" variant="destructive" size="sm" onClick={onStopStream}>
              <Radio /> Stop streaming
            </Button>
            <span className="inline-flex items-center gap-1.5 text-xs text-rose-200" aria-label={`${streamViewerCount} viewers`}>
              <Eye className="size-4" />
              <span>{streamViewerCount} {streamViewerCount === 1 ? 'viewer' : 'viewers'}</span>
            </span>
            <span role="status" className="rounded-full bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase text-rose-200">Live</span>
          </div>
        ) : (
          <Button type="button" size="sm" className={controlHover} onClick={onStartStream}>
            <Radio className="text-purple-500" /> Stream
          </Button>
        )}
        {recordingError && (
          <p role="alert" className="min-w-0 truncate text-xs text-red-300">
            {recordingError}
          </p>
        )}
        {streamError && <p role="alert" className="min-w-0 truncate text-xs text-red-300">{streamError}</p>}
      </header>
      <ExitConfirmModal
        open={confirmOpen}
        busy={exiting}
        onNo={() => setConfirmOpen(false)}
        onYes={() => void confirmExit()}
      />
    </>
  );
}