import { BandOptions } from '@/components/WaveformCanvas';
import { StageWaveform } from '@/components/StageWaveform';
import type { TrackPlayer } from '@/hooks/useTrackPlayer';
import { normalizeCues } from '@/lib/types/Cues';
import type { Track } from '@/lib/types/Track';
import { peaksFromOverview } from '@/lib/utils/threeBandWaveform';
import { snapToBeat } from '@/lib/utils/snapToBeat';
import { MiniWaveform } from './MiniWaveform';

export function WaveformDoubleDisplay({
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

  const seekSnapped = (fraction: number) => {
    const duration = player.durationSeconds;
    const seconds = fraction * duration;
    player.seek(snapToBeat(seconds, track.bpm, track.beatOffset, duration));
  };

  return (
    <div className="flex h-56 min-h-0 min-w-0 flex-col">
      <StageWaveform
        peaks={peaks}
        player={player}
        playhead={playhead}
        bpm={track.bpm}
        beatOffset={track.beatOffset}
        cues={cues}
        bands={bands}
        onSeek={seekSnapped}
      />
      <MiniWaveform
        track={track}
        peaks={peaks}
        player={player}
        playhead={playhead}
        onSeek={seekSnapped}
      />
    </div>
  );
}