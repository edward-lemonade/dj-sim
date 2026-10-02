import { trackSeconds } from "@/lib/types/Cues";
import { CueTicks } from "./CueTicks";
import { Playhead } from "./Playhead";
import { BandOptions, WaveformCanvas } from "./WaveformCanvas";
import { peaksFromOverview, type ThreeBandPeaks } from "@/lib/utils/threeBandWaveform";
import type { TrackPlayer } from "@/hooks/useTrackPlayer";
import type { Track } from "@/lib/types/Track";
import { cn } from 'cn';

export function MiniWaveform({
  track,
  peaks,
  player,
  playhead,
  onSeek,
  viewStart,
  viewEnd,
  className = 'h-10',
}: {
  track: Track;
  peaks: ThreeBandPeaks | null;
  player: TrackPlayer;
  playhead?: number;
  onSeek?: (fraction: number) => void;
  // CDJ mode passes the live playhead-centered window; other views use the
  // player's pan/zoom window by default.
  viewStart?: number;
  viewEnd?: number;
  className?: string;
}) {
  const effectiveViewStart = viewStart ?? player.viewStart;
  const effectiveViewEnd = viewEnd ?? player.viewEnd;

  return (
    <div className={cn('relative overflow-hidden', className)}>
      <WaveformCanvas
        variant="overview"
        bands={BandOptions.Single}
        peaks={peaksFromOverview(track.waveformOverview) ?? peaks}
        viewStart={effectiveViewStart}
        viewEnd={effectiveViewEnd}
        zoom={player.zoom}
        onSeek={onSeek}
        onViewChange={player.setView}
        onInteractionChange={player.setInteracting}
      />
      <CueTicks cues={track.cues} seconds={trackSeconds(track)} />
      <Playhead 
        playhead={playhead} 
        viewStart={0} 
        viewEnd={1} 
      />
    </div>
  )
}