import { useEffect, useRef, useState } from 'react';
import { cn } from 'cn';
import { useTrackPlayer } from '@/hooks/useTrackPlayer';
import { normalizeCues } from '@/lib/types/Cues';
import type { Track, TrackUpdateFields } from '@/lib/types/Track';
import { DeckControls } from '@/components/DeckControls';
import { Platter } from '@/pages/studio/components/Platter';
import { clamp, type DeckId, type MixerAudioEngine } from '../useAudioEngine';
import { CdjWaveformDisplay } from '@/components/CdjWaveformDisplay';
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
  engine: MixerAudioEngine;
  tracks?: Track[];
  playedIds?: Set<string>;
  onLoadTrack?: (id: string) => void;
  onPatch: (id: string, fields: TrackUpdateFields) => Promise<unknown>;
  tempo: number;
  onTempoChange: (value: number) => void;
  /** This deck is the tempo master; the other decks follow its BPM. */
  syncMaster: boolean;
  onSyncMasterChange: (on: boolean) => void;
  /** Another deck is the master and this deck's tempo is being driven by it. */
  tempoFollowing: boolean;
};

export function CDJ({
  track,
  deckId,
  label,
  engine,
  tracks,
  playedIds,
  onLoadTrack,
  onPatch,
  tempo,
  onTempoChange,
  syncMaster,
  onSyncMasterChange,
  tempoFollowing,
}: CDJProps) {
  const player = useTrackPlayer({ enableSpacebar: false });

  // Whether the deck was playing when the current scratch drag started —
  // gates whether scratchTo() makes any sound, and whether handleScratchEnd
  // resumes playback afterward. Dragging the platter while paused still
  // moves the playhead (via player.seek below), just silently, and stays
  // paused when released.
  const wasPlayingRef = useRef(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const [platterSize, setPlatterSize] = useState(PLATTER_MIN_SIZE);

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

  // Wire this deck's <audio> element into the mixer engine's EQ/volume/tempo
  // chain. connectMediaElement is idempotent, so re-running this (StrictMode
  // double-invoke, re-renders before deps settle) is safe.
  useEffect(() => {
    engine.connectMediaElement(deckId, player.audioElement);
  }, [engine, deckId, player.audioElement]);

  useEffect(() => {
    if (track?.id) {
      void player.open(track.id);
      return;
    }
    player.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id]);

  const cues = normalizeCues(track?.cues);
  const playing = player.status === 'playing';
  const transportDisabled = !track || player.status === 'idle' || player.status === 'loading' || player.status === 'error';
  const cueSlotsFull = cues.every((slot) => slot !== null);
  // BPM after applying the tempo adjustment — this is what the MetaField
  // below displays, not the raw tempo percentage.
  const effectiveBpm = track?.bpm ? track.bpm * (1 + tempo / 100) : 0;

  // Lets the shared effects unit sync to this deck's tempo
  useEffect(() => {
    engine.setDeckBpm(deckId, effectiveBpm);
  }, [engine, deckId, effectiveBpm]);

  const setCueAtPlayhead = () => {
    if (!track || cueSlotsFull) return;
    const next = [...cues];
    const index = next.findIndex((slot) => slot === null);
    if (index < 0) return;
    next[index] = Math.round(player.currentTime * 1000) / 1000;
    void onPatch(track.id, { cues: next }).catch(console.error);
  };

  const handleScratchStart = () => {
    if (!player.audioBuffer || transportDisabled) return;
    wasPlayingRef.current = player.status === 'playing';
    player.setInteracting(true);
    // Still paused during the drag itself: scratchTo() plays short grains
    // straight from the decoded buffer as the audible output while
    // scratching (see MixerAudioEngine's docstring — that's a separate
    // audio path from normal <audio> element playback, not a mix of both),
    // so the element is paused here to avoid the two overlapping. The
    // permanent-pause bug was that this pause never got undone — see
    // handleScratchEnd below, which now resumes if it was playing before.
    if (wasPlayingRef.current) player.pause();
  };

  const handleScratchMove = (deltaSeconds: number, deltaRealSeconds: number) => {
    if (!player.audioBuffer) return;
    const base = player.currentTime;
    const next = clamp(base + deltaSeconds, 0, player.durationSeconds || base);
    if (wasPlayingRef.current) {
      engine.scratchTo(deckId, player.audioBuffer, base, deltaSeconds, deltaRealSeconds);
    }
    // Moves the real playhead every move (not just on release) so the
    // platter and waveform track the drag live. Silent on its own — the
    // element is already paused — so this is safe even when not scratching audibly.
    player.seek(next);
  };

  const handleScratchEnd = () => {
    engine.stopScratch(deckId);
    player.setInteracting(false);
    // Resume from wherever the drag left the playhead (already synced live
    // by every handleScratchMove call above) if playback was running before
    // the drag started. Without this, a scratch permanently pauses the deck
    // — dragging the platter should nudge playback, not stop it.
    if (wasPlayingRef.current) {
      wasPlayingRef.current = false;
      void player.play();
    }
  };

  return (
    <section
      className="grid h-full min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] bg-[#101214]"
      aria-label={label ? `Deck ${label}` : 'Deck'}
    >
      {tracks && onLoadTrack ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-500">
          <span>Load</span>
          <TrackPicker
            tracks={tracks}
            selectedId={track?.id ?? null}
            referenceBpm={effectiveBpm}
            referenceKey={track?.key}
            playedIds={playedIds}
            onSelect={onLoadTrack}
            label={label}
          />
        </div>
      ) : null}

      <CdjWaveformDisplay 
        track={track}
        player={player}
      />

      <div
        ref={stageRef}
        className="grid flex-1 min-h-0 grid-cols-[1fr_auto_1fr] grid-rows-[minmax(0,1fr)] items-center gap-10 border-t border-slate/40 px-4 py-4"
      >
        <div />
        <Platter
          label={label}
          size={platterSize}
          track={track}
          currentTime={player.currentTime}
          disabled={transportDisabled}
          onScratchStart={handleScratchStart}
          onScratchMove={handleScratchMove}
          onScratchEnd={handleScratchEnd}
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
            disabled={tempoFollowing}
            label={label ? `Deck ${label} tempo` : 'Tempo'}
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
            disabled={!syncMaster && !track?.bpm}
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
        disabled={transportDisabled}
        cueDisabled={cueSlotsFull}
        label={label}
        onCue={setCueAtPlayhead}
      />
    </section>
  );
}