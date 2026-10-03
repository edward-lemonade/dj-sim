import { useAuth, useUser } from '@clerk/react';
import { Download, Pause, Play, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { RecordingsAPI, type Recording } from '@/lib/api/RecordingsAPI';
import { joinRoomByCode } from '@/lib/api/RoomsAPI';
import {
  PENDING_ROOM_CODE_KEY,
  createdRoomFromJoin,
  normalizeRoomCode,
  readSessionValue,
  roomCodeInputError,
  roomJoinErrorMessage,
  writeSessionValue,
} from '@/lib/utils/joinRoom';

const ROOM_CODE_LENGTH = 6;

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
  const { user } = useUser();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [digits, setDigits] = useState<string[]>(() => Array(ROOM_CODE_LENGTH).fill(''));
  const joinCode = digits.join('');
  const digitRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
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
    if (!error) return;
    showToast(error, 'error', {
      dedupeKey: 'home-recordings',
      actions: recordings.length === 0
        ? [{
            label: 'Retry',
            onClick: () => {
              setLoading(true);
              setError(null);
              void loadRecordings();
            },
          }]
        : undefined,
    });
  }, [error, loadRecordings, recordings.length, showToast]);

  useEffect(() => {
    if (joinError) showToast(joinError, 'error', { dedupeKey: 'home-room-join' });
  }, [joinError, showToast]);

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

  useEffect(() => {
    const saved = normalizeRoomCode(readSessionValue(PENDING_ROOM_CODE_KEY));
    if (saved) {
      setDigits(Array.from({ length: ROOM_CODE_LENGTH }, (_, i) => saved[i] ?? ''));
    }
  }, []);

  const fillDigitsFrom = (index: number, raw: string) => {
    const chars = raw.replace(/\D/g, '').split('').slice(0, ROOM_CODE_LENGTH - index);
    if (chars.length === 0) return;
    const next = [...digits];
    chars.forEach((char, offset) => {
      next[index + offset] = char;
    });
    setDigits(next);
    setJoinError(null);
    digitRefs.current[Math.min(index + chars.length, ROOM_CODE_LENGTH - 1)]?.focus();
  };

  const handleDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    if (!digit) {
      const next = [...digits];
      next[index] = '';
      setDigits(next);
      setJoinError(null);
      return;
    }
    fillDigitsFrom(index, digit);
  };

  const handleDigitKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      event.preventDefault();
      const next = [...digits];
      next[index - 1] = '';
      setDigits(next);
      setJoinError(null);
      digitRefs.current[index - 1]?.focus();
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      digitRefs.current[index - 1]?.focus();
    } else if (event.key === 'ArrowRight' && index < ROOM_CODE_LENGTH - 1) {
      event.preventDefault();
      digitRefs.current[index + 1]?.focus();
    }
  };

  const launchStudio = async () => {
    const code = normalizeRoomCode(joinCode);

    // No room code entered: just open the studio
    if (!code) {
      navigate('/studio');
      return;
    }

    const validation = roomCodeInputError(joinCode);
    if (validation) {
      setJoinError(validation);
      return;
    }
    setJoinError(null);
    if (!isLoaded) return;
    if (!isSignedIn) {
      writeSessionValue(PENDING_ROOM_CODE_KEY, code);
      navigate(`/login?redirect=${encodeURIComponent('/')}`);
      return;
    }
    setJoining(true);
    try {
      const joined = await joinRoomByCode(code, user?.imageUrl ?? '');
      writeSessionValue(PENDING_ROOM_CODE_KEY, '');
      navigate('/studio', { state: { roomSession: createdRoomFromJoin(joined, code) } });
    } catch (cause) {
      showToast(roomJoinErrorMessage(cause), 'error', { dedupeKey: 'home-room-join' });
    } finally {
      setJoining(false);
    }
  };

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
      showToast('Recording download started.', 'success');
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
      showToast('Recording renamed.', 'success');
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
      showToast('Recording deleted.', 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete this recording.');
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden md:flex-row">
      <section className="relative flex min-h-80 items-center justify-center overflow-hidden py-16 md:w-[60%] md:py-0 md:[clip-path:polygon(0_0,100%_0,73.33%_100%,0_100%)]">
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(135deg,#030720_0%,#07135e_55%,#0d2a9e_100%)]" />
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(rgba(147,197,253,.22)_1.5px,transparent_1.5px)] bg-[length:16px_16px] [mask-image:linear-gradient(to_bottom_left,black,transparent_70%)]" />
        <div aria-hidden className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-[#02040a] via-[#02040a]/50 to-transparent" />
        <span aria-hidden className="pointer-events-none absolute -bottom-10 -left-6 select-none text-[22rem] font-black italic leading-none text-transparent [-webkit-text-stroke:2px_rgba(147,197,253,.12)]">
          DJ
        </span>
        <div className="relative z-10 flex flex-col items-center gap-5">
          <form
            className="flex w-[min(24rem,92vw)] flex-col items-center gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void launchStudio();
            }}
          >
            <button
              type="submit"
              disabled={joining}
              className="group relative -skew-x-[16deg] border-2 border-cyan-300/70 bg-[#0a1a7a] px-12 py-7 shadow-[10px_10px_0_#020617] transition hover:-translate-y-1 hover:shadow-[16px_16px_0_#020617] focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-white disabled:opacity-70"
            >
              <span className="flex skew-x-[16deg] items-center gap-5 text-white">
                <Play className="size-14 fill-current transition-transform group-hover:scale-110" />
                <span className="text-6xl font-black italic tracking-tight">
                  {joining ? 'Joining...' : 'Studio'}
                </span>
              </span>
            </button>

            <div className="flex w-full flex-col items-center gap-2">
              <div
                role="group"
                aria-labelledby="home-room-code-label"
                className="flex items-center justify-center gap-3"
              >
                <span id="home-room-code-label" className="whitespace-nowrap text-sm font-medium text-cyan-100">
                  Room Code:
                </span>
                <div className="flex items-center gap-1.5">
                  {digits.map((digit, index) => (
                    <div
                      key={index}
                      className="h-11 w-8 -skew-x-[16deg] bg-black/40 transition-colors focus-within:bg-blue-900/70"
                    >
                      <input
                        ref={(element) => {
                          digitRefs.current[index] = element;
                        }}
                        aria-label={`Room code digit ${index + 1}`}
                        aria-describedby={joinError ? 'home-room-code-error' : undefined}
                        inputMode="numeric"
                        autoComplete="off"
                        spellCheck={false}
                        disabled={joining}
                        className="block h-full w-full skew-x-[16deg] bg-transparent text-center font-mono text-xl font-bold text-white outline-none"
                        value={digit}
                        onChange={(event) => handleDigitChange(index, event.target.value)}
                        onKeyDown={(event) => handleDigitKeyDown(index, event)}
                        onFocus={(event) => event.target.select()}
                        onPaste={(event) => {
                          event.preventDefault();
                          fillDigitsFrom(index, event.clipboardData.getData('text'));
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
              {joinError && (
                <p id="home-room-code-error" aria-live="polite" className="text-sm text-red-300">
                  {joinError}
                </p>
              )}
            </div>
          </form>
        </div>
      </section>

      <div aria-hidden className="pointer-events-none absolute inset-0 z-10 hidden md:block">
        <div className="absolute inset-0 bg-white/70 [clip-path:polygon(59%_0,61%_0,45%_100%,43%_100%)]" />
        <div className="absolute inset-0 bg-cyan-400/80 [clip-path:polygon(61%_0,61.6%_0,45.6%_100%,45%_100%)]" />
      </div>

      <section
        aria-labelledby="recordings-title"
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#02040a] md:-ml-[16%] md:w-[56%] md:flex-none md:[clip-path:polygon(28.57%_0,100%_0,100%_100%,0_100%)]"
      >
        <div aria-hidden className="absolute inset-0 bg-[repeating-linear-gradient(115deg,transparent_0_22px,rgba(56,213,255,.05)_22px_24px)]" />
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_85%_100%,rgba(29,91,255,.22),transparent_55%)]" />

        <div className="relative flex min-h-0 flex-1 flex-col px-6 py-10 md:px-0 md:py-14 md:[clip-path:polygon(31.57%_0,100%_0,100%_100%,3%_100%)]">
          {isSignedIn && (
            <div className="mb-4 flex shrink-0 items-center justify-between gap-4 md:pl-[32%] md:pr-10">
              <h1 id="recordings-title" className="text-4xl font-black italic tracking-tight text-white">Past sessions</h1>
              <span className="-skew-x-[16deg] bg-blue-900/70 px-3 py-1 text-sm font-bold text-cyan-200">
                <span className="block skew-x-[16deg]">{recordings.length} recordings</span>
              </span>
            </div>
          )}
          {!isLoaded || (isSignedIn && loading) ? (
            <p className="py-6 text-center text-sm text-slate-400" role="status">Loading recordings...</p>
          ) : !isSignedIn ? (
            <div className="flex flex-1 flex-col items-center justify-center py-6 text-center md:pl-[32%] md:pr-10">
              <p className="text-sm text-slate-400">Log in or register to see and save your sets.</p>
              <div className="mt-6 flex items-center justify-center gap-4">
                <Link
                  to="/login"
                  className="-skew-x-[16deg] border-2 border-cyan-300/70 px-8 py-3 font-bold italic text-white transition hover:bg-white/10"
                >
                  <span className="block skew-x-[16deg]">Login</span>
                </Link>
                <Link
                  to="/register"
                  className="-skew-x-[16deg] border-2 border-cyan-300/70 bg-[#0a1a7a] px-8 py-3 font-bold italic text-white shadow-[6px_6px_0_#020617] transition hover:-translate-y-0.5 hover:shadow-[9px_9px_0_#020617]"
                >
                  <span className="block skew-x-[16deg]">Register</span>
                </Link>
              </div>
            </div>
          ) : error && recordings.length === 0 ? (
            <div className="py-4 text-center">
              <p className="text-sm text-slate-400">Recordings are temporarily unavailable.</p>
            </div>
          ) : recordings.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              No recordings yet. Recorded sets will appear here.
            </p>
          ) : (
            <ul className="min-h-0 max-h-[28rem] flex-1 space-y-2 overflow-y-auto py-6 [mask-image:linear-gradient(to_bottom,transparent,black_1.5rem,black_calc(100%-1.5rem),transparent)] [scrollbar-width:none] md:max-h-none md:pr-28 md:[transform:skewX(-16deg)] [&::-webkit-scrollbar]:hidden">
              {recordings.map((recording) => (
                <li key={recording.id}>
                  <div
                    className={`flex flex-wrap items-center gap-3 px-4 py-3 transition-colors md:pl-[25%] [clip-path:polygon(0_0,100%_0,calc(100%-14px)_100%,0_100%)] ${
                      playingId === recording.id
                        ? 'bg-blue-900'
                        : 'bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    <div className="min-w-0 flex-1 md:[transform:skewX(16deg)]">
                      {editingId === recording.id ? (
                        <form
                          id="rename-form"
                          className="h-6"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void saveRename(recording);
                          }}
                        >
                          <input
                            autoFocus
                            aria-label="Recording title"
                            className="h-6 w-full rounded border border-white/20 bg-black/30 px-2 text-sm text-white"
                            maxLength={200}
                            value={draftTitle}
                            onChange={(event) => setDraftTitle(event.target.value)}
                          />
                        </form>
                      ) : (
                        <button
                          type="button"
                          className="max-w-full cursor-text truncate text-left text-base font-bold italic text-white hover:underline"
                          onClick={() => {
                            setDraftTitle(recording.title);
                            setEditingId(recording.id);
                          }}
                          aria-label={`Rename ${recording.title}`}
                        >
                          {recording.title}
                        </button>
                      )}
                      <p className="mt-1 text-xs text-slate-300">
                        {new Date(recording.createdAt).toLocaleString()} · {formatDuration(recording.durationSeconds)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 md:[transform:skewX(16deg)]">
                      {editingId === recording.id ? (
                        <>
                          <Button type="submit" form="rename-form" size="sm">Save</Button>
                          <Button type="button" variant="ghost" size="sm" className="text-white" onClick={() => setEditingId(null)}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-white"
                            disabled={loadingAudioId === recording.id}
                            aria-label={playingId === recording.id ? `Pause ${recording.title}` : `Play ${recording.title}`}
                            onClick={() => void togglePlayback(recording)}
                          >
                            {playingId === recording.id ? <Pause /> : <Play />}
                            {loadingAudioId === recording.id ? 'Loading...' : playingId === recording.id ? 'Pause' : 'Play'}
                          </Button>
                          <Button type="button" variant="ghost" size="icon-sm" className="text-white" aria-label={`Download ${recording.title}`} onClick={() => void downloadRecording(recording)}>
                            <Download />
                          </Button>
                          <Button type="button" variant="ghost" size="icon-sm" className="text-white" aria-label={`Delete ${recording.title}`} onClick={() => void deleteRecording(recording)}>
                            <Trash2 />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <audio
            ref={audioRef}
            className="hidden"
            onEnded={() => setPlayingId(null)}
            onError={() => {
              if (audioRef.current?.getAttribute('src')) setError('Could not load this recording.');
            }}
          />
        </div>
      </section>
    </div>
  );
}

export default HomePage;