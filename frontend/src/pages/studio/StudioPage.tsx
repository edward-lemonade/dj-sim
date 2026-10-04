import { useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { CDJ } from '@/components/CDJ';
import { ControlSelectionProvider } from '@/components/ControlSelection';
import { Mixer } from '@/components/Mixer';
import { StudioConsoleLayout } from '@/components/StudioConsoleLayout';
import { StudioTopbar } from '@/components/StudioTopbar';
import { useAudioEngine, clamp, DECK_IDS, DeckId } from '@/hooks/useAudioEngine';
import type { MixerState } from '@/hooks/useMixerState';
import { useTrackLibrary } from '@/hooks/useTrackLibrary';
import { MAX_PLAYER_ZOOM, MIN_PLAYER_ZOOM } from '@/hooks/useTrackPlayer';
import { RecordingStatus, useStudioRecording } from '@/hooks/useStudioRecording';
import { createStream } from '@/lib/api/StreamsAPI';
import { RoomLeaseProvider } from '@/contexts/RoomLeaseContext';
import {
  channelId,
  ChannelControlParam,
  ControlDeckId,
  ControlId,
  DeckControlParam,
  deckId as getDeckControlId,
} from '@/lib/types/Control';
import { TrackLibraryStatus } from '@/lib/types/Track';
import { StreamDeckId, StreamPopupKind, type StudioSnapshot } from '@/lib/types/Stream';
import { getStudioDeckLayout } from '@/lib/utils/studioGrid';
import { useStreamPublisher } from '@/pages/stream/useStreamConnection';
import {
  createInitialStudioSnapshot,
  reduceStudioSnapshot,
  StudioActionType,
  type StudioAction,
} from '@/pages/stream/studioState';
import { trackFromRoomLibrary, trackFromSnapshot, toStreamTrack } from './trackUtils';
import { useStudioRoom } from './useStudioRoom';

const TEMPO_RANGE_PERCENT = 50;
const ABSOLUTE_MIN_BEATS_PER_VIEW = 0.01;
const ABSOLUTE_MAX_BEATS_PER_VIEW = 65536;

type StudioCommand = StudioAction | { action: StudioActionType.Hydrate; value: StudioSnapshot };

function reduceStudio(state: StudioSnapshot, command: StudioCommand): StudioSnapshot {
  if (command.action === StudioActionType.Hydrate) return command.value;
  return reduceStudioSnapshot(state, command);
}

function StudioPage() {
  const library = useTrackLibrary();
  const [studioState, dispatchStudio] = useReducer(reduceStudio, undefined, createInitialStudioSnapshot);
  const engine = useAudioEngine(studioState.mixer);
  const roomSession = useStudioRoom({ studioState, dispatchStudio, engine });
  const {
    commitMixer,
    commitStudio,
    commitStudioLocal,
    avatarUrl: roomAvatarUrl,
    currentUserId,
    leases,
  } = roomSession;
  const recording = useStudioRecording(engine);
  const { status: recordingStatus, hasPendingSave, stopAndSave } = recording;
  const shouldBlockExit = recordingStatus === RecordingStatus.Recording
    || (recordingStatus === RecordingStatus.Error && hasPendingSave);
  const navigationBlocker = useBlocker(shouldBlockExit);
  const autoSaveNavigation = useRef(false);
  const lastPointerUpdate = useRef(0);
  const [deckBeatCounts, setDeckBeatCounts] = useState<Record<DeckId, number | null>>({
    [DeckId.A]: null,
    [DeckId.B]: null,
  });
  const [streamStartError, setStreamStartError] = useState<string | null>(null);
  const loadedTrackIds = useMemo<Record<DeckId, string | null>>(() => ({
    [DeckId.A]: studioState.decks.A.track?.id ?? null,
    [DeckId.B]: studioState.decks.B.track?.id ?? null,
  }), [studioState.decks]);

  const setChannel = useCallback((
    id: DeckId,
    patch: Partial<MixerState['channelState'][DeckId.A]>,
    localOnly = false,
  ) => {
    const controlDeck = id === DeckId.A ? ControlDeckId.A : ControlDeckId.B;
    const controlIds: Partial<Record<keyof MixerState['channelState'][DeckId.A], ControlId>> = {
      high: channelId(controlDeck, ChannelControlParam.EqHigh),
      mid: channelId(controlDeck, ChannelControlParam.EqMid),
      low: channelId(controlDeck, ChannelControlParam.EqLow),
      filter: id === DeckId.A ? ControlId.ChannelAFilter : ControlId.ChannelBFilter,
      volume: channelId(controlDeck, ChannelControlParam.Gain),
      tempo: getDeckControlId(controlDeck, DeckControlParam.Tempo),
    };
    const changedField = Object.keys(patch)[0] as keyof MixerState['channelState'][DeckId.A] | undefined;
    const controlId = changedField ? controlIds[changedField] : undefined;
    if (!controlId) return;
    const activeLease = leases.find((lease) => lease.controlId === controlId);
    if (
      activeLease
      && activeLease.ownerId !== currentUserId
      && activeLease.expiresAt > Date.now()
    ) return;
    const update = (current: MixerState) => ({
      ...current,
      channelState: { ...current.channelState, [id]: { ...current.channelState[id], ...patch } },
    });
    if (localOnly) {
      commitStudioLocal({
        action: StudioActionType.MixerChange,
        value: update(studioState.mixer),
      });
    } else {
      commitMixer(controlId, update);
    }
  }, [commitMixer, commitStudioLocal, currentUserId, leases, studioState.mixer]);

  const setFx = useCallback((patch: Partial<MixerState['fx']>) => {
    const changedAssignmentDeck = patch.assign
      ? patch.assign[DeckId.A] !== studioState.mixer.fx.assign[DeckId.A] ? DeckId.A : DeckId.B
      : null;
    const controlId = 'wet' in patch
      ? ControlId.FxWet
      : 'division' in patch
        ? ControlId.FxDivision
        : 'type' in patch
          ? ControlId.FxType
        : changedAssignmentDeck !== null
          ? changedAssignmentDeck === DeckId.A ? ControlId.FxAssignA : ControlId.FxAssignB
          : undefined;
    if (!controlId) return;
    commitMixer(controlId, (current) => ({ ...current, fx: { ...current.fx, ...patch } }));
  }, [commitMixer, studioState.mixer.fx.assign]);

  const setMaster = useCallback((value: number) => {
    commitMixer(ControlId.MasterVolume, (current) => ({ ...current, master: value }));
  }, [commitMixer]);

  const setTempoMaster = useCallback((id: DeckId | null) => {
    commitStudio({
      action: StudioActionType.MixerChange,
      value: { ...studioState.mixer, tempoMaster: id },
      controlId: ControlId.TempoMaster,
    });
  }, [commitStudio, studioState.mixer]);

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
    dispatchStudio({ action: StudioActionType.WaveformView, value: next });
  }, [maxBeatsPerView, minBeatsPerView, studioState.beatsPerView]);

  useEffect(() => {
    const next = Math.min(maxBeatsPerView, Math.max(minBeatsPerView, studioState.beatsPerView));
    dispatchStudio({ action: StudioActionType.WaveformView, value: next });
  }, [maxBeatsPerView, minBeatsPerView, studioState.beatsPerView]);

  useEffect(() => {
    const shouldAutoSave = recordingStatus === RecordingStatus.Recording
      || (recordingStatus === RecordingStatus.Error && hasPendingSave);
    if (navigationBlocker.state !== 'blocked' || !shouldAutoSave || autoSaveNavigation.current) {
      if (navigationBlocker.state === 'blocked' && !shouldAutoSave) navigationBlocker.proceed();
      return;
    }
    autoSaveNavigation.current = true;
    void stopAndSave().then((saved) => {
      if (saved) navigationBlocker.proceed();
      else navigationBlocker.reset();
    }).catch(() => {
      navigationBlocker.reset();
    }).finally(() => {
      autoSaveNavigation.current = false;
    });
  }, [navigationBlocker, hasPendingSave, recordingStatus, stopAndSave]);

  useEffect(() => {
    if (roomSession.room || roomSession.busy || roomSession.hasIncomingRoom) return;
    const next = library.songs.filter((song) => song.libraryStatus === TrackLibraryStatus.Ready);
    let cancelled = false;
    const syncTracks = async () => {
      for (const [index, id] of DECK_IDS.entries()) {
        const deck = id === DeckId.A ? StreamDeckId.A : StreamDeckId.B;
        const currentTrackId = loadedTrackIds[id];
        const track = currentTrackId
          ? library.songs.find((song) => song.id === currentTrackId)
          : next[index];
        if (!track) continue;
        const streamTrack = await toStreamTrack(track);
        if (cancelled) return;
        if (JSON.stringify(studioState.decks[deck].track) !== JSON.stringify(streamTrack)) {
          dispatchStudio({ action: StudioActionType.TrackLoad, deck, value: streamTrack });
        }
      }
    };
    void syncTracks();
    return () => { cancelled = true; };
  }, [
    library.songs,
    loadedTrackIds,
    studioState.decks,
    roomSession.room,
    roomSession.busy,
    roomSession.hasIncomingRoom,
  ]);

  const trackBpm = useCallback(
    (id: DeckId) => studioState.decks[id === DeckId.A ? StreamDeckId.A : StreamDeckId.B].track?.bpm ?? 0,
    [studioState.decks],
  );

  const reportTransport = useCallback((
    id: DeckId,
    next: { playing: boolean; positionSeconds: number; durationSeconds: number; rate: number },
  ) => {
    const previous = studioState.decks[id === DeckId.A ? StreamDeckId.A : StreamDeckId.B];
    if (
      previous.playing === next.playing
      && Math.abs(previous.positionSeconds - next.positionSeconds) < 0.2
      && Math.abs(previous.durationSeconds - next.durationSeconds) < 0.1
      && previous.rate === next.rate
    ) return;
    dispatchStudio({
      action: StudioActionType.Transport,
      deck: id === DeckId.A ? StreamDeckId.A : StreamDeckId.B,
      value: next,
    });
  }, [studioState.decks]);

  const streaming = useStreamPublisher(engine, studioState);
  const { start: startStream, stop: stopStream } = streaming;
  const collabRoomId = roomSession.room?.id;

  const cleanupStudioSession = useEffectEvent(() => {
    if (streaming.live) {
      stopStream().catch((cause: unknown) => {
        console.error('Failed to stop stream on beforeunload', cause);
      });
    }
  });

  useEffect(() => {
    const handleBeforeUnload = () => cleanupStudioSession();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      cleanupStudioSession();
    };
  }, []);

  const startStreaming = useCallback(async () => {
    if (!engine) return;
    const name = window.prompt('Name your stream');
    if (name === null) return;
    setStreamStartError(null);
    try {
      const connection = await createStream(name, roomAvatarUrl, collabRoomId);
      await startStream(connection, engine);
    } catch (cause) {
      setStreamStartError(cause instanceof Error ? cause.message : 'Could not start streaming.');
    }
  }, [engine, startStream, roomAvatarUrl, collabRoomId]);

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

  useEffect(() => {
    if (masterId === null || masterBpm <= 0) return;
    DECK_IDS.forEach((id) => {
      const bpm = trackBpm(id);
      if (id === masterId || bpm <= 0) return;
      const target = clamp((masterBpm / bpm - 1) * 100, -TEMPO_RANGE_PERCENT, TEMPO_RANGE_PERCENT);
      if (Math.abs(target - studioState.mixer.channelState[id].tempo) > 0.001) {
        setChannel(id, { tempo: target }, true);
      }
    });
  }, [masterId, masterBpm, trackBpm, studioState.mixer.channelState, setChannel]);

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

  const ready = library.songs.filter((song) => song.libraryStatus === TrackLibraryStatus.Ready);
  const roomLibraryTracks = roomSession.roomLibrary.map(trackFromRoomLibrary);
  const availableTracks = [
    ...ready,
    ...roomLibraryTracks.filter((track) => !ready.some((localTrack) => localTrack.id === track.id)),
  ];
  const { leftDeckIds, rightDeckIds, gridTemplateColumns } = getStudioDeckLayout();

  const renderDeck = (id: DeckId) => {
    const streamDeckId = id === DeckId.A ? StreamDeckId.A : StreamDeckId.B;
    return (
      <CDJ
        key={id}
        deckId={id}
        label={id}
        engine={engine}
        loadAudio={roomSession.loadTrackAudio}
        roomTransportCommand={roomSession.room ? roomSession.transportCommands[streamDeckId] ?? undefined : undefined}
        roomTracks={roomSession.room ? roomSession.roomLibrary : undefined}
        currentUserId={roomSession.currentUserId ?? undefined}
        track={library.songs.find((song) => song.id === loadedTrackIds[id])
          ?? trackFromSnapshot(studioState.decks[streamDeckId].track)}
        tracks={availableTracks}
        onLoadTrack={async (trackId: string) => {
          const track = availableTracks.find((song) => song.id === trackId);
          roomSession.commitStudio({
            action: StudioActionType.TrackLoad,
            deck: streamDeckId,
            value: track ? await toStreamTrack(track) : null,
          });
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
        onTransportCommand={(deck, command, positionSeconds, platterAngleDegrees) => {
          roomSession.sendTransportCommand(
            deck === DeckId.A ? StreamDeckId.A : StreamDeckId.B,
            command,
            positionSeconds,
            platterAngleDegrees,
          );
        }}
        onPopupChange={(deckId, open) => dispatchStudio({
          action: StudioActionType.Popup,
          value: open
            ? { kind: StreamPopupKind.TrackPicker, deck: deckId === DeckId.A ? StreamDeckId.A : StreamDeckId.B }
            : null,
        })}
      />
    );
  };

  return (
    <RoomLeaseProvider
      currentUserId={roomSession.room ? roomSession.currentUserId ?? null : null}
      leases={roomSession.leases}
      emitEvent={roomSession.sendControlLeaseEvent}
    >
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
            collabRoom={roomSession.room}
            collabBusy={roomSession.busy}
            collabError={roomSession.error}
            onCreateRoom={roomSession.startRoom}
            onEndRoom={roomSession.endRoom}
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
          dispatchStudio({ action: StudioActionType.Pointer, value: {
            x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
            y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
          } });
        }}
        />
      </ControlSelectionProvider>
    </RoomLeaseProvider>
  );
}

export default StudioPage;
