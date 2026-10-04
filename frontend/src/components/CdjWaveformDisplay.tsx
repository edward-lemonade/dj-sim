import { BandOptions } from '@/components/WaveformCanvas';
import { computeCdjVisibleWindow, StageWaveform, WaveformDisplayMode } from '@/components/StageWaveform';
import { PlayerStatus, type TrackPlayer } from '@/hooks/useTrackPlayer';
import { normalizeCues } from '@/lib/types/Cues';
import type { Track } from '@/lib/types/Track';
import { peaksFromOverview } from '@/lib/utils/threeBandWaveform';
import { MiniWaveform } from './MiniWaveform';

function getCdjWaveformData(track: Track | null, player: TrackPlayer) {
  if (!track || player.status === PlayerStatus.Idle || player.status === PlayerStatus.Error) return null;

  const playhead = player.durationSeconds > 0 ? player.currentTime / player.durationSeconds : undefined;
  const peaks = player.hiResPeaks ?? peaksFromOverview(track.waveformOverview);
  const cues = normalizeCues(track.cues);
  const { start: viewStart, end: viewEnd } = computeCdjVisibleWindow(
    playhead,
    player.viewStart,
    player.viewEnd,
  );

  return { playhead, peaks, cues, viewStart, viewEnd };
}

// CDJ-style readout: the big waveform is not seekable (playhead stays fixed
// 1/4 from the left and the waveform slides underneath it).
export function CdjWaveformDisplay({
  track,
  player,
  bands = BandOptions.Triple,
  showZoomControls = true,
  onZoomBy,
}: {
  track: Track | null;
  player: TrackPlayer;
  bands?: BandOptions;
  showZoomControls?: boolean;
  onZoomBy?: (factor: number) => void;
}) {
  if (!track || player.status === PlayerStatus.Idle) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-[#101214]">
        <p className="text-sm tracking-wide text-zinc-400">No track loaded</p>
      </div>
    );
  }

  if (player.status === PlayerStatus.Error) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center text-sm text-red-400">
        {player.errorMessage || 'Could not open track'}
      </div>
    );
  }

  const data = getCdjWaveformData(track, player);
  if (!data) return null;

  return (
    <div className="flex h-full min-h-0 min-w-0">
      <StageWaveform
        peaks={data.peaks}
        player={player}
        playhead={data.playhead}
        bpm={track.bpm}
        beatOffset={track.beatOffset}
        displayMode={WaveformDisplayMode.CDJ}
        cues={data.cues}
        bands={bands}
        showZoomControls={showZoomControls}
        onZoomBy={onZoomBy}
      />
    </div>
  );
}

export function CdjMiniWaveformDisplay({ track, player }: { track: Track | null; player: TrackPlayer }) {
  const data = getCdjWaveformData(track, player);

  if (!track || !data) {
    return <div className="h-full min-h-0 min-w-0 bg-[#101214]" />;
  }

  return (
    <div className="h-full min-h-0 min-w-0">
      {/* No onSeek passed: the mini waveform is not clickable in CDJ mode. */}
      <MiniWaveform
        track={track}
        peaks={data.peaks}
        player={player}
        playhead={data.playhead}
        viewStart={data.viewStart}
        viewEnd={data.viewEnd}
        className="h-7"
      />
    </div>
  );
}