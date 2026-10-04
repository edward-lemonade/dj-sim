import type { ReactNode, PointerEventHandler } from 'react';
import { DECK_IDS, DeckId } from '../hooks/useAudioEngine';

export function StudioConsoleLayout({
  topbar,
  leftDecks,
  rightDecks,
  mixer,
  gridTemplateColumns,
  onPointerMove,
  onPointerLeave,
  children,
  className = 'h-svh bg-[#0b0d10]',
  readOnly = false,
}: {
  topbar: ReactNode;
  leftDecks: ReactNode;
  rightDecks: ReactNode;
  mixer: ReactNode;
  gridTemplateColumns: string;
  onPointerMove?: PointerEventHandler<HTMLDivElement>;
  onPointerLeave?: PointerEventHandler<HTMLDivElement>;
  children?: ReactNode;
  className?: string;
  readOnly?: boolean;
}) {
  return (
    <div
      className={`relative flex min-h-0 flex-col text-zinc-200 ${className}`}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {topbar}
      <div inert={readOnly} className="flex min-h-0 flex-1 flex-col">
        <section aria-label="Deck waveforms" className="flex-none border-b bg-[#101214]">
          <div className="bg-linear-to-r from-yellow-400 to-pink-400 p-0.5">
            <div className="bg-[#101214]">
              {DECK_IDS.map((id) => (
                <div
                  key={id}
                  className="relative h-14 min-h-0 min-w-0 border-b border-white/5 last:border-b-0"
                  role="group"
                  aria-label={`Deck waveform ${id === DeckId.A ? 'A' : 'B'}`}
                >
                  <div id={`studio-waveform-large-${id}`} className="h-full min-h-0 min-w-0" />
                  <span className="pointer-events-none absolute left-2 top-1 z-10 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    {id === DeckId.A ? 'A' : 'B'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)]" style={{ gridTemplateColumns }}>
          {leftDecks}
          {mixer}
          {rightDecks}
        </div>
      </div>
      {children}
    </div>
  );
}
