import { useEffect, useState } from 'react';
import { Home, LoaderCircle, RotateCw } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { ControlSelectionProvider } from '@/components/ControlSelection';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ToastVariant } from '@/components/ui/toast';
import { TrackLibraryStatus, type Track } from '@/lib/types/Track';
import { CDJ } from '@/components/CDJ';
import { Mixer } from '@/components/Mixer';
import { StudioConsoleLayout } from '@/components/StudioConsoleLayout';
import { getStudioDeckLayout } from '@/lib/utils/studioGrid';
import { DECK_IDS, DeckId } from '@/hooks/useAudioEngine';
import {
  StreamConnectionStatus,
  StreamDeckId,
  StreamPopupKind,
  type StreamDeckSnapshot,
} from '@/lib/types/Stream';
import { createInitialStudioSnapshot } from './studioState';
import { useStreamViewer } from './useStreamConnection';

function toViewTrack(track: StreamDeckSnapshot['track']): Track | null {
  if (!track) return null;
  return {
    ...track,
    duration: `${Math.floor(track.durationSeconds / 60)}:${String(Math.floor(track.durationSeconds % 60)).padStart(2, '0')}`,
    coverLabel: '',
    coverUrl: track.coverUrl,
    libraryStatus: TrackLibraryStatus.Ready,
  };
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function StreamPage() {
  const { streamId = '' } = useParams();
  const navigate = useNavigate();
  const stream = useStreamViewer(streamId);
  const { status, error, connect, session, needsAudioGesture, playAudio } = stream;
  const { showToast } = useToast();
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (status !== StreamConnectionStatus.Error) return;
    showToast(error ?? 'Could not connect to this stream.', ToastVariant.Error, {
      dedupeKey: `stream-viewer-${streamId}`,
      actions: [
        { label: 'Reconnect', onClick: () => void connect() },
        { label: 'Community', onClick: () => navigate('/community') },
      ],
    });
  }, [connect, error, navigate, showToast, status, streamId]);

  useEffect(() => {
    if (status === StreamConnectionStatus.Ended) {
      showToast('This stream has ended.', ToastVariant.Info, {
        dedupeKey: `stream-ended-${streamId}`,
        duration: 8000,
        actions: [{ label: 'Back to Community', onClick: () => navigate('/community') }],
      });
    }
  }, [navigate, showToast, status, streamId]);

  useEffect(() => {
    if (session && status === StreamConnectionStatus.Joining) {
      showToast('Reconnecting to stream...', ToastVariant.Info, {
        dedupeKey: `stream-reconnecting-${streamId}`,
        duration: 2500,
      });
    }
  }, [session, showToast, status, streamId]);

  useEffect(() => {
    if (needsAudioGesture) {
      showToast('Audio playback needs your permission.', ToastVariant.Info, {
        dedupeKey: `stream-audio-${streamId}`,
        duration: 12000,
        actions: [{ label: 'Play stream', onClick: playAudio }],
      });
    }
  }, [needsAudioGesture, playAudio, showToast, streamId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);

  if (stream.status === StreamConnectionStatus.Ended && !stream.session) {
    return (
      <main className="flex h-svh flex-col items-center justify-center gap-4 bg-[#0b0d10] text-center text-zinc-100">
        <h1 className="text-2xl font-semibold">This stream has ended</h1>
        <Button variant="ghost" onClick={() => navigate('/community')}>Back to Community</Button>
      </main>
    );
  }

  if (!stream.session) {
    return (
      <main className="grid h-svh place-items-center bg-[#0b0d10] text-zinc-300">
        {stream.status === StreamConnectionStatus.Error ? (
          <div className="text-center">
            <div className="mt-4 flex justify-center gap-2">
              <Button onClick={() => void stream.connect()}><RotateCw /> Retry</Button>
              <Button variant="ghost" onClick={() => navigate('/community')}>Back to Community</Button>
            </div>
          </div>
        ) : <p role="status"><LoaderCircle className="mr-2 inline animate-spin" />Joining stream...</p>}
      </main>
    );
  }

  const snapshot = stream.snapshot ?? createInitialStudioSnapshot();
  const elapsedSeconds = Math.max(0, Math.floor((now - Date.parse(stream.session.startedAt)) / 1000));
  const masterId = snapshot.mixer.tempoMaster;
  const bpmForDeck = (id: DeckId) => {
    const deck = snapshot.decks[id === DeckId.A ? StreamDeckId.A : StreamDeckId.B];
    const baseBpm = deck.track?.bpm ?? 0;
    return baseBpm * (1 + snapshot.mixer.channelState[id].tempo / 100);
  };
  const masterBpm = masterId === null ? 0 : bpmForDeck(masterId);
  const automationBpm = masterBpm > 0 ? masterBpm : DECK_IDS.map(bpmForDeck).find((bpm) => bpm > 0) ?? 0;

  const { leftDeckIds, rightDeckIds, gridTemplateColumns } = getStudioDeckLayout(DECK_IDS);
  const renderDeck = (id: DeckId) => {
    const deck = snapshot.decks[id === DeckId.A ? StreamDeckId.A : StreamDeckId.B];
    const track = toViewTrack(deck.track);
    return (
      <CDJ
        key={id}
        deckId={id}
        label={id}
        engine={null}
        readOnlyState={{
          ...deck,
          capturedAt: snapshot.capturedAt,
          currentTime: deck.positionSeconds,
        }}
        track={track}
        tracks={track ? [track] : []}
        onLoadTrack={() => undefined}
        tempo={snapshot.mixer.channelState[id].tempo}
        onTempoChange={() => undefined}
        syncMaster={masterId === id}
        onSyncMasterChange={() => undefined}
        tempoFollowing={masterId !== null && masterId !== id && masterBpm > 0 && (deck.track?.bpm ?? 0) > 0}
        sharedBeatsPerView={snapshot.beatsPerView}
        showZoomControls={false}
        onSharedZoomBy={() => undefined}
        onBeatCountChange={() => undefined}
        onPatch={async () => undefined}
      />
    );
  };

  return (
    <ControlSelectionProvider bpm={automationBpm}>
      <main className="relative h-svh overflow-hidden bg-[#0b0d10] text-zinc-100">
        <StudioConsoleLayout
          className="h-full bg-[#0b0d10]"
          readOnly
          gridTemplateColumns={gridTemplateColumns}
          topbar={
            <header className="flex min-h-8 shrink-0 items-center gap-2 border-b bg-[#0b0d10] px-2 py-1">
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Back to Community" onClick={() => navigate('/community')}>
                <Home />
              </Button>
              {stream.session.avatarUrl
                ? <img src={stream.session.avatarUrl} alt="" className="size-7 rounded-full object-cover" />
                : <div aria-hidden="true" className="grid size-7 place-items-center rounded-full bg-fuchsia-600 text-xs font-bold">{stream.session.username.slice(0, 1).toUpperCase()}</div>}
              <span className="text-sm font-medium">{stream.session.username}</span>
              <span className="truncate text-sm text-zinc-300">{stream.session.name}</span>
              <span className="ml-auto shrink-0 text-xs tabular-nums text-zinc-400">
                {status === StreamConnectionStatus.Ended ? 'Ended' : `Live · ${formatTime(elapsedSeconds)}`}
              </span>
            </header>
          }
          leftDecks={leftDeckIds.map(renderDeck)}
          rightDecks={rightDeckIds.map(renderDeck)}
          mixer={
            <Mixer
              state={snapshot.mixer}
              onChannelChange={() => undefined}
              onFxChange={() => undefined}
              onMasterChange={() => undefined}
            />
          }
        >
          {snapshot.pointer && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute z-40 size-4 rounded-full border-2 border-white bg-rose-400 shadow-[0_0_12px_rgba(251,113,133,.9)]"
              style={{ left: `${snapshot.pointer.x * 100}%`, top: `${snapshot.pointer.y * 100}%` }}
            />
          )}
          {snapshot.popup?.kind === StreamPopupKind.TrackPicker && (
            <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 z-40 w-72 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-white/15 bg-[#161a20] p-4 shadow-2xl">
              <p className="text-xs uppercase tracking-wider text-zinc-500">Deck {snapshot.popup.deck} · Track picker</p>
              <p className="mt-2 text-sm text-zinc-300">The streamer is choosing a track.</p>
            </div>
          )}
        </StudioConsoleLayout>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-70 border-[3px] border-transparent"
          style={{ borderImage: 'linear-gradient(to bottom right, #d946ef, #fb923c, #22d3ee) 1' }}
        />
      </main>
    </ControlSelectionProvider>
  );
}

export default StreamPage;
