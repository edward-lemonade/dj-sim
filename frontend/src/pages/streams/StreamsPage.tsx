import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useUser } from '@clerk/react';
import { Eye, Radio, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listStreams } from '@/lib/api/StreamsAPI';
import { joinPublicRoom, listRooms } from '@/lib/api/RoomsAPI';
import type { ListedRoom } from '@/lib/types/Room';
import type { ListedStream, ListedStreamRoom } from '@/lib/types/Stream';
import {
  PENDING_PUBLIC_ROOM_KEY,
  createdRoomFromJoin,
  readSessionValue,
  roomJoinErrorMessage,
  writeSessionValue,
} from '@/lib/rooms/join';

function durationLabel(startedAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function StreamsPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const [streams, setStreams] = useState<ListedStream[]>([]);
  const [rooms, setRooms] = useState<ListedRoom[]>([]);
  const [streamsLoading, setStreamsLoading] = useState(true);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [streamsError, setStreamsError] = useState<string | null>(null);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const roomClosed = Boolean((location.state as { roomClosed?: boolean } | null)?.roomClosed);
  const pendingJoinRef = useRef(false);

  const refreshStreams = useCallback(async () => {
    try {
      const current = await listStreams();
      setStreams(current);
      setStreamsError(null);
    } catch (cause) {
      setStreamsError(cause instanceof Error ? cause.message : 'Could not load streams.');
    } finally {
      setStreamsLoading(false);
    }
  }, []);

  const refreshRooms = useCallback(async () => {
    try {
      const current = await listRooms();
      setRooms(current);
      setRoomsError(null);
    } catch (cause) {
      setRoomsError(cause instanceof Error ? cause.message : 'Could not load public rooms.');
    } finally {
      setRoomsLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refreshStreams(), refreshRooms()]);
    setRefreshing(false);
  }, [refreshRooms, refreshStreams]);

  const joinListedRoom = useCallback(async (room: ListedRoom) => {
    setJoinError(null);
    if (!isLoaded) return;
    if (!isSignedIn) {
      writeSessionValue(PENDING_PUBLIC_ROOM_KEY, room.id);
      navigate(`/login?redirect=${encodeURIComponent('/community')}`);
      return;
    }
    if (room.memberCount >= room.capacity) {
      setJoinError('Room full');
      return;
    }
    setJoiningRoomId(room.id);
    try {
      const joined = await joinPublicRoom(room.id, user?.imageUrl ?? '');
      writeSessionValue(PENDING_PUBLIC_ROOM_KEY, '');
      navigate('/studio', { state: { roomSession: createdRoomFromJoin(joined) } });
    } catch (cause) {
      setJoinError(roomJoinErrorMessage(cause));
    } finally {
      setJoiningRoomId(null);
    }
  }, [isLoaded, isSignedIn, navigate, user?.imageUrl]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || pendingJoinRef.current) return;
    const pendingId = readSessionValue(PENDING_PUBLIC_ROOM_KEY);
    if (!pendingId) return;
    pendingJoinRef.current = true;
    setJoiningRoomId(pendingId);
    void joinPublicRoom(pendingId, user?.imageUrl ?? '')
      .then((joined) => {
        writeSessionValue(PENDING_PUBLIC_ROOM_KEY, '');
        navigate('/studio', { state: { roomSession: createdRoomFromJoin(joined) } });
      })
      .catch((cause: unknown) => {
        writeSessionValue(PENDING_PUBLIC_ROOM_KEY, '');
        setJoinError(roomJoinErrorMessage(cause));
      })
      .finally(() => {
        setJoiningRoomId(null);
      });
  }, [isLoaded, isSignedIn, navigate, user?.imageUrl]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void refresh(), 0);
    const poll = window.setInterval(() => void refresh(), 10000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [refresh]);

  return (
    <main className="mx-auto w-full max-w-4xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-rose-300">Live now</p>
          <h1 className="mt-1 text-3xl font-semibold text-white">Community</h1>
          <p className="mt-2 text-sm text-slate-400">Watch live sets and find a room to mix together.</p>
        </div>
        <Button variant="outline" size="icon" aria-label="Refresh community" disabled={refreshing} onClick={() => void refresh()}>
          <RefreshCw />
        </Button>
      </div>
      {roomClosed && (
        <p role="status" className="mb-6 rounded-2xl border bg-white/5 px-4 py-3 text-sm text-white">
          Room closed. Choose another live stream or public room below.
        </p>
      )}
      {joinError && (
        <p role="alert" className="mb-6 rounded-2xl border bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
          {joinError}
        </p>
      )}

      <section aria-labelledby="live-streams-title">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="live-streams-title" className="text-xl font-semibold text-white">Live streams</h2>
          <span className="text-sm text-slate-400">{streams.length} live</span>
        </div>
        {streamsLoading ? (
          <p role="status" className="rounded-2xl border bg-white/5 p-8 text-center text-slate-300">Loading streams...</p>
        ) : streamsError ? (
          <section role="alert" className="rounded-2xl border bg-rose-950/30 p-8 text-center">
            <p className="text-rose-100">{streamsError}</p>
            <Button className="mt-4" variant="outline" onClick={() => void refreshStreams()}>Try again</Button>
          </section>
        ) : streams.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-white/3 px-6 py-10 text-center">
            <Radio className="mx-auto size-8 text-slate-500" />
            <h3 className="mt-3 text-lg font-medium text-white">No active streams</h3>
            <p className="mt-1 text-sm text-slate-400">Live sets will show up here when someone starts streaming.</p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {streams.map((stream) => (
              <li key={stream.id}>
                <Link
                  to={`/streams/${stream.id}`}
                  className="group grid min-h-44 grid-cols-2 overflow-hidden rounded-2xl border bg-white/4 transition hover:border-rose-300/50 hover:bg-white/[0.07]"
                >
                  <div className="flex min-w-0 flex-col p-4">
                    {stream.room ? (
                      <>
                        <MemberIdentity members={stream.room.members} />
                        <p className="mt-3 text-sm text-slate-300">
                          {stream.room.visibility === 'public' ? 'Public room' : 'Private room'}
                        </p>
                        {stream.room.visibility === 'public' && stream.room.code && (
                          <p className="mt-1 text-sm text-slate-400">Code: {stream.room.code}</p>
                        )}
                      </>
                    ) : (
                      <div className="flex min-w-0 items-center gap-3">
                        {stream.avatarUrl ? (
                          <img src={stream.avatarUrl} alt="" className="size-11 shrink-0 rounded-full border object-cover" />
                        ) : (
                          <div aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-linear-to-br from-fuchsia-500 to-orange-400 font-semibold text-white">
                            {stream.username.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <p className="truncate font-medium text-white">{stream.username}</p>
                      </div>
                    )}
                    <h3 className="mt-3 truncate text-lg font-semibold text-white group-hover:text-rose-100">{stream.name}</h3>
                    <p className="mt-auto flex items-center gap-1.5 pt-3 text-sm tabular-nums text-slate-400">
                      <Eye className="size-4" />
                      {durationLabel(stream.startedAt, now)}
                    </p>
                  </div>
                  <CoverDisc coverArts={stream.coverArts} label="Loaded stream track covers" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="public-rooms-title" className="mt-8">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="public-rooms-title" className="text-xl font-semibold text-white">Public rooms</h2>
          <span className="text-sm text-slate-400">{rooms.length} open</span>
        </div>
        {roomsLoading ? (
          <p role="status" className="rounded-2xl border bg-white/5 p-8 text-center text-slate-300">Loading public rooms...</p>
        ) : roomsError ? (
          <section role="alert" className="rounded-2xl border bg-rose-950/30 p-8 text-center">
            <p className="text-rose-100">{roomsError}</p>
            <Button className="mt-4" variant="outline" onClick={() => void refreshRooms()}>Try again</Button>
          </section>
        ) : rooms.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-white/3 px-6 py-10 text-center">
            <h3 className="text-lg font-medium text-white">No public rooms yet</h3>
            <p className="mt-1 text-sm text-slate-400">Public rooms will show up here when someone opens one.</p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {rooms.map((room) => {
              const full = room.memberCount >= room.capacity;
              const joining = joiningRoomId === room.id;
              return (
                <li key={room.id} className="grid min-h-44 grid-cols-2 overflow-hidden rounded-2xl border bg-white/4">
                  <div className="flex min-w-0 flex-col p-4">
                    <MemberIdentity members={room.members} />
                    <p className="mt-3 text-sm text-slate-300">Public room</p>
                    <p className="mt-auto pt-3 text-sm tabular-nums text-slate-400">
                      {room.memberCount}/{room.capacity} members
                    </p>
                    <Button
                      className="mt-3"
                      type="button"
                      disabled={full || joining || !isLoaded}
                      aria-disabled={full}
                      title={full ? 'Room full' : undefined}
                      onClick={() => void joinListedRoom(room)}
                    >
                      {joining ? 'Joining...' : full ? 'Room full' : 'Join room'}
                    </Button>
                  </div>
                  <CoverDisc coverArts={room.coverArts} label="Loaded room track covers" />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

function MemberIdentity({ members }: { members: ListedRoom['members'] | ListedStreamRoom['members'] }) {
  const usernames = members.map((member) => member.username).filter(Boolean).join(', ');

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span role="img" aria-label={usernames ? `Room members: ${usernames}` : 'Room members'} className="flex shrink-0 items-center pl-1">
        {members.slice(0, 3).map((member, index) => (
          member.avatarUrl ? (
            <img
              key={`${member.userId || member.username}-${index}`}
              src={member.avatarUrl}
              alt=""
              className="-ml-2 size-9 rounded-full border bg-slate-800 object-cover first:ml-0"
            />
          ) : (
            <span
              key={`${member.userId || member.username}-${index}`}
              aria-hidden="true"
              className="-ml-2 grid size-9 place-items-center rounded-full border bg-linear-to-br from-fuchsia-500 to-orange-400 text-sm font-semibold text-white first:ml-0"
            >
              {member.username.slice(0, 1).toUpperCase() || '?'}
            </span>
          )
        ))}
      </span>
      <p className="min-w-0 truncate font-medium text-white" title={usernames || undefined}>
        {usernames || 'Room members'}
      </p>
    </div>
  );
}

function CoverDisc({ coverArts, label }: { coverArts: [string | null, string | null]; label: string }) {
  return (
    <div className="min-h-0 min-w-0 p-3">
      <span
        role="img"
        aria-label={label}
        className="grid h-full min-h-0 min-w-0 grid-cols-2 overflow-hidden rounded-full border bg-white/5"
      >
        {coverArts.map((cover, index) => (
          <span
            key={index}
            className="relative min-h-0 min-w-0 overflow-hidden border-r last:border-r-0"
          >
            {cover ? (
              <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <span className="absolute inset-0 bg-linear-to-br from-zinc-700 to-zinc-900" />
            )}
          </span>
        ))}
      </span>
    </div>
  );
}

export default StreamsPage;
