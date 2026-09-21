import { useState } from 'react';
import type { PoolTrack } from '@/lib/types/track';
import { TrackExplorer } from './components/TrackExplorer';
import { TrackPreview } from './components/TrackPreview';
import { useTrackLibrary } from './hooks/useTrackLibrary';
import { useTrackPlayer } from './hooks/useTrackPlayer';

function TracksPage() {
  const library = useTrackLibrary();
  const player = useTrackPlayer();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const opened = library.songs.find((song) => song.id === player.openedId) ?? null;

  const openTrack = (song: PoolTrack) => {
    if (song.status !== 'ready') return;
    setSelectedId(song.id);
    void player.open(song.id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-zinc-800 bg-[#101214] text-zinc-200 shadow-lg">
      <TrackPreview track={opened} player={player} onPatch={library.patchTrack} />
      <TrackExplorer
        songs={library.songs}
        setSongs={library.setSongs}
        selectedId={selectedId}
        openedId={player.openedId}
        uploadRef={library.uploadRef}
        onUpload={library.handleUpload}
        onSelect={setSelectedId}
        onOpen={openTrack}
        onDelete={(song) => {
          if (player.openedId === song.id) player.close();
          void library.removeSong(song);
        }}
      />
    </div>
  );
}

export default TracksPage;
