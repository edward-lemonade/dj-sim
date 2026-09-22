import { useEffect, useState } from 'react';
import { CDJ } from '@/pages/studio/components/CDJ';
import { Mixer } from '@/pages/studio/components/Mixer';
import { StudioTopbar } from '@/pages/studio/components/StudioTopbar';
import { useMixerState } from '@/hooks/useMixerState';
import { useTrackLibrary } from '@/hooks/useTrackLibrary';

function StudioPage() {
  const library = useTrackLibrary();
  const mixer = useMixerState();
  const [deckAId, setDeckAId] = useState<string | null>(null);
  const [deckBId, setDeckBId] = useState<string | null>(null);

  useEffect(() => {
    const next = library.songs.filter((song) => song.libraryStatus === 'ready');
    if (!deckAId && next[0]) setDeckAId(next[0].id);
    if (!deckBId && next[1]) setDeckBId(next[1].id);
  }, [deckAId, deckBId, library.songs]);

  const deckA = library.songs.find((song) => song.id === deckAId) ?? null;
  const deckB = library.songs.find((song) => song.id === deckBId) ?? null;
  const ready = library.songs.filter((song) => song.libraryStatus === 'ready');

  return (
    <div className="flex h-svh min-h-0 flex-col bg-[#0b0d10] text-zinc-200">
      <StudioTopbar />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,0.4fr)_minmax(0,1fr)]">
        <CDJ
          label="A"
          track={deckA}
          tracks={ready}
          onLoadTrack={(id) => setDeckAId(id || null)}
          onPatch={library.patchTrack}
        />
        <Mixer state={mixer.state} onChannelChange={mixer.setChannel} />
        <CDJ
          label="B"
          track={deckB}
          tracks={ready}
          onLoadTrack={(id) => setDeckBId(id || null)}
          onPatch={library.patchTrack}
        />
      </div>
    </div>
  );
}

export default StudioPage;
