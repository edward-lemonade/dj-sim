import { useEffect, useRef, useState } from 'react';
import { CDJ } from './components/CDJ';
import { Mixer } from '@/pages/studio/components/Mixer';
import { StudioTopbar } from '@/pages/studio/components/StudioTopbar';
import { useAudioEngine } from './useAudioEngine';
import { useMixerState } from './useMixerState';
import { DECK_IDS, DeckId } from './useAudioEngine';
import { useTrackLibrary } from '@/hooks/useTrackLibrary';

function defaultLoadedTrackIds(): Record<DeckId, string | null> {
  return DECK_IDS.reduce(
    (acc, id) => {
      acc[id] = null;
      return acc;
    },
    {} as Record<DeckId, string | null>,
  );
}

function StudioPage() {
  const library = useTrackLibrary();
  const mixer = useMixerState();
  const engine = useAudioEngine(mixer.state);
  const [loadedTrackIds, setLoadedTrackIds] = useState<Record<DeckId, string | null>>(defaultLoadedTrackIds);

  // Auto-load the first N ready tracks into the N decks, in DECK_IDS order.
  useEffect(() => {
    const next = library.songs.filter((song) => song.libraryStatus === 'ready');
    setLoadedTrackIds((current) => {
      let changed = false;
      const updated = { ...current };
      DECK_IDS.forEach((id, index) => {
        if (!updated[id] && next[index]) {
          updated[id] = next[index].id;
          changed = true;
        }
      });
      return changed ? updated : current;
    });
  }, [library.songs]);

  // Web Audio requires a user gesture before it will actually produce sound.
  // Resume on the first pointerdown anywhere in the studio, once.
  const resumed = useRef(false);
  useEffect(() => {
    const handler = () => {
      if (resumed.current) return;
      resumed.current = true;
      void engine.resume();
    };
    window.addEventListener('pointerdown', handler);
    return () => window.removeEventListener('pointerdown', handler);
  }, [engine]);

  const ready = library.songs.filter((song) => song.libraryStatus === 'ready');

  // Flank the mixer with decks split as evenly as possible. This is a
  // reasonable default for any deck count but is a layout choice, not just
  // plumbing — revisit if 4 decks should look different (e.g. a 2x2 grid).
  const half = Math.ceil(DECK_IDS.length / 2);
  const leftIds = DECK_IDS.slice(0, half);
  const rightIds = DECK_IDS.slice(half);

  const gridTemplateColumns = [
    ...leftIds.map(() => 'minmax(0,1fr)'),
    'minmax(0,0.4fr)',
    ...rightIds.map(() => 'minmax(0,1fr)'),
  ].join(' ');

  const renderDeck = (id: DeckId) => (
    <CDJ
      key={id}
      deckId={id}
      label={id}
      engine={engine}
      track={library.songs.find((song) => song.id === loadedTrackIds[id]) ?? null}
      tracks={ready}
      onLoadTrack={(trackId: string) => setLoadedTrackIds((current) => ({ ...current, [id]: trackId || null }))}
      onPatch={library.patchTrack}
      tempo={mixer.state.channelState[id].tempo}
      onTempoChange={(value) => mixer.setChannel(id, { tempo: value })}
    />
  );

  return (
    <div className="flex h-svh min-h-0 flex-col bg-[#0b0d10] text-zinc-200">
      <StudioTopbar />
      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns }}>
        {leftIds.map(renderDeck)}
        <Mixer state={mixer.state} onChannelChange={mixer.setChannel} onMasterChange={mixer.setMaster} />
        {rightIds.map(renderDeck)}
      </div>
    </div>
  );
}

export default StudioPage;