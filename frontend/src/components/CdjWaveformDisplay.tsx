import { BandOptions } from '@/components/WaveformCanvas';
import { computeCdjVisibleWindow, StageWaveform, WaveformDisplayMode } from '@/components/StageWaveform';
import type { TrackPlayer } from '@/hooks/useTrackPlayer';
import { normalizeCues } from '@/lib/types/Cues';
import type { Track } from '@/lib/types/Track';
import { peaksFromOverview } from '@/lib/utils/threeBandWaveform';
import { MiniWaveform } from './MiniWaveform';

// CDJ-style readout: the big waveform is not seekable (playhead stays fixed
// 1/4 from the left and the waveform slides underneath it), and the mini
// waveform below it is not clickable either — both are display-only.
export function CdjWaveformDisplay({
  track,
  player,
  bands = BandOptions.Triple,
}: {
  track: Track | null;
  player: TrackPlayer;
  bands?: BandOptions;
}) {
  if (!track || player.status === 'idle') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[#101214]">
        <p className="text-sm tracking-wide text-zinc-400">No track loaded</p>
      </div>
    );
  }

  if (player.status === 'error') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-red-400">
        {player.errorMessage || 'Could not open track'}
      </div>
    );
  }

  const playhead = player.durationSeconds > 0 ? player.currentTime / player.durationSeconds : undefined;
  const peaks = player.hiResPeaks ?? peaksFromOverview(track.waveformOverview);
  const cues = normalizeCues(track.cues);
  // Same continuously playhead-centered window StageWaveform positions the
  // big CDJ waveform with, so the mini waveform's viewport indicator slides
  // in lockstep with it every frame instead of only jumping occasionally.
  const { start: miniViewStart, end: miniViewEnd } = computeCdjVisibleWindow(
    playhead,
    player.viewStart,
    player.viewEnd,
  );

  return (
    <div className="flex h-56 min-h-0 min-w-0 flex-col">
      <StageWaveform
        peaks={peaks}
        player={player}
        playhead={playhead}
        bpm={track.bpm}
        beatOffset={track.beatOffset}
        displayMode={WaveformDisplayMode.CDJ}
        cues={cues}
        bands={bands}
      />
      {/* No onSeek passed: the mini waveform is not clickable in CDJ mode. */}
      <MiniWaveform
        track={track}
        peaks={peaks}
        player={player}
        playhead={playhead}
        viewStart={miniViewStart}
        viewEnd={miniViewEnd}
      />
    </div>
  );
}