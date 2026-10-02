import { Circle, Home, LoaderCircle, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ExitConfirmModal } from '@/pages/studio/components/ExitConfirmModal';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';

type RecordingStatus = 'idle' | 'starting' | 'recording' | 'saving' | 'error';

export function StudioTopbar({
  recordingStatus,
  recordingError,
  hasPendingSave,
  onStartRecording,
  onStopAndSave,
  onRetrySave,
  onDiscard,
}: {
  recordingStatus: RecordingStatus;
  recordingError: string | null;
  hasPendingSave: boolean;
  onStartRecording: () => void;
  onStopAndSave: () => Promise<boolean>;
  onRetrySave: () => Promise<boolean>;
  onDiscard: () => void;
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
          disabled={recordingStatus === 'starting'}
          onClick={() => setConfirmOpen(true)}
        >
          <Home />
        </Button>
        <div className="flex items-center gap-2">
          {recordingStatus === 'recording' ? (
            <Button type="button" variant="destructive" size="sm" onClick={() => void onStopAndSave()}>
              <Square />
              Stop recording
            </Button>
          ) : recordingStatus === 'starting' || recordingStatus === 'saving' ? (
            <Button type="button" size="sm" disabled aria-live="polite">
              <LoaderCircle className="animate-spin" />
              {recordingStatus === 'starting' ? 'Starting...' : 'Saving...'}
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
            <Button type="button" size="sm" onClick={onStartRecording}>
              <Circle className="fill-red-500 text-red-500" />
              Record
            </Button>
          )}
        </div>
        {recordingError && (
          <p role="alert" className="min-w-0 truncate text-xs text-red-300">
            {recordingError}
          </p>
        )}
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
