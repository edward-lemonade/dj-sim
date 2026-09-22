import { trackSeconds } from "@/lib/types/Cues";
import { CueTicks } from "./CueTicks";
import { Playhead } from "./Playhead";
import { BandOptions, WaveformCanvas } from "./WaveformCanvas";
import { peaksFromOverview, type ThreeBandPeaks } from "@/lib/utils/threeBandWaveform";
import type { TrackPlayer } from "@/hooks/useTrackPlayer";
import type { Track } from "@/lib/types/Track";

export function MiniWaveform({
  track,
  peaks,
  player,
  playhead,
  onSeek,
}: {
  track: Track;
  peaks: ThreeBandPeaks | null;
  player: TrackPlayer;
  playhead?: number;
  onSeek: (fraction: number) => void;
}) {
  return (
    <div className="relative h-10 overflow-hidden">
      <WaveformCanvas
        variant="overview"
        bands={BandOptions.Single}
        peaks={peaksFromOverview(track.waveformOverview) ?? peaks}
        viewStart={player.viewStart}
        viewEnd={player.viewEnd}
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