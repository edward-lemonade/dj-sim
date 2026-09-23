import { useEffect, useRef } from 'react';
import { useTrackPlayer } from '@/hooks/useTrackPlayer';
import { normalizeCues } from '@/lib/types/Cues';
import type { Track, TrackUpdateFields } from '@/lib/types/Track';
import { DeckControls } from '@/components/DeckControls';
import { Platter } from '@/pages/studio/components/Platter';
import { BandOptions } from '@/components/WaveformCanvas';
import { clamp, type DeckId, type MixerAudioEngine } from '../useAudioEngine';
import { CdjWaveformDisplay } from '@/components/CdjWaveformDisplay';

export type CDJProps = {
  track: Track | null;
  /** Which mixer channel this deck feeds. Required — used to wire audio, not just to display. */
  deckId: DeckId;
  label?: DeckId;
  /** Shared mixer engine (from useAudioEngine), so this deck's audio can be connected into it. */
  engine: MixerAudioEngine;
  tracks?: Track[];
  onLoadTrack?: (id: string) => void;
  onPatch: (id: string, fields: TrackUpdateFields) => Promise<unknown>;
  /** Tempo in percent (e.g. -8..8), lifted up so it lives in MixerState. */
  tempo: number;
  onTempoChange: (value: number) => void;
};

export function CDJ({
  track,
  deckId,
  label,
  engine,
  tracks,
  onLoadTrack,
  onPatch,
  tempo,
  onTempoChange,
}: CDJProps) {
  const player = useTrackPlayer({ enableSpacebar: false });

  // Whether the deck was playing when the current scratch drag started —
  // gates whether scratchTo() makes any sound. Dragging the platter while
  // paused still moves the playhead (via player.seek below), just silently.
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
  };

  return (
    <section
      className="grid h-full min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] bg-[#101214]"
      aria-label={label ? `Deck ${label}` : 'Deck'}
    >
      {tracks && onLoadTrack ? (
        <div className="shrink-0 border-b border-zinc-800 px-2 py-1">
          <label className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
            Load
            <select
              className="min-w-0 flex-1 bg-[#161a20] text-xs text-zinc-200 outline-none"
              value={track?.id ?? ''}
              onChange={(event) => onLoadTrack(event.target.value)}
              aria-label={label ? `Load track on deck ${label}` : 'Load track'}
            >
              <option value="">No track loaded</option>
              {tracks
                .filter((item) => item.libraryStatus === 'ready')
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
            </select>
          </label>
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
        <label className="flex flex-col items-center gap-1">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            Tempo {tempo > 0 ? '+' : ''}
            {tempo}%
          </span>
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
        </label>
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