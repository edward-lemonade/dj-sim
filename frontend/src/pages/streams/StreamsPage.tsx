import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Radio, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listStreams } from '@/lib/api/StreamsAPI';
import type { ListedStream } from '@/lib/types/Stream';

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
  const [streams, setStreams] = useState<ListedStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const current = await listStreams();
      setStreams(current);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load streams.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
          <h1 className="mt-1 text-3xl font-semibold text-white">Streams</h1>
          <p className="mt-2 text-sm text-slate-400">Watch DJs perform live in the studio.</p>
        </div>
        <Button variant="outline" size="icon" aria-label="Refresh streams" disabled={refreshing} onClick={() => void refresh()}>
          <RefreshCw />
        </Button>
      </div>

      {loading ? (
        <p role="status" className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-slate-300">Loading streams...</p>
      ) : error ? (
        <section role="alert" className="rounded-2xl border border-rose-400/30 bg-rose-950/30 p-8 text-center">
          <p className="text-rose-100">{error}</p>
          <Button className="mt-4" variant="outline" onClick={() => window.location.reload()}>Try again</Button>
        </section>
      ) : streams.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/3 px-6 py-16 text-center">
          <Radio className="mx-auto size-8 text-slate-500" />
          <h2 className="mt-3 text-lg font-medium text-white">No active streams</h2>
          <p className="mt-1 text-sm text-slate-400">Live sets will show up here when someone starts streaming.</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {streams.map((stream) => (
            <li key={stream.id}>
              <Link
                to={`/streams/${stream.id}`}
                className="group grid min-h-44 grid-cols-2 overflow-hidden rounded-2xl border border-white/10 bg-white/4 transition hover:border-rose-300/50 hover:bg-white/[0.07]"
              >
                <div className="flex min-w-0 flex-col p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    {stream.avatarUrl ? (
                      <img src={stream.avatarUrl} alt="" className="size-11 shrink-0 rounded-full border border-white/15 object-cover" />
                    ) : (
                      <div aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-linear-to-br from-fuchsia-500 to-orange-400 font-semibold text-white">
                        {stream.username.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <p className="truncate font-medium text-white">{stream.username}</p>
                  </div>
                  <h2 className="mt-3 truncate text-lg font-semibold text-white group-hover:text-rose-100">{stream.name}</h2>
                  <p className="mt-auto flex items-center gap-1.5 pt-3 text-sm tabular-nums text-slate-400">
                    <Eye className="size-4" />
                    {durationLabel(stream.startedAt, now)}
                  </p>
                </div>
                <div className="min-h-0 min-w-0 p-3">
                  <span
                    role="img"
                    aria-label="Loaded track covers"
                    className="grid h-full min-h-0 min-w-0 grid-cols-2 overflow-hidden rounded-full border border-white/20 bg-white/5"
                  >
                    {stream.coverArts.map((cover, index) => (
                      <span
                        key={index}
                        className="relative min-h-0 min-w-0 overflow-hidden border-r border-white/20 last:border-r-0"
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
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default StreamsPage;
