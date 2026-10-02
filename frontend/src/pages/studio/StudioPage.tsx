import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { CDJ } from './components/CDJ';
import { Mixer } from '@/pages/studio/components/Mixer';
import { StudioTopbar } from '@/pages/studio/components/StudioTopbar';
import { useAudioEngine } from './useAudioEngine';
import { useMixerState } from './useMixerState';
import { clamp, DECK_IDS, DeckId } from './useAudioEngine';
import { useTrackLibrary } from '@/hooks/useTrackLibrary';
import { MAX_PLAYER_ZOOM, MIN_PLAYER_ZOOM } from '@/hooks/useTrackPlayer';
import { ControlSelectionProvider } from '@/components/ControlSelection';
import { useStudioRecording } from './useStudioRecording';

// Matches the tempo slider's range in CDJ
const TEMPO_RANGE_PERCENT = 50;
const ABSOLUTE_MIN_BEATS_PER_VIEW = 0.01;
const ABSOLUTE_MAX_BEATS_PER_VIEW = 65536;

function defaultLoadedTrackIds(): Record<DeckId, string | null> {
  return DECK_IDS.reduce(
    (acc, id) => {
      acc[id] = null;
      return acc;
    },
    {} as Record<DeckId, string | null>,
  );
}

function StudioPage() {
  const library = useTrackLibrary();
  const mixer = useMixerState();
  const engine = useAudioEngine(mixer.state);
  const recording = useStudioRecording(engine);
  const { status: recordingStatus, hasPendingSave, stopAndSave } = recording;
  const shouldBlockExit = recordingStatus === 'recording' || (recordingStatus === 'error' && hasPendingSave);
  const navigationBlocker = useBlocker(shouldBlockExit);
  const autoSaveNavigation = useRef(false);
  const [loadedTrackIds, setLoadedTrackIds] = useState<Record<DeckId, string | null>>(defaultLoadedTrackIds);
  const [deckBeatCounts, setDeckBeatCounts] = useState<Record<DeckId, number | null>>({
    [DeckId.A]: null,
    [DeckId.B]: null,
  });
  const [beatsPerView, setBeatsPerView] = useState(32);
  const { setChannel, setTempoMaster } = mixer;

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
    setBeatsPerView((current) => Math.min(maxBeatsPerView, Math.max(minBeatsPerView, current * factor)));
  }, [maxBeatsPerView, minBeatsPerView]);

  useEffect(() => {
    setBeatsPerView((current) => Math.min(maxBeatsPerView, Math.max(minBeatsPerView, current)));
  }, [maxBeatsPerView, minBeatsPerView]);

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
    setLoadedTrackIds((current) => {
      let changed = false;
      const updated = { ...current };
      DECK_IDS.forEach((id, index) => {
        if (!updated[id] && next[index]) {
          updated[id] = next[index].id;
          changed = true;
        }
      });
      return changed ? updated : current;
    });
  }, [library.songs]);

  const trackBpm = useCallback(
    (id: DeckId) => library.songs.find((song) => song.id === loadedTrackIds[id])?.bpm ?? 0,
    [library.songs, loadedTrackIds],
  );

  const masterId = mixer.state.tempoMaster;
  const effectiveDeckBpm = (id: DeckId) => trackBpm(id) * (1 + mixer.state.channelState[id].tempo / 100);
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
      if (Math.abs(target - mixer.state.channelState[id].tempo) > 0.001) {
        setChannel(id, { tempo: target });
      }
    });
  }, [masterId, masterBpm, trackBpm, mixer.state.channelState, setChannel]);

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

  // Flank the mixer with decks split as evenly as possible. This is a
  // reasonable default for any deck count but is a layout choice, not just
  // plumbing — revisit if 4 decks should look different (e.g. a 2x2 grid).
  const half = Math.ceil(DECK_IDS.length / 2);
  const leftIds = DECK_IDS.slice(0, half);
  const rightIds = DECK_IDS.slice(half);

  const gridTemplateColumns = [
    ...leftIds.map(() => 'minmax(0,1fr)'),
    'minmax(320px,0.6fr)',
    ...rightIds.map(() => 'minmax(0,1fr)'),
  ].join(' ');

  const renderDeck = (id: DeckId) => (
    <CDJ
      key={id}
      deckId={id}
      label={id}
      engine={engine}
      track={library.songs.find((song) => song.id === loadedTrackIds[id]) ?? null}
      tracks={ready}
      onLoadTrack={(trackId: string) => setLoadedTrackIds((current) => ({ ...current, [id]: trackId || null }))}
      onPatch={library.patchTrack}
      tempo={mixer.state.channelState[id].tempo}
      onTempoChange={(value) => setChannel(id, { tempo: value })}
      syncMaster={masterId === id}
      onSyncMasterChange={(on) => setTempoMaster(on ? id : null)}
      tempoFollowing={isFollowing(id)}
      sharedBeatsPerView={beatsPerView}
      showZoomControls={id === DeckId.A}
      onSharedZoomBy={adjustWaveformZoom}
      onBeatCountChange={reportDeckBeatCount}
    />
  );

  return (
    <ControlSelectionProvider bpm={automationBpm}>
      <div className="flex h-svh min-h-0 flex-col bg-[#0b0d10] text-zinc-200">
        <StudioTopbar
          recordingStatus={recording.status}
          recordingError={recording.error}
          hasPendingSave={recording.hasPendingSave}
          onStartRecording={() => void recording.start()}
          onStopAndSave={recording.stopAndSave}
          onRetrySave={recording.retrySave}
          onDiscard={recording.discard}
        />
        <section aria-label="Deck waveforms" className="flex-none border-b bg-[#101214]">
          <div className="bg-gradient-to-r from-yellow-400 to-pink-400 p-0.5">
            <div className="bg-[#101214]">
              {DECK_IDS.map((id) => (
                <div
                  key={id}
                  className="relative h-14 min-h-0 min-w-0 border-b border-white/5 last:border-b-0"
                  role="group"
                  aria-label={`Deck ${id === DeckId.A ? 'A' : 'B'} waveform`}
                >
                  <div id={`studio-waveform-large-${id}`} className="h-full min-h-0 min-w-0" />
                  <span className="pointer-events-none absolute left-2 top-1 z-10 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    {id === DeckId.A ? 'A' : 'B'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)]" style={{ gridTemplateColumns }}>
          {leftIds.map(renderDeck)}
          <Mixer
            state={mixer.state}
            onChannelChange={setChannel}
            onFxChange={mixer.setFx}
            onMasterChange={mixer.setMaster}
          />
          {rightIds.map(renderDeck)}
        </div>
      </div>
    </ControlSelectionProvider>
  );
}

export default StudioPage;