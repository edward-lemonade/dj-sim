import { useEffect, useRef } from 'react';
import { useTrackPlayer } from '@/hooks/useTrackPlayer';
import { normalizeCues } from '@/lib/types/Cues';
import type { Track, TrackUpdateFields } from '@/lib/types/Track';
import { DeckControls } from '@/components/DeckControls';
import { Platter } from '@/pages/studio/components/Platter';
import { clamp, type DeckId, type MixerAudioEngine } from '../useAudioEngine';
import { CdjWaveformDisplay } from '@/components/CdjWaveformDisplay';
import { MetaField } from '@/components/MetaField';
import { TrackPicker } from './TrackPicker';

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
}: CDJProps) {
  const player = useTrackPlayer({ enableSpacebar: false });

  // Whether the deck was playing when the current scratch drag started —
  // gates whether scratchTo() makes any sound, and whether handleScratchEnd
  // resumes playback afterward. Dragging the platter while paused still
  // moves the playhead (via player.seek below), just silently, and stays
  // paused when released.
  const wasPlayingRef = useRef(false);

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

      <div className="flex flex-1 min-h-0 items-center justify-center gap-10 border-t border-slate/40 px-4 py-4">
        <Platter
          label={label}
          size={180}
          track={track}
          currentTime={player.currentTime}
          disabled={transportDisabled}
          onScratchStart={handleScratchStart}
          onScratchMove={handleScratchMove}
          onScratchEnd={handleScratchEnd}
        />
        <div className="flex flex-col items-center gap-2">
          <MetaField
            label="Tempo:"
            value={effectiveBpm.toFixed(2)}
            align='center'
            disabled
            onCommit={async () => {}}
          />
          <input
            type="range"
            min={-50}
            max={50}
            step={0.1}
            value={tempo}
            onChange={(event) => onTempoChange(Number(event.target.value))}
            aria-label={label ? `Deck ${label} tempo` : 'Tempo'}
            className="h-56 w-8 cursor-pointer accent-zinc-200"
            style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
          />
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