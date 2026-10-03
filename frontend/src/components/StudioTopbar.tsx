import { Circle, Copy, Eye, Home, LoaderCircle, Radio, Square, Users } from 'lucide-react';
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
  collabRoom,
  collabBusy,
  collabError,
  onCreateRoom,
  onLeaveRoom,
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
  onLeaveRoom: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [collabOpen, setCollabOpen] = useState(false);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [leavingRoom, setLeavingRoom] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const exitBusyLabel = recordingStatus === RecordingStatus.Recording
    || recordingStatus === RecordingStatus.Saving
    || hasPendingSave
    ? 'Saving recording...'
    : collabRoom
      ? 'Leaving room...'
      : 'Exiting...';

  const confirmExit = async () => {
    setExiting(true);
    const saved = await onStopAndSave();
    if (saved && collabRoom) {
      try {
        await onLeaveRoom();
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
        {collabRoom ? (
          <div className="flex min-w-0 items-center gap-2">
            {collabRoom.members && collabRoom.members.length > 0 && (
              <span
                role="img"
                aria-label={`Room members: ${collabRoom.members.map((member) => member.username).filter(Boolean).join(', ')}`}
                className="flex shrink-0 items-center pl-1"
              >
                {collabRoom.members.slice(0, 3).map((member, index) => (
                  member.avatarUrl ? (
                    <img
                      key={`${member.username}-${index}`}
                      src={member.avatarUrl}
                      alt=""
                      className="-ml-2 size-6 rounded-full border bg-slate-800 object-cover first:ml-0"
                    />
                  ) : (
                    <span
                      key={`${member.username}-${index}`}
                      aria-hidden="true"
                      className="-ml-2 grid size-6 place-items-center rounded-full border text-[10px] font-semibold first:ml-0"
                    >
                      {member.username.slice(0, 1).toUpperCase() || '?'}
                    </span>
                  )
                ))}
              </span>
            )}
            {collabRoom.code && (
              <span className="font-mono text-xs tracking-[0.2em]" aria-label={`${collabRoom.visibility} room code ${collabRoom.code}`}>
                {collabRoom.code}
              </span>
            )}
            <Button type="button" size="sm" className={controlHover} onClick={() => setCollabOpen(true)}>
              <Users className="text-sky-400" />
              Room
            </Button>
          </div>
        ) : (
          <Button type="button" size="sm" className={controlHover} onClick={() => setCollabOpen(true)}>
            <Users className="text-sky-400" />
            Collab
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
        busyLabel={exitBusyLabel}
        onNo={() => setConfirmOpen(false)}
        onYes={() => void confirmExit()}
      />
      <Dialog open={collabOpen} onOpenChange={setCollabOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{collabRoom ? 'Collaborative room' : 'Create a room'}</DialogTitle>
            <DialogDescription>
              {collabRoom
                ? 'Share this six-digit code with someone you want to invite.'
                : 'Create a public room listed in Community or a private room joined by code.'}
            </DialogDescription>
          </DialogHeader>
          {collabRoom ? (
            <div className="grid gap-3">
              <p className="text-sm text-muted-foreground">
                {collabRoom.visibility === 'public' ? 'Public room' : 'Private room'} · up to {collabRoom.capacity} members
              </p>
              {collabRoom.code ? (
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span className="font-mono text-lg tracking-[0.25em]" aria-label={`Room code ${collabRoom.code}`}>
                    {collabRoom.code}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
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
                <p className="text-sm text-muted-foreground">
                  Invite code is shown after it is issued to this session.
                </p>
              )}
              <p role="status" className="text-xs text-muted-foreground">
                Connected to the shared room. Access all members' tracks below.
              </p>
              {collabError && <p role="alert" className="text-sm text-red-400">{collabError}</p>}
              <DialogFooter>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={leavingRoom}
                  onClick={() => {
                    setLeavingRoom(true);
                    void onLeaveRoom().then(() => setCollabOpen(false)).finally(() => setLeavingRoom(false));
                  }}
                >
                  {leavingRoom ? 'Leaving...' : 'Leave room'}
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
                <legend className="mb-1 text-sm font-medium">Room visibility</legend>
                <label className="flex items-center gap-2 rounded-md border px-3 py-2">
                  <input
                    type="radio"
                    name="room-visibility"
                    value="public"
                    checked={visibility === 'public'}
                    onChange={() => setVisibility('public')}
                  />
                  <span>Public — listed in Community</span>
                </label>
                <label className="flex items-center gap-2 rounded-md border px-3 py-2">
                  <input
                    type="radio"
                    name="room-visibility"
                    value="private"
                    checked={visibility === 'private'}
                    onChange={() => setVisibility('private')}
                  />
                  <span>Private — join by code only</span>
                </label>
              </fieldset>
              <p className="text-xs text-slate-400">Any member can start a stream from the room.</p>
              {collabError && <p role="alert" className="text-sm text-red-400">{collabError}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCollabOpen(false)} disabled={collabBusy}>
                  Cancel
                </Button>
                <Button type="submit" disabled={collabBusy}>
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