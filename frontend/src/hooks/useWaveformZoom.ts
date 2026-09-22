import type { TrackPlayer } from '@/hooks/useTrackPlayer';

export const ZOOM_STEP = 0.7;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 48;

export function useWaveformZoom(player: TrackPlayer, playhead?: number) {
  const zoomBy = (factor: number) => {
    const start = player.viewStart;
    const end = player.viewEnd;
    const center = playhead !== undefined && playhead >= start && playhead <= end ? playhead : (start + end) / 2;

    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, player.zoom / factor));
    const newWidth = 1 / newZoom;
    const newStart = Math.max(0, Math.min(center - newWidth / 2, 1 - newWidth));
    player.setView(newStart, newZoom);
  };

  return { zoomBy };
}
