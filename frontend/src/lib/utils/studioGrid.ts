import { DECK_IDS, type DeckId } from '../../hooks/useAudioEngine';

export function getStudioDeckLayout(deckIds: DeckId[] = DECK_IDS) {
  const half = Math.ceil(deckIds.length / 2);
  const leftDeckIds = deckIds.slice(0, half);
  const rightDeckIds = deckIds.slice(half);
  const gridTemplateColumns = [
    ...leftDeckIds.map(() => 'minmax(0,1fr)'),
    'minmax(320px,0.6fr)',
    ...rightDeckIds.map(() => 'minmax(0,1fr)'),
  ].join(' ');

  return { leftDeckIds, rightDeckIds, gridTemplateColumns };
}
