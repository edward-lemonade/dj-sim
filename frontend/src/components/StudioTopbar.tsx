import { Circle, Copy, Eye, Home, Info, LoaderCircle, Radio, Square, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ExitConfirmModal } from '@/components/ExitConfirmModal';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CreatedRoom } from '@/lib/types/Room';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useToast } from '@/components/ui/toast';

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
  collabRoom,
  collabBusy,
  collabError,
  onCreateRoom,
  onEndRoom,
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
  collabRoom: CreatedRoom | null;
  collabBusy: boolean;
  collabError: string | null;
  onCreateRoom: (visibility: 'public' | 'private') => Promise<void>;
  onEndRoom: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [collabOpen, setCollabOpen] = useState(false);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [endingRoom, setEndingRoom] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const exitBusyLabel = recordingStatus === RecordingStatus.Recording
    || recordingStatus === RecordingStatus.Saving
    || hasPendingSave
    ? 'Saving recording...'
    : collabRoom
      ? 'Ending room...'
      : 'Exiting...';

  useEffect(() => {
    if (recordingError) {
      showToast(recordingError, 'error', {
        dedupeKey: 'studio-recording',
        actions: hasPendingSave ? [{ label: 'Retry save', onClick: () => void onRetrySave() }] : undefined,
      });
    }
  }, [hasPendingSave, onRetrySave, recordingError, showToast]);

  useEffect(() => {
    if (streamError) showToast(streamError, 'error', { dedupeKey: 'studio-stream' });
  }, [showToast, streamError]);

  useEffect(() => {
    if (collabError) showToast(collabError, 'error', { dedupeKey: 'studio-collaboration' });
  }, [collabError, showToast]);

  const confirmExit = async () => {
    setExiting(true);
    const saved = await onStopAndSave();
    if (saved && collabRoom) {
      try {
        await onEndRoom();
      } catch {
        setExiting(false);
        return;
      }
    }
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
          <Button
            type="button"
            variant="destructive"
            color="purple"
            size="sm"
            aria-label={`Stop streaming, ${streamViewerCount} ${streamViewerCount === 1 ? 'viewer' : 'viewers'}`}
            onClick={onStopStream}
          >
            <Square />
            Stop streaming
            <span className="ml-1 inline-flex items-center gap-1 tabular-nums" aria-hidden="true">
              <Eye />
              {streamViewerCount}
            </span>
          </Button>
        ) : (
          <Button type="button" size="sm" className={controlHover} onClick={onStartStream}>
            <Radio className="text-purple-500" /> Stream
          </Button>
        )}
        {collabRoom ? (
          <Button type="button" variant="destructive" color="sky" size="sm" onClick={() => setCollabOpen(true)}>
            <Info />
            Room
            {collabRoom.members && collabRoom.members.length > 0 && (
              <span
                role="img"
                aria-label={`Room members: ${collabRoom.members.map((member) => member.username).filter(Boolean).join(', ')}`}
                className="ml-1 flex shrink-0 items-center"
              >
                {collabRoom.members.map((member, index) => (
                  member.avatarUrl ? (
                    <img
                      key={`${member.username}-${index}`}
                      src={member.avatarUrl}
                      alt=""
                      className="-ml-1.5 size-5 rounded-full border bg-slate-800 object-cover first:ml-0"
                    />
                  ) : (
                    <span
                      key={`${member.username}-${index}`}
                      aria-hidden="true"
                      className="-ml-1.5 grid size-5 place-items-center rounded-full border bg-slate-800 text-[9px] font-semibold first:ml-0"
                    >
                      {member.username.slice(0, 1).toUpperCase() || '?'}
                    </span>
                  )
                ))}
              </span>
            )}
          </Button>
        ) : (
          <Button type="button" size="sm" className={controlHover} onClick={() => setCollabOpen(true)}>
            <Users className="text-sky-400" />
            Collab
          </Button>
        )}
      </header>
      <ExitConfirmModal
        open={confirmOpen}
        busy={exiting}
        busyLabel={exitBusyLabel}
        onNo={() => setConfirmOpen(false)}
        onYes={() => void confirmExit()}
      />
      <Dialog open={collabOpen} onOpenChange={setCollabOpen}>
        <DialogContent className="max-w-md border border-white/10 bg-[#101419] text-zinc-100 shadow-[0_24px_80px_rgba(0,0,0,.65)] ring-white/10 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold tracking-tight text-white">
              {collabRoom ? 'Collaborative room' : 'Create a room'}
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              {collabRoom
                ? 'Share this six-digit code with someone you want to invite.'
                : 'Create a public room listed in Community or a private room joined by code.'}
            </DialogDescription>
          </DialogHeader>
          {collabRoom ? (
            <div className="grid gap-3">
              <p className="text-sm text-zinc-400">
                {collabRoom.visibility === 'public' ? 'Public room' : 'Private room'} · up to {collabRoom.capacity} members
              </p>
              {collabRoom.code ? (
                <div className="flex items-center justify-between rounded-lg border border-cyan-300/20 bg-[#080b10] px-3 py-2">
                  <span className="font-mono text-lg tracking-[0.25em] text-cyan-100" aria-label={`Room code ${collabRoom.code}`}>
                    {collabRoom.code}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-white/15 bg-white/5 text-zinc-100 hover:bg-white/10 hover:text-white"
                    onClick={() => {
                      void navigator.clipboard.writeText(collabRoom.code).then(() => {
                        setCopiedCode(true);
                        window.setTimeout(() => setCopiedCode(false), 1500);
                      });
                    }}
                  >
                    <Copy />
                    {copiedCode ? 'Copied' : 'Copy code'}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-zinc-400">
                  Invite code is shown after it is issued to this session.
                </p>
              )}
              <p role="status" className="text-xs text-zinc-400">
                Connected to the shared room. Access all members' tracks below.
              </p>
              <DialogFooter className="border-white/10 bg-[#0b0e13]">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={endingRoom}
                  onClick={() => {
                    setEndingRoom(true);
                    void onEndRoom().then(() => setCollabOpen(false)).finally(() => setEndingRoom(false));
                  }}
                >
                  {endingRoom ? 'Ending room...' : 'End room'}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void onCreateRoom(visibility);
              }}
            >
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-semibold text-zinc-200">Room visibility</legend>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-[#0b0e13] px-3 py-2.5 text-sm text-zinc-200 transition-colors hover:border-cyan-300/30 hover:bg-white/5">
                  <input
                    type="radio"
                    name="room-visibility"
                    value="public"
                    checked={visibility === 'public'}
                    onChange={() => setVisibility('public')}
                    className="accent-cyan-400"
                  />
                  <span>Public — listed in Community</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-[#0b0e13] px-3 py-2.5 text-sm text-zinc-200 transition-colors hover:border-cyan-300/30 hover:bg-white/5">
                  <input
                    type="radio"
                    name="room-visibility"
                    value="private"
                    checked={visibility === 'private'}
                    onChange={() => setVisibility('private')}
                    className="accent-cyan-400"
                  />
                  <span>Private — join by code only</span>
                </label>
              </fieldset>
              <p className="text-xs text-slate-400">Any member can start a stream from the room.</p>
              <DialogFooter className="border-white/10 bg-[#0b0e13]">
                <Button
                  type="button"
                  variant="outline"
                  className="border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white"
                  onClick={() => setCollabOpen(false)}
                  disabled={collabBusy}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={collabBusy} className="bg-cyan-400 text-slate-950 hover:bg-cyan-300">
                  {collabBusy ? <LoaderCircle className="animate-spin" /> : <Users />}
                  {collabBusy ? 'Connecting...' : 'Create room'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}