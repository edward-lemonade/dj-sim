import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useUser } from '@clerk/react';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
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
} from '@/lib/utils/joinRoom';

function durationLabel(startedAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

const ROW_CLIP = '[clip-path:polygon(0_0,100%_0,calc(100%-14px)_100%,0_100%)]';
const LIST_BASE =
  'min-h-0 max-h-[24rem] flex-1 space-y-2 overflow-y-auto py-6 [mask-image:linear-gradient(to_bottom,transparent,black_1.5rem,black_calc(100%-1.5rem),transparent)] [scrollbar-width:none] md:max-h-none [&::-webkit-scrollbar]:hidden';
const LIST_SKEW = `${LIST_BASE} md:[transform:skewX(-16deg)]`;
const UNSKEW = 'md:[transform:skewX(16deg)]';

function CommunityPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { showToast } = useToast();
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
    await Promise.all([refreshStreams(), refreshRooms()]);
  }, [refreshRooms, refreshStreams]);

  const retryStreams = useCallback(() => {
    setStreamsLoading(true);
    setStreamsError(null);
    void refreshStreams();
  }, [refreshStreams]);

  const retryRooms = useCallback(() => {
    setRoomsLoading(true);
    setRoomsError(null);
    void refreshRooms();
  }, [refreshRooms]);

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
    if (!streamsError) return;
    showToast(streamsError, 'error', {
      dedupeKey: 'community-streams-load',
      actions: [{ label: 'Retry', onClick: retryStreams }],
    });
  }, [retryStreams, showToast, streamsError]);

  useEffect(() => {
    if (!roomsError) return;
    showToast(roomsError, 'error', {
      dedupeKey: 'community-rooms-load',
      actions: [{ label: 'Retry', onClick: retryRooms }],
    });
  }, [retryRooms, roomsError, showToast]);

  useEffect(() => {
    if (joinError) showToast(joinError, 'error', { dedupeKey: 'community-room-join' });
  }, [joinError, showToast]);

  useEffect(() => {
    if (roomClosed) showToast('Room closed. Choose another live stream or public room.', 'info', { dedupeKey: 'community-room-closed' });
  }, [roomClosed, showToast]);

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
    <main className="relative flex h-full min-h-0 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
      <h1 className="sr-only">Community</h1>
      {/* Left: streams. Header on top, list below. */}
      <section
        aria-labelledby="live-streams-title"
        className="relative flex min-h-80 flex-col overflow-hidden px-6 py-10 md:w-[58%] md:px-0 md:py-14 md:[clip-path:polygon(0_0,100%_0,72.41%_100%,0_100%)]"
      >
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(135deg,#030720_0%,#07135e_55%,#0d2a9e_100%)]" />
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(rgba(147,197,253,.22)_1.5px,transparent_1.5px)] bg-[length:16px_16px] [mask-image:linear-gradient(to_bottom_left,black,transparent_70%)]" />
        <div aria-hidden className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-[#02040a] via-[#02040a]/50 to-transparent" />
        <span aria-hidden className="pointer-events-none absolute -bottom-10 -left-6 select-none text-[20rem] font-black italic leading-none text-transparent [-webkit-text-stroke:2px_rgba(147,197,253,.10)]">
          LIVE
        </span>
        <div aria-hidden className="absolute -left-20 top-1/3 size-72 animate-pulse rounded-full bg-blue-500/25 blur-3xl" />

        {/* The whole column is skewed so its right edge runs parallel to the divider; content is un-skewed inside. */}
        <div className="relative z-10 flex min-h-0 flex-1 flex-col md:pl-[9vw] md:[transform:skewX(-16deg)]">
          <SectionHeader
            id="live-streams-title"
            title="Live streams"
            count={`${streams.length} live`}
            className="md:items-end md:pr-[calc(9vw+1.5rem)] md:[transform:skewX(16deg)]"
          />
          {streamsLoading ? (
            <div className={`flex flex-1 items-center justify-center py-8 text-center md:-ml-[9vw] md:w-[50vw] ${UNSKEW}`}>
              <p className="text-5xl font-black italic tracking-tight text-white/40">Loading...</p>
            </div>
          ) : streamsError ? (
            <div className={`py-6 text-center md:pr-[calc(9vw+1.5rem)] ${UNSKEW}`}>
              <p className="text-sm text-slate-300">Streams are temporarily unavailable.</p>
            </div>
          ) : streams.length === 0 ? (
            <div className={`flex flex-1 items-center justify-center py-8 text-center md:-ml-[9vw] md:w-[50vw] ${UNSKEW}`}>
              <p className="text-5xl font-black italic tracking-tight text-white/40">No active streams</p>
            </div>
          ) : (
            <ul className={LIST_BASE}>
              {streams.map((stream) => (
                <li key={stream.id}>
                  <Link
                    to={`/streams/${stream.id}`}
                    className="group flex items-center gap-4 bg-white/5 px-4 py-3 transition-colors hover:bg-white/10 md:pr-[calc(9vw+1.5rem)]"
                  >
                    <div className={`flex min-w-0 flex-1 items-center gap-4 ${UNSKEW}`}>
                      {stream.room ? (
                        <MemberAvatars members={stream.room.members} />
                      ) : stream.avatarUrl ? (
                        <img src={stream.avatarUrl} alt="" className="size-11 shrink-0 rounded-full border object-cover" />
                      ) : (
                        <div aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-linear-to-br from-fuchsia-500 to-orange-400 font-semibold text-white">
                          {stream.username.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-base font-bold italic text-white group-hover:underline">{stream.name}</h3>
                        <p className="truncate text-xs text-slate-300">
                          {stream.room ? memberNames(stream.room.members) || 'Room members' : stream.username}
                        </p>
                        <p className="mt-1 flex items-center gap-1.5 text-xs tabular-nums text-slate-400">
                          <Eye className="size-3.5" />
                          {durationLabel(stream.startedAt, now)}
                        </p>
                      </div>
                      <CoverDisc coverArts={stream.coverArts} label="Loaded stream track covers" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Diagonal divider, same as the home page. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-10 hidden md:block">
        <div className="absolute inset-0 bg-white/70 [clip-path:polygon(57%_0,59%_0,43%_100%,41%_100%)]" />
        <div className="absolute inset-0 bg-cyan-400/80 [clip-path:polygon(59%_0,59.6%_0,43.6%_100%,43%_100%)]" />
      </div>

      {/* Right: rooms. List on top, header at the bottom. */}
      <section
        aria-labelledby="public-rooms-title"
        className="relative flex min-h-80 flex-col overflow-hidden bg-[#02040a] md:-ml-[16%] md:w-[58%] md:flex-none md:[clip-path:polygon(27.59%_0,100%_0,100%_100%,0_100%)]"
      >
        <div aria-hidden className="absolute inset-0 bg-[repeating-linear-gradient(115deg,transparent_0_22px,rgba(56,213,255,.05)_22px_24px)]" />
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_85%_100%,rgba(29,91,255,.22),transparent_55%)]" />

        <div className="relative flex min-h-0 flex-1 flex-col px-6 py-10 md:px-0 md:py-14 md:[clip-path:polygon(30.49%_0,100%_0,100%_100%,2.9%_100%)]">
          <SectionHeader
            id="public-rooms-title"
            title="Public rooms"
            count={`${rooms.length} open`}
            className="md:pl-[33%] md:pr-10"
          />

          {roomsLoading ? (
            <div className="flex flex-1 items-center justify-center py-8 text-center md:ml-[9vw] md:w-[49vw]">
              <p className="text-5xl font-black italic tracking-tight text-white/40">Loading...</p>
            </div>
          ) : roomsError ? (
            <div className="flex-1 py-6 text-center md:pl-[32%] md:pr-10">
              <p className="text-sm text-slate-300">Public rooms are temporarily unavailable.</p>
            </div>
          ) : rooms.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-8 text-center md:ml-[9vw] md:w-[49vw]">
              <p className="text-5xl font-black italic tracking-tight text-white/40">No public rooms yet</p>
            </div>
          ) : (
            <ul className={`${LIST_SKEW} md:pr-28`}>
              {rooms.map((room) => {
                const full = room.memberCount >= room.capacity;
                const joining = joiningRoomId === room.id;
                return (
                  <li key={room.id}>
                    <div
                      className={`flex flex-wrap items-center gap-3 px-4 py-3 transition-colors bg-white/5 hover:bg-white/10 md:pl-[25%] ${ROW_CLIP}`}
                    >
                      <div className={`flex min-w-0 flex-1 items-center gap-4 ${UNSKEW}`}>
                        <MemberAvatars members={room.members} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-base font-bold italic text-white" title={memberNames(room.members) || undefined}>
                            {memberNames(room.members) || 'Room members'}
                          </p>
                          <p className="mt-1 text-xs tabular-nums text-slate-300">
                            Public room · {room.memberCount}/{room.capacity} members
                          </p>
                        </div>
                        <CoverDisc coverArts={room.coverArts} label="Loaded room track covers" />
                      </div>
                      <div className={`flex items-center ${UNSKEW}`}>
                        <Button
                          type="button"
                          size="sm"
                          disabled={full || joining || !isLoaded}
                          aria-disabled={full}
                          title={full ? 'Room full' : undefined}
                          onClick={() => void joinListedRoom(room)}
                        >
                          {joining ? 'Joining...' : full ? 'Room full' : 'Join room'}
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

        </div>
      </section>
    </main>
  );
}

function SectionHeader({
  id,
  title,
  count,
  className = '',
}: {
  id: string;
  title: string;
  count: string;
  className?: string;
}) {
  return (
    <div className={`flex shrink-0 flex-col items-start gap-2 ${className}`}>
      <span className="-skew-x-[16deg] bg-blue-900/70 px-3 py-1 text-sm font-bold text-cyan-200">
        <span className="block skew-x-[16deg]">{count}</span>
      </span>
      <h2 id={id} className="text-4xl font-black italic leading-none tracking-tight text-white">
        {title}
      </h2>
    </div>
  );
}

function memberNames(members: ListedRoom['members'] | ListedStreamRoom['members']): string {
  return members.map((member) => member.username).filter(Boolean).join(', ');
}

function MemberAvatars({ members }: { members: ListedRoom['members'] | ListedStreamRoom['members'] }) {
  const usernames = memberNames(members);

  return (
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
  );
}

function CoverDisc({ coverArts, label }: { coverArts: [string | null, string | null]; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="grid size-14 shrink-0 grid-cols-2 overflow-hidden rounded-full border bg-white/5"
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
  );
}

export default CommunityPage;