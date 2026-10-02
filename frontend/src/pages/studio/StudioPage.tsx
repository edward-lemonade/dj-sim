import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { useBlocker } from 'react-router-dom';
import { CDJ } from '../../components/CDJ';
import { Mixer } from '@/components/Mixer';
import { StudioTopbar } from '@/components/StudioTopbar';
import { StudioConsoleLayout } from '@/components/StudioConsoleLayout';
import { getStudioDeckLayout } from '@/lib/utils/studioGrid';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { clamp, DECK_IDS, DeckId } from '../../hooks/useAudioEngine';
import { useTrackLibrary } from '@/hooks/useTrackLibrary';
import { MAX_PLAYER_ZOOM, MIN_PLAYER_ZOOM } from '@/hooks/useTrackPlayer';
import type { Track } from '@/lib/types/Track';
import type { StreamDeckSnapshot } from '@/lib/types/Stream';
import { ControlSelectionProvider } from '@/components/ControlSelection';
import { useStudioRecording } from '../../hooks/useStudioRecording';
import { createStream } from '@/lib/api/StreamsAPI';
import { useStreamPublisher } from '@/pages/streams/useStreamConnection';
import { createInitialStudioSnapshot, reduceStudioSnapshot } from '@/pages/streams/studioState';

// Matches the tempo slider's range in CDJ
const TEMPO_RANGE_PERCENT = 50;
const ABSOLUTE_MIN_BEATS_PER_VIEW = 0.01;
const ABSOLUTE_MAX_BEATS_PER_VIEW = 65536;

function parseTrackDuration(value: string): number {
  const parts = value.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function toStreamTrack(track: Track): StreamDeckSnapshot['track'] {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    bpm: track.bpm,
    beatOffset: track.beatOffset,
    key: track.key,
    durationSeconds: parseTrackDuration(track.duration),
    cues: [...(track.cues ?? [])],
    waveformOverview: track.waveformOverview,
  };
}

function StudioPage() {
  const { user } = useUser();
  const library = useTrackLibrary();
  const [studioState, dispatchStudio] = useReducer(
    reduceStudioSnapshot,
    undefined,
    createInitialStudioSnapshot,
  );
  const engine = useAudioEngine(studioState.mixer);
  const recording = useStudioRecording(engine);
  const { status: recordingStatus, hasPendingSave, stopAndSave } = recording;
  const shouldBlockExit = recordingStatus === 'recording' || (recordingStatus === 'error' && hasPendingSave);
  const navigationBlocker = useBlocker(shouldBlockExit);
  const autoSaveNavigation = useRef(false);
  const loadedTrackIds = useMemo<Record<DeckId, string | null>>(() => ({
    [DeckId.A]: studioState.decks.A.track?.id ?? null,
    [DeckId.B]: studioState.decks.B.track?.id ?? null,
  }), [studioState.decks]);
  const [deckBeatCounts, setDeckBeatCounts] = useState<Record<DeckId, number | null>>({
    [DeckId.A]: null,
    [DeckId.B]: null,
  });
  const [streamStartError, setStreamStartError] = useState<string | null>(null);
  const lastPointerUpdate = useRef(0);
  const mixerState = studioState.mixer;
  const setChannel = useCallback((id: DeckId, patch: Partial<typeof mixerState.channelState[DeckId.A]>) => {
    dispatchStudio({
      action: 'mixer-change',
      value: {
        ...mixerState,
        channelState: { ...mixerState.channelState, [id]: { ...mixerState.channelState[id], ...patch } },
      },
    });
  }, [mixerState]);
  const setFx = useCallback((patch: Partial<typeof mixerState.fx>) => {
    dispatchStudio({ action: 'mixer-change', value: { ...mixerState, fx: { ...mixerState.fx, ...patch } } });
  }, [mixerState]);
  const setMaster = useCallback((value: number) => {
    dispatchStudio({ action: 'mixer-change', value: { ...mixerState, master: value } });
  }, [mixerState]);
  const setTempoMaster = useCallback((id: DeckId | null) => {
    dispatchStudio({ action: 'mixer-change', value: { ...mixerState, tempoMaster: id } });
  }, [mixerState]);

  const loadedBeatCounts = DECK_IDS
    .map((id) => deckBeatCounts[id])
    .filter((count): count is number => count !== null);
  const minBeatsPerView = loadedBeatCounts.length
    ? Math.max(ABSOLUTE_MIN_BEATS_PER_VIEW, Math.max(...loadedBeatCounts) / MAX_PLAYER_ZOOM)
    : ABSOLUTE_MIN_BEATS_PER_VIEW;
  const maxBeatsPerView = loadedBeatCounts.length
    ? Math.min(ABSOLUTE_MAX_BEATS_PER_VIEW, Math.min(...loadedBeatCounts) / MIN_PLAYER_ZOOM)
    : ABSOLUTE_MAX_BEATS_PER_VIEW;

  const reportDeckBeatCount = useCallback((id: DeckId, count: number | null) => {
    setDeckBeatCounts((current) => current[id] === count ? current : { ...current, [id]: count });
  }, []);

  const adjustWaveformZoom = useCallback((factor: number) => {
    const next = Math.min(maxBeatsPerView, Math.max(minBeatsPerView, studioState.beatsPerView * factor));
    dispatchStudio({ action: 'waveform-view', value: next });
  }, [maxBeatsPerView, minBeatsPerView, studioState.beatsPerView]);

  useEffect(() => {
    const next = Math.min(maxBeatsPerView, Math.max(minBeatsPerView, studioState.beatsPerView));
    dispatchStudio({ action: 'waveform-view', value: next });
  }, [maxBeatsPerView, minBeatsPerView, studioState.beatsPerView]);

  useEffect(() => {
    const shouldAutoSave =
      recordingStatus === 'recording' || (recordingStatus === 'error' && hasPendingSave);
    if (navigationBlocker.state !== 'blocked' || !shouldAutoSave || autoSaveNavigation.current) return;
    autoSaveNavigation.current = true;
    void stopAndSave().then((saved) => {
      if (saved) navigationBlocker.proceed();
      else navigationBlocker.reset();
    }).finally(() => {
      autoSaveNavigation.current = false;
    });
  }, [navigationBlocker, hasPendingSave, recordingStatus, stopAndSave]);

  // Auto-load the first N ready tracks into the N decks, in DECK_IDS order.
  useEffect(() => {
    const next = library.songs.filter((song) => song.libraryStatus === 'ready');
    DECK_IDS.forEach((id, index) => {
      const deck = id === DeckId.A ? 'A' : 'B';
      const currentTrackId = loadedTrackIds[id];
      if (currentTrackId) {
        const currentTrack = library.songs.find((song) => song.id === currentTrackId);
        if (!currentTrack) return;
        const updatedTrack = toStreamTrack(currentTrack);
        if (JSON.stringify(studioState.decks[deck].track) !== JSON.stringify(updatedTrack)) {
          dispatchStudio({ action: 'track-load', deck, value: updatedTrack });
        }
      } else if (next[index]) {
        dispatchStudio({ action: 'track-load', deck, value: toStreamTrack(next[index]) });
      }
    });
  }, [library.songs, loadedTrackIds, studioState.decks]);

  const trackBpm = useCallback(
    (id: DeckId) => library.songs.find((song) => song.id === loadedTrackIds[id])?.bpm ?? 0,
    [library.songs, loadedTrackIds],
  );

  const reportTransport = useCallback((id: DeckId, next: { playing: boolean; positionSeconds: number; durationSeconds: number; rate: number }) => {
      const previous = studioState.decks[id === DeckId.A ? 'A' : 'B'];
      if (
        previous.playing === next.playing &&
        Math.abs(previous.positionSeconds - next.positionSeconds) < 0.2 &&
        Math.abs(previous.durationSeconds - next.durationSeconds) < 0.1 &&
        previous.rate === next.rate
      ) return;
      dispatchStudio({
        action: 'transport',
        deck: id === DeckId.A ? 'A' : 'B',
        value: next,
      });
  }, [studioState.decks]);

  const streaming = useStreamPublisher(engine, studioState);
  const { start: startStream, stop: stopStream } = streaming;
  const avatarUrl = user?.imageUrl ?? '';

  const startStreaming = useCallback(async () => {
    if (!engine) return;
    const name = window.prompt('Name your stream');
    if (name === null) return;
    setStreamStartError(null);
    try {
      const connection = await createStream(name, avatarUrl);
      await startStream(connection, engine);
    } catch (cause) {
      setStreamStartError(cause instanceof Error ? cause.message : 'Could not start streaming.');
    }
  }, [engine, startStream, avatarUrl]);

  const stopStreaming = useCallback(() => {
    if (window.confirm('Stop streaming? Viewers will be told the stream has ended.')) {
      void stopStream().catch((cause: unknown) => {
        console.error('Failed to stop stream', cause);
      });
    }
  }, [stopStream]);

  const masterId = studioState.mixer.tempoMaster;
  const effectiveDeckBpm = (id: DeckId) => trackBpm(id) * (1 + studioState.mixer.channelState[id].tempo / 100);
  const masterBpm = masterId === null ? 0 : effectiveDeckBpm(masterId);
  const automationBpm = masterBpm > 0 ? masterBpm : DECK_IDS.map(effectiveDeckBpm).find((bpm) => bpm > 0) ?? 0;
  const isFollowing = (id: DeckId) => masterId !== null && id !== masterId && masterBpm > 0 && trackBpm(id) > 0;

  // Followers match the master's effective BPM (track BPM with its tempo applied)
  useEffect(() => {
    if (masterId === null || masterBpm <= 0) return;
    DECK_IDS.forEach((id) => {
      const bpm = trackBpm(id);
      if (id === masterId || bpm <= 0) return;
      const target = clamp((masterBpm / bpm - 1) * 100, -TEMPO_RANGE_PERCENT, TEMPO_RANGE_PERCENT);
      if (Math.abs(target - studioState.mixer.channelState[id].tempo) > 0.001) {
        setChannel(id, { tempo: target });
      }
    });
  }, [masterId, masterBpm, trackBpm, studioState.mixer.channelState, setChannel]);

  // Web Audio requires a user gesture before it will actually produce sound.
  // Resume on the first pointerdown anywhere in the studio, once.
  const resumed = useRef(false);
  useEffect(() => {
    const handler = () => {
      if (resumed.current) return;
      resumed.current = true;
      void engine.resume();
    };
    window.addEventListener('pointerdown', handler);
    return () => window.removeEventListener('pointerdown', handler);
  }, [engine]);

  const ready = library.songs.filter((song) => song.libraryStatus === 'ready');

  const { leftDeckIds, rightDeckIds, gridTemplateColumns } = getStudioDeckLayout();

  const renderDeck = (id: DeckId) => (
    <CDJ
      key={id}
      deckId={id}
      label={id}
      engine={engine}
      track={library.songs.find((song) => song.id === loadedTrackIds[id]) ?? null}
      tracks={ready}
      onLoadTrack={(trackId: string) => {
        const track = library.songs.find((song) => song.id === trackId);
        dispatchStudio({ action: 'track-load', deck: id === DeckId.A ? 'A' : 'B', value: track ? toStreamTrack(track) : null });
      }}
      onPatch={library.patchTrack}
      tempo={studioState.mixer.channelState[id].tempo}
      onTempoChange={(value) => setChannel(id, { tempo: value })}
      syncMaster={masterId === id}
      onSyncMasterChange={(on) => setTempoMaster(on ? id : null)}
      tempoFollowing={isFollowing(id)}
      sharedBeatsPerView={studioState.beatsPerView}
      showZoomControls={id === DeckId.A}
      onSharedZoomBy={adjustWaveformZoom}
      onBeatCountChange={reportDeckBeatCount}
      onTransportUpdate={reportTransport}
      onPopupChange={(deckId, open) => dispatchStudio({
        action: 'popup',
        value: open ? { kind: 'track-picker', deck: deckId === DeckId.A ? 'A' : 'B' } : null,
      })}
    />
  );

  return (
    <ControlSelectionProvider bpm={automationBpm}>
      <StudioConsoleLayout
        className="h-svh bg-[#0b0d10]"
        topbar={
          <StudioTopbar
            recordingStatus={recording.status}
            recordingError={recording.error}
            hasPendingSave={recording.hasPendingSave}
            onStartRecording={() => void recording.start()}
            onStopAndSave={recording.stopAndSave}
            onRetrySave={recording.retrySave}
            onDiscard={recording.discard}
            streamLive={streaming.live}
            streamViewerCount={streaming.viewerCount}
            streamError={streamStartError ?? streaming.error}
            onStartStream={() => void startStreaming()}
            onStopStream={stopStreaming}
          />
        }
        leftDecks={leftDeckIds.map(renderDeck)}
        rightDecks={rightDeckIds.map(renderDeck)}
        mixer={
          <Mixer
            state={studioState.mixer}
            onChannelChange={setChannel}
            onFxChange={setFx}
            onMasterChange={setMaster}
          />
        }
        gridTemplateColumns={gridTemplateColumns}
        onPointerMove={(event) => {
          const now = performance.now();
          if (now - lastPointerUpdate.current < 50) return;
          lastPointerUpdate.current = now;
          const bounds = event.currentTarget.getBoundingClientRect();
          dispatchStudio({ action: 'pointer', value: {
            x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
            y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
          } });
        }}
      />
    </ControlSelectionProvider>
  );
}

export default StudioPage;