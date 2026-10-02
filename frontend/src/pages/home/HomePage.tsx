import { useAuth } from '@clerk/react';
import { Download, Pause, Play, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { RecordingsAPI, type Recording } from '@/lib/api/RecordingsAPI';

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function HomePage() {
  const { isLoaded, isSignedIn } = useAuth();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const loadRecordings = useCallback(async () => {
    try {
      const items = await RecordingsAPI.list();
      setRecordings(items);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your recordings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let active = true;
    const fetchRecordings = async () => {
      try {
        const items = await RecordingsAPI.list();
        if (active) {
          setRecordings(items);
          setError(null);
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Could not load your recordings.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void fetchRecordings();
    return () => {
      active = false;
    };
  }, [isLoaded, isSignedIn]);

  const stopPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setPlayingId(null);
    setLoadingAudioId(null);
  }, []);

  useEffect(() => () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  const togglePlayback = async (recording: Recording) => {
    const audio = audioRef.current;
    if (!audio) return;
    setError(null);
    if (playingId === recording.id) {
      audio.pause();
      setPlayingId(null);
      return;
    }
    if (audioUrlRef.current && audio.dataset.recordingId === recording.id) {
      try {
        await audio.play();
        setPlayingId(recording.id);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not play this recording.');
      }
      return;
    }

    setLoadingAudioId(recording.id);
    try {
      stopPlayback();
      setLoadingAudioId(recording.id);
      const blob = await RecordingsAPI.audio(recording.id);
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      audio.dataset.recordingId = recording.id;
      audio.src = url;
      await audio.play();
      setPlayingId(recording.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not play this recording.');
    } finally {
      setLoadingAudioId(null);
    }
  };

  const downloadRecording = async (recording: Recording) => {
    setError(null);
    try {
      const blob = await RecordingsAPI.download(recording.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${recording.title}.mp3`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not download this recording.');
    }
  };

  const saveRename = async (recording: Recording) => {
    const title = draftTitle.trim();
    if (!title) {
      setError('Recording title cannot be empty.');
      return;
    }
    if (title === recording.title) {
      setEditingId(null);
      return;
    }
    setError(null);
    try {
      const updated = await RecordingsAPI.updateTitle(recording.id, title);
      setRecordings((current) => current.map((item) => item.id === updated.id ? updated : item));
      setEditingId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not rename this recording.');
    }
  };

  const deleteRecording = async (recording: Recording) => {
    if (!window.confirm(`Delete "${recording.title}"? This cannot be undone.`)) return;
    setError(null);
    try {
      await RecordingsAPI.remove(recording.id);
      if (playingId === recording.id) stopPlayback();
      setRecordings((current) => current.filter((item) => item.id !== recording.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete this recording.');
    }
  };

  return (
    <main className="mx-auto w-full max-w-4xl space-y-8 pt-4">
      <section className="flex justify-center">
        <Link
          to="/studio"
          className="inline-flex h-11 items-center gap-2 rounded-full bg-slate-900 px-5 text-white hover:bg-slate-800"
        >
          <Play className="size-4 fill-current" />
          Enter Studio
        </Link>
      </section>

      <section aria-labelledby="recordings-title" className="rounded-xl border border-white/10 bg-[#0c111b]/80 p-5">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h1 id="recordings-title" className="text-lg font-semibold text-white">Your recordings</h1>
          <span className="text-sm text-slate-400">{recordings.length} sets</span>
        </div>
        {!isLoaded || (isSignedIn && loading) ? (
          <p className="py-6 text-center text-sm text-slate-400" role="status">Loading recordings...</p>
        ) : !isSignedIn ? (
          <p className="py-6 text-center text-sm text-slate-400">
            <Link className="text-white underline" to="/login">Sign in</Link> to see and save your sets.
          </p>
        ) : error && recordings.length === 0 ? (
          <div className="py-4 text-center">
            <p className="text-sm text-red-300" role="alert">{error}</p>
            <Button
              className="mt-3"
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true);
                void loadRecordings();
              }}
            >
              Try again
            </Button>
          </div>
        ) : recordings.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            No recordings yet. Recorded sets will appear here.
          </p>
        ) : (
          <ul className="divide-y divide-white/10">
            {recordings.map((recording) => (
              <li key={recording.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  {editingId === recording.id ? (
                    <form
                      className="flex flex-wrap items-center gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveRename(recording);
                      }}
                    >
                      <input
                        autoFocus
                        aria-label="Recording title"
                        className="h-8 min-w-40 flex-1 rounded border border-white/20 bg-black/30 px-2 text-sm text-white"
                        maxLength={200}
                        value={draftTitle}
                        onChange={(event) => setDraftTitle(event.target.value)}
                      />
                      <Button type="submit" size="sm">Save</Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="max-w-full truncate text-left text-sm font-medium text-white hover:underline"
                      onClick={() => {
                        setDraftTitle(recording.title);
                        setEditingId(recording.id);
                      }}
                      aria-label={`Rename ${recording.title}`}
                    >
                      {recording.title}
                    </button>
                  )}
                  <p className="mt-1 text-xs text-slate-400">
                    {new Date(recording.createdAt).toLocaleString()} · {formatDuration(recording.durationSeconds)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={loadingAudioId === recording.id}
                    aria-label={playingId === recording.id ? `Pause ${recording.title}` : `Play ${recording.title}`}
                    onClick={() => void togglePlayback(recording)}
                  >
                    {playingId === recording.id ? <Pause /> : <Play />}
                    {loadingAudioId === recording.id ? 'Loading...' : playingId === recording.id ? 'Pause' : 'Play'}
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Download ${recording.title}`} onClick={() => void downloadRecording(recording)}>
                    <Download />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${recording.title}`} onClick={() => void deleteRecording(recording)}>
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {error && recordings.length > 0 && <p className="mt-3 text-sm text-red-300" role="alert">{error}</p>}
        <audio
          ref={audioRef}
          className="hidden"
          onEnded={() => setPlayingId(null)}
          onError={() => {
            if (audioRef.current?.getAttribute('src')) setError('Could not load this recording.');
          }}
        />
      </section>
    </main>
  );
}

export default HomePage;
