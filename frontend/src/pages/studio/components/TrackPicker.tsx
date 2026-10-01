import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from 'cn';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Track } from '@/lib/types/Track';
import type { DeckId } from '../useAudioEngine';
import { KeyNotationType } from '@/constants/KeyNotation';
import { formatKey } from '@/lib/utils/formatKey';
import { keyColor } from '@/lib/utils/formatKey';

const NO_MATCH = 99;

const ROW_GRID = 'grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_2.5rem_2rem] items-center gap-2 px-3';

function parseCamelot(key: Track['key']) {
  if (!key) return null;
  const match = /^(\d+)([AB])$/i.exec(formatKey(key, KeyNotationType.Camelot));
  return match ? { number: Number(match[1]), letter: match[2].toUpperCase() } : null;
}

// 0 = same key, 1 = adjacent or relative major/minor, grows from there
function keyDistance(a: Track['key'], b: Track['key']) {
  const x = parseCamelot(a);
  const y = parseCamelot(b);
  if (!x || !y) return NO_MATCH;
  const diff = Math.abs(x.number - y.number);
  return Math.min(diff, 12 - diff) + (x.letter === y.letter ? 0 : 1);
}

export function TrackPicker({
  tracks,
  selectedId,
  referenceBpm,
  referenceKey,
  playedIds,
  onSelect,
  label,
}: {
  tracks: Track[];
  selectedId: string | null;
  referenceBpm: number;
  referenceKey: Track['key'] | undefined;
  playedIds?: Set<string>;
  onSelect: (id: string) => void;
  label?: DeckId;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const panelId = useId();

  const sorted = useMemo(() => {
    return tracks
      .filter((track) => track.libraryStatus === 'ready')
      .map((track) => ({
        track,
        // rounded so equal-ish tempos tie and the key sort can break them
        bpmDistance: referenceBpm > 0 ? (track.bpm > 0 ? Math.round(Math.abs(track.bpm - referenceBpm)) : NO_MATCH) : 0,
        keyDistance: referenceKey ? keyDistance(track.key, referenceKey) : 0,
      }))
      .sort((a, b) => a.bpmDistance - b.bpmDistance || a.keyDistance - b.keyDistance)
      .map((entry) => entry.track);
  }, [tracks, referenceBpm, referenceKey]);

  // Every word must match somewhere in title, artist, bpm or key (either notation)
  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return sorted;
    return sorted.filter((track) => {
      const haystack = [
        track.title,
        track.artist,
        track.bpm > 0 ? String(track.bpm) : '',
        track.key ? formatKey(track.key, KeyNotationType.Camelot) : '',
        track.key ? formatKey(track.key, KeyNotationType.Standard) : '',
      ]
        .join(' ')
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [sorted, query]);

  const current = tracks.find((track) => track.id === selectedId);

  // Move focus into the panel on open so typing, Tab and Enter work right away
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
  }, [open]);

  // Capture so arrows drive the list instead of a focused slider
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const rows = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[data-track]') ?? []);
      if (rows.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const active = document.activeElement as HTMLElement | null;
      const index = rows.indexOf(active as HTMLElement);
      if (event.key === 'ArrowUp' && (index === 0 || active === searchRef.current)) {
        searchRef.current?.focus();
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = index === -1 ? 0 : Math.min(rows.length - 1, Math.max(0, index + step));
      rows[next].focus();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery('');
    triggerRef.current?.focus();
  };

  const pick = (id: string) => {
    onSelect(id);
    close();
  };

  return (
    <div
      className="relative min-w-0 flex-1"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) close();
      }}
    >
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-full min-w-0 justify-start truncate bg-[#161a20] px-3 text-xs font-normal text-zinc-200"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={label ? `Load track on deck ${label}` : 'Load track'}
      >
        {current ? (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-zinc-100">{current.title}</span>
            <span className="truncate text-zinc-400">{current.artist}</span>
          </span>
        ) : (
          <span className="truncate">No track loaded</span>
        )}
      </Button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={label ? `Load track on deck ${label}` : 'Load track'}
          className="absolute left-0 top-full z-50 mt-1 w-96 border bg-[#101214] shadow-xl"
        >
          <div className="flex items-center justify-between border-b px-3 py-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400">Load track</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Close track picker"
              className="text-zinc-400 hover:text-zinc-100"
              onClick={close}
            >
              <X />
            </Button>
          </div>
          <div className="flex items-center gap-2 border-b px-3 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || filtered.length === 0) return;
                event.preventDefault();
                pick(filtered[0].id);
              }}
              placeholder="Search title, artist, BPM or key"
              aria-label="Search tracks"
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-xs text-zinc-100 outline-none placeholder:text-zinc-500"
            />
          </div>
          <div className="max-h-80 overflow-y-auto">
            <div className={cn(ROW_GRID, 'sticky top-0 border-b bg-[#1b2027] py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-400')}>
              <span>Title</span>
              <span>Artist</span>
              <span>BPM</span>
              <span>Key</span>
            </div>
            {filtered.map((track) => {
              const played = playedIds?.has(track.id);
              return (
                <button
                  key={track.id}
                  data-track
                  type="button"
                  onClick={() => pick(track.id)}
                  className={cn(
                    ROW_GRID,
                    'w-full border-b/80 py-0.5 text-left text-xs hover:bg-[#171c22] focus-visible:bg-[#171c22] focus-visible:outline-none',
                    track.id === selectedId && 'bg-[#2a3340]',
                    played && 'opacity-40',
                  )}
                >
                  <span className="truncate font-medium text-zinc-100">{track.title}</span>
                  <span className="truncate text-zinc-400">{track.artist}</span>
                  <span className="font-mono text-zinc-300">{track.bpm > 0 ? track.bpm : '—'}</span>
                  <span className="font-mono text-zinc-300" style={{ color: track.key ? keyColor(track.key) : undefined }}>
                    {track.key ? formatKey(track.key, KeyNotationType.Camelot) : '—'}
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && <p className="px-3 py-6 text-center text-xs text-zinc-500">No matching tracks</p>}
          </div>
        </div>
      )}
    </div>
  );
}