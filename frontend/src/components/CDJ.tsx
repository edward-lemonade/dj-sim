import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from 'cn';
import {
  clampWaveformViewStart,
  MAX_PLAYER_ZOOM,
  MIN_PLAYER_ZOOM,
  useTrackPlayer,
} from '@/hooks/useTrackPlayer';
import { normalizeCues } from '@/lib/types/Cues';
import type { Track, TrackUpdateFields } from '@/lib/types/Track';
import type { RoomTrack } from '@/lib/types/Room';
import type { StreamDeckSnapshot } from '@/lib/types/Stream';
import { DeckControls } from '@/components/DeckControls';
import { Platter } from '@/components/Platter';
import { clamp, type DeckId, type MixerAudioEngine } from '../hooks/useAudioEngine';
import { CdjMiniWaveformDisplay, CdjWaveformDisplay } from '@/components/CdjWaveformDisplay';
import { MetaField } from '@/components/MetaField';
import { TrackPicker } from './TrackPicker';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/Slider';

const PLATTER_MIN_SIZE = 120;
// Tempo column plus gap on each side, so the platter stays centered without crowding it
const TEMPO_COLUMN_RESERVE = 140;

export type CDJProps = {
  track: Track | null;
  deckId: DeckId;
  label?: DeckId;
  engine: MixerAudioEngine | null;
  readOnlyState?: Pick<StreamDeckSnapshot, 'playing' | 'positionSeconds' | 'durationSeconds' | 'rate'> & {
    capturedAt: number;
    currentTime: number;
  };
  roomTransportCommand?: {
    id: string;
    platterRevision?: string;
    command: 'play' | 'pause' | 'seek' | 'sync';
    playing?: boolean;
    positionSeconds?: number;
    platterAngleDegrees?: number;
    receivedAtMs: number;
  };
  tracks?: Track[];
  roomTracks?: RoomTrack[];
  currentUserId?: string;
  playedIds?: Set<string>;
  loadAudio?: (trackId: string) => Promise<Blob>;
  onLoadTrack?: (id: string) => void;
  onPatch: (id: string, fields: TrackUpdateFields) => Promise<unknown>;
  tempo: number;
  onTempoChange: (value: number) => void;
  /** This deck is the tempo master; the other decks follow its BPM. */
  syncMaster: boolean;
  onSyncMasterChange: (on: boolean) => void;
  /** Another deck is the master and this deck's tempo is being driven by it. */
  tempoFollowing: boolean;
  sharedBeatsPerView: number;
  showZoomControls: boolean;
  onSharedZoomBy: (factor: number) => void;
  onBeatCountChange: (id: DeckId, count: number | null) => void;
  onTransportUpdate?: (id: DeckId, state: { playing: boolean; positionSeconds: number; durationSeconds: number; rate: number }) => void;
  onTransportCommand?: (id: DeckId, command: 'play' | 'pause' | 'seek', positionSeconds?: number, platterAngleDegrees?: number) => void;
  onPopupChange?: (id: DeckId, open: boolean) => void;
};

export function CDJ({
  track,
  deckId,
  label,
  engine,
  readOnlyState,
  roomTransportCommand,
  tracks,
  roomTracks,
  currentUserId,
  playedIds,
  loadAudio,
  onLoadTrack,
  onPatch,
  tempo,
  onTempoChange,
  syncMaster,
  onSyncMasterChange,
  tempoFollowing,
  sharedBeatsPerView,
  showZoomControls,
  onSharedZoomBy,
  onBeatCountChange,
  onTransportUpdate,
  onTransportCommand,
  onPopupChange,
}: CDJProps) {
  const localPlayer = useTrackPlayer({ enableSpacebar: false, loadAudio });
  const player = useMemo(() => {
    if (!readOnlyState) return localPlayer;
    const durationSeconds = readOnlyState.durationSeconds;
    const currentTime = readOnlyState.currentTime;
    const totalBeats = track?.bpm && durationSeconds > 0 ? durationSeconds * track.bpm / 60 : 0;
    const zoom = totalBeats > 0 ? Math.min(MAX_PLAYER_ZOOM, Math.max(MIN_PLAYER_ZOOM, totalBeats / sharedBeatsPerView)) : 1;
    const width = 1 / zoom;
    const center = durationSeconds > 0 ? currentTime / durationSeconds : 0;
    const viewStart = clampWaveformViewStart(center - width / 4, width);
    return {
      ...localPlayer,
      openedId: track?.id ?? null,
      status: track ? readOnlyState.playing ? 'playing' as const : 'ready' as const : 'idle' as const,
      currentTime,
      durationSeconds,
      zoom,
      viewStart,
      viewEnd: viewStart + width,
      hiResPeaks: null,
    };
  }, [localPlayer, readOnlyState, sharedBeatsPerView, track]);

  // Remember playback state so scratching resumes only decks that were playing.
  const wasPlayingRef = useRef(false);
  const lastRoomTransportCommandIdRef = useRef<string | undefined>(undefined);
  const pendingRoomTransportCommandRef = useRef<typeof roomTransportCommand>(undefined);
  const lastScratchRoomSentAtRef = useRef(0);
  const [localPlatterOverrideRevision, setLocalPlatterOverrideRevision] = useState<string | undefined>();

  const stageRef = useRef<HTMLDivElement | null>(null);
  const [platterSize, setPlatterSize] = useState(PLATTER_MIN_SIZE);
  const [waveformTarget, setWaveformTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(`studio-waveform-large-${deckId}`);
      if (target) setWaveformTarget((current) => current === target ? current : target);
    });
    return () => cancelAnimationFrame(frame);
  }, [deckId]);

  // Grow the platter to the space this row is given
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setPlatterSize(Math.max(PLATTER_MIN_SIZE, Math.floor(Math.min(height, width - 2 * TEMPO_COLUMN_RESERVE))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Connect this deck's persistent audio element to its mixer channel.
  useEffect(() => {
    if (!engine) return;
    engine.connectMediaElement(deckId, player.audioElement);
  }, [engine, deckId, player.audioElement]);

  useEffect(() => {
    if (readOnlyState) return;
    if (track?.id) {
      void player.open(track.id);
      return;
    }
    player.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnlyState, track?.id]);

  const applyRoomTransport = useEffectEvent(() => {
    if (!roomTransportCommand) {
      lastRoomTransportCommandIdRef.current = undefined;
      pendingRoomTransportCommandRef.current = undefined;
      return;
    }

    if (lastRoomTransportCommandIdRef.current !== roomTransportCommand.id) {
      lastRoomTransportCommandIdRef.current = roomTransportCommand.id;
      pendingRoomTransportCommandRef.current = roomTransportCommand;
    }
    const pendingTransport = pendingRoomTransportCommandRef.current;
    if (!pendingTransport || readOnlyState || !track || !player.audioElement.src || (player.status !== 'ready' && player.status !== 'playing')) return;

    const audio = player.audioElement;
    const isAdvancing = pendingTransport.command === 'play'
      || (pendingTransport.command === 'sync' && pendingTransport.playing === true);
    const loadDelaySeconds = isAdvancing
      ? Math.max(0, performance.now() - pendingTransport.receivedAtMs) / 1000
      : 0;
    const positionSeconds = typeof pendingTransport.positionSeconds === 'number'
      ? pendingTransport.positionSeconds + loadDelaySeconds
      : undefined;
    const seekThreshold = pendingTransport.command === 'seek' ? 0.01 : 0.75;
    if (
      typeof positionSeconds === 'number' && Number.isFinite(positionSeconds) &&
      Math.abs(audio.currentTime - positionSeconds) > seekThreshold
    ) {
      player.seek(positionSeconds);
    }
    const shouldPlay = pendingTransport.command === 'play'
      || (pendingTransport.command === 'sync' && pendingTransport.playing === true);
    const shouldPause = pendingTransport.command === 'pause'
      || (pendingTransport.command === 'sync' && pendingTransport.playing === false);
    if (shouldPlay && audio.paused) {
      void player.play().catch((cause: unknown) => {
        console.warn('Could not follow room playback', cause);
      });
    } else if (shouldPause && !audio.paused) {
      player.pause();
    }
    pendingRoomTransportCommandRef.current = undefined;
  });

  useEffect(() => {
    applyRoomTransport();
  }, [roomTransportCommand?.id, player.status, readOnlyState, track?.id]);

  useEffect(() => {
    const beatCount = track?.bpm && player.durationSeconds > 0
      ? player.durationSeconds * track.bpm / 60
      : null;
    onBeatCountChange(deckId, beatCount);
  }, [deckId, onBeatCountChange, player.durationSeconds, track?.bpm, track?.id]);

  useEffect(() => {
    if (!onTransportUpdate) return;
    const timer = window.setInterval(() => {
      onTransportUpdate(deckId, {
        playing: !player.audioElement.paused,
        positionSeconds: player.audioElement.currentTime || 0,
        durationSeconds: Number.isFinite(player.audioElement.duration) ? player.audioElement.duration : 0,
        rate: player.audioElement.playbackRate,
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [deckId, onTransportUpdate, player.audioElement]);

  const syncSharedZoom = useEffectEvent(() => {
    if (readOnlyState) return;
    const bpm = track?.bpm ?? 0;
    if (bpm <= 0 || player.durationSeconds <= 0) return;
    const totalBeats = player.durationSeconds * bpm / 60;
    const zoom = Math.min(MAX_PLAYER_ZOOM, Math.max(MIN_PLAYER_ZOOM, totalBeats / sharedBeatsPerView));
    if (Math.abs(player.zoom - zoom) < 0.001) return;
    const width = 1 / zoom;
    const center = player.currentTime / player.durationSeconds;
    player.setView(clampWaveformViewStart(center - width / 2, width), zoom);
  });

  useEffect(() => {
    syncSharedZoom();
  }, [player.zoom, player.durationSeconds, track?.id, track?.bpm, sharedBeatsPerView, readOnlyState]);

  const cues = normalizeCues(track?.cues);
  const transportDisabled = !track || player.status === 'idle' || player.status === 'loading' || player.status === 'error';
  const cueSlotsFull = cues.every((slot) => slot !== null);
  // BPM after applying the tempo adjustment — this is what the MetaField
  // below displays, not the raw tempo percentage.
  const effectiveBpm = track?.bpm ? track.bpm * (1 + tempo / 100) : 0;

  // Lets the shared effects unit sync to this deck's tempo
  useEffect(() => {
    if (!engine) return;
    engine.setDeckBpm(deckId, effectiveBpm);
  }, [engine, deckId, effectiveBpm]);

  const setCueAtPlayhead = () => {
    if (readOnlyState || !track || cueSlotsFull) return;
    const next = [...cues];
    const index = next.findIndex((slot) => slot === null);
    if (index < 0) return;
    next[index] = Math.round(player.currentTime * 1000) / 1000;
    void onPatch(track.id, { cues: next }).catch(console.error);
  };

  const handleScratchStart = () => {
    if (!engine || readOnlyState || transportDisabled) return;
    wasPlayingRef.current = player.status === 'playing';
    setLocalPlatterOverrideRevision(roomTransportCommand?.platterRevision);
    player.setInteracting(true);
    // Pause element playback while scratch grains use the decoded buffer.
    if (wasPlayingRef.current) {
      onTransportCommand?.(deckId, 'pause', player.currentTime);
      player.pause();
    }
  };

  const handleScratchMove = (deltaSeconds: number, deltaRealSeconds: number, angleDegrees: number) => {
    const base = player.currentTime;
    const next = clamp(base + deltaSeconds, 0, player.durationSeconds || base);
    if (engine && wasPlayingRef.current && player.audioBuffer) {
      engine.scratchTo(deckId, player.audioBuffer, base, deltaSeconds, deltaRealSeconds);
    }
    // Seek on every move so the platter and waveform follow the drag.
    player.seek(next);
    const now = performance.now();
    if (now - lastScratchRoomSentAtRef.current >= 33) {
      lastScratchRoomSentAtRef.current = now;
      onTransportCommand?.(deckId, 'seek', next, angleDegrees);
    }
  };

  const handleScratchEnd = (angleDegrees: number) => {
    engine?.stopScratch(deckId);
    player.setInteracting(false);
    const shouldResume = wasPlayingRef.current;
    wasPlayingRef.current = false;
    if (!readOnlyState) {
      onTransportCommand?.(deckId, 'seek', player.currentTime, angleDegrees);
    }
    if (!readOnlyState && shouldResume) {
      onTransportCommand?.(deckId, 'play', player.currentTime);
      void player.play();
    }
  };

  return (
    <>
      <section
        className="grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)_auto] bg-[#101214]"
        aria-label={label ? `Deck ${label}` : 'Deck'}
      >
      {tracks && onLoadTrack ? (
        <div className="flex min-w-0 shrink-0 items-center gap-2 border-b px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-500">
          <span>Load</span>
          <TrackPicker
            tracks={tracks}
            selectedId={track?.id ?? null}
            referenceBpm={effectiveBpm}
            referenceKey={track?.key}
            playedIds={playedIds}
            onSelect={onLoadTrack}
            label={label}
            onOpenChange={(open) => onPopupChange?.(deckId, open)}
            roomTracks={roomTracks}
            currentUserId={currentUserId}
          />
        </div>
      ) : null}

      <div className="h-7 min-h-0 min-w-0 overflow-hidden border-b border-white/5">
        <CdjMiniWaveformDisplay track={track} player={player} />
      </div>

      <div
        ref={stageRef}
        className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] items-center gap-4 border-t border-slate/40 px-2 py-2"
      >
        <div />
        <Platter
          label={label}
          size={platterSize}
          track={track}
          disabled={transportDisabled || readOnlyState !== undefined}
          onScratchStart={handleScratchStart}
          onScratchMove={handleScratchMove}
          onScratchEnd={handleScratchEnd}
          syncedAngle={localPlatterOverrideRevision === roomTransportCommand?.platterRevision
            ? undefined
            : roomTransportCommand?.platterAngleDegrees}
        />
        <div className="flex min-h-0 flex-col items-center justify-center gap-2 self-stretch justify-self-center">
          <MetaField
            label="Tempo:"
            value={effectiveBpm.toFixed(2)}
            align='center'
            disabled
            onCommit={async () => {}}
          />
          <Slider
            min={-50}
            max={50}
            step={0.1}
            value={tempo}
            onChange={onTempoChange}
            disabled={readOnlyState !== undefined || tempoFollowing}
            label={label ? `Deck ${label} tempo` : 'Tempo'}
            automationMode="tempo"
            referenceBpm={track?.bpm ?? 0}
            className="max-h-72 min-h-0 w-8 flex-1 cursor-pointer accent-zinc-200"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-zinc-400 hover:text-zinc-100"
            disabled={tempo === 0 || tempoFollowing}
            onClick={() => onTempoChange(0)}
            aria-label={label ? `Reset deck ${label} tempo` : 'Reset tempo'}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider">Reset</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-6 border px-2',
              syncMaster ? 'border-orange-400/70 bg-orange-400/15 text-orange-200' : 'border-transparent text-zinc-400 hover:text-zinc-100',
            )}
            aria-pressed={syncMaster}
            disabled={readOnlyState !== undefined || (!syncMaster && !track?.bpm)}
            onClick={() => onSyncMasterChange(!syncMaster)}
            aria-label={label ? `Make deck ${label} the tempo master` : 'Tempo master'}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider">Master</span>
          </Button>
        </div>
      </div>

      <DeckControls
        player={player}
        bpm={track?.bpm ?? 0}
        cues={cues}
        disabled={transportDisabled || readOnlyState !== undefined}
        cueDisabled={cueSlotsFull || readOnlyState !== undefined}
        label={label}
        onCue={setCueAtPlayhead}
        onTransportCommand={(command, positionSeconds) => onTransportCommand?.(deckId, command, positionSeconds)}
      />
      </section>
      {waveformTarget
        ? createPortal(
            <CdjWaveformDisplay
              track={track}
              player={player}
              showZoomControls={showZoomControls}
              onZoomBy={onSharedZoomBy}
            />,
            waveformTarget,
          )
        : null}
    </>
  );
}