import {
  type ChangeEvent,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react';
import { cn } from 'cn';
import { GripVertical, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { peaksFromOverview } from '@/lib/utils/threeBandWaveform';
import { SongCover } from '@/components/SongCover';
import type { Track } from '@/lib/types/Track';
import { WaveformCanvas } from '../../../components/WaveformCanvas';
import { rowShift, useListItemMove } from '../../../hooks/useListItemMove'; // adjust path
import { CUE_COLORS, trackSeconds } from '@/lib/types/Cues';
import { CueTicks } from '../../../components/CueTicks';

const STORAGE_KEY = 'dj-sim.tracks.columnWidths';

// grip, cover and actions are fixed, icon-sized columns. Every other column is
// "flex": their widths always sum to (container width - fixed columns), and
// dragging the border between any two of them moves pixels from one to the
// other (reciprocal), so the total never drifts and the table never needs
// horizontal scroll or trailing dead space.
const GRIP_WIDTH = 24;
const COVER_WIDTH = 40;
const ACTIONS_WIDTH = 40;
const FIXED_TOTAL = GRIP_WIDTH + COVER_WIDTH + ACTIONS_WIDTH;

type FixedColumnId = 'grip' | 'cover' | 'actions';
const FIXED_WIDTHS: Record<FixedColumnId, number> = {
  grip: GRIP_WIDTH,
  cover: COVER_WIDTH,
  actions: ACTIONS_WIDTH,
};

const FLEX_ORDER = ['title', 'artist', 'bpm', 'key', 'duration', 'waveform'] as const;
type FlexColumnId = (typeof FLEX_ORDER)[number];

const MIN_WIDTHS: Record<FlexColumnId, number> = {
  title: 100,
  artist: 80,
  bpm: 44,
  key: 44,
  duration: 56,
  waveform: 100,
};

const DEFAULT_WIDTHS: Record<FlexColumnId, number> = {
  title: 260,
  artist: 160,
  bpm: 56,
  key: 56,
  duration: 68,
  waveform: 200,
};

function loadWidths(): Record<FlexColumnId, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_WIDTHS };
    const parsed = JSON.parse(raw) as Partial<Record<FlexColumnId, number>>;
    return { ...DEFAULT_WIDTHS, ...parsed };
  } catch {
    return { ...DEFAULT_WIDTHS };
  }
}

export function TrackLibrary({
  songs,
  setSongs,
  selectedId,
  openedId,
  uploadRef,
  onUpload,
  onSelect,
  onOpen,
  onDelete,
}: {
  songs: Track[];
  setSongs: Dispatch<SetStateAction<Track[]>>;
  selectedId: string | null;
  openedId: string | null;
  uploadRef: MutableRefObject<HTMLInputElement | null>;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelect: (id: string) => void;
  onOpen: (song: Track) => void;
  onDelete: (song: Track) => void;
}) {
  const [widths, setWidths] = useState<Record<FlexColumnId, number>>(loadWidths);
  const dragCol = useRef<{
    leftId: FlexColumnId;
    rightId: FlexColumnId;
    startX: number;
    startLeft: number;
    startRight: number;
  } | null>(null);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const theadRef = useRef<HTMLTableSectionElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(24);

  // Row reordering. Rows are flush (no gap) and the sticky header occupies the
  // top of the scroll area, so it acts as the list's "padding".
  const { drag, draggedItem, stride, onRowPointerDown } = useListItemMove({
    items: songs,
    setItems: setSongs,
    listRef: wrapperRef,
    rowGap: 0,
    listPadding: headerHeight,
    canDrag: (song) => song.libraryStatus !== 'uploading',
  });

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = theadRef.current;
    if (!el) return;
    const measure = () => setHeaderHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the flex columns exactly filling (container - fixed columns),
  // scaling proportionally so drags you've made stay roughly in ratio.
  useEffect(() => {
    if (containerWidth <= 0) return;
    const minTotal = FLEX_ORDER.reduce((sum, id) => sum + MIN_WIDTHS[id], 0);
    const target = Math.max(minTotal, containerWidth - FIXED_TOTAL);

    setWidths((current) => {
      const sum = FLEX_ORDER.reduce((s, id) => s + current[id], 0);
      if (Math.abs(sum - target) < 1) return current;

      const scale = target / sum;
      const next: Record<FlexColumnId, number> = { ...current };
      let allocated = 0;
      FLEX_ORDER.forEach((id, i) => {
        if (i === FLEX_ORDER.length - 1) {
          next[id] = Math.max(MIN_WIDTHS[id], target - allocated);
        } else {
          const w = Math.max(MIN_WIDTHS[id], Math.round(current[id] * scale));
          next[id] = w;
          allocated += w;
        }
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, [containerWidth]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragCol.current;
      if (!drag) return;
      const delta = event.clientX - drag.startX;
      const pairTotal = drag.startLeft + drag.startRight;

      let newLeft = drag.startLeft + delta;
      newLeft = Math.max(MIN_WIDTHS[drag.leftId], Math.min(newLeft, pairTotal - MIN_WIDTHS[drag.rightId]));
      const newRight = pairTotal - newLeft;

      setWidths((current) => {
        const updated = { ...current, [drag.leftId]: newLeft, [drag.rightId]: newRight };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });
    };
    const onUp = () => {
      dragCol.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const columns: Array<[FlexColumnId | FixedColumnId, string]> = [
    ['grip', ''],
    ['cover', ''],
    ['title', 'Title'],
    ['artist', 'Artist'],
    ['bpm', 'BPM'],
    ['key', 'Key'],
    ['duration', 'Time'],
    ['waveform', 'Waveform'],
    ['actions', ''],
  ];

  const isFixed = (id: string): id is FixedColumnId => id in FIXED_WIDTHS;

  return (
    <section className="flex min-h-0 flex-1 flex-col border-t border-zinc-800 bg-[#0d0f12]">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Library</p>
          <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-400">{songs.length} tracks</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={uploadRef}
            type="file"
            accept="audio/*"
            multiple
            className="hidden"
            onChange={onUpload}
          />
          <Button
            size="sm"
            className="h-7 bg-zinc-100 text-zinc-900 hover:bg-white"
            onClick={() => uploadRef.current?.click()}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Upload
          </Button>
        </div>
      </div>

      <div ref={wrapperRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <table className="w-full border-separate border-spacing-0 text-left text-xs text-zinc-200" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            {columns.map(([id]) => (
              <col key={id} style={{ width: isFixed(id) ? FIXED_WIDTHS[id] : widths[id] }} />
            ))}
          </colgroup>
          <thead ref={theadRef} className="sticky top-0 z-10">
            <tr className="bg-[#1b2027] text-[10px] uppercase tracking-[0.16em] text-zinc-400">
              {columns.map(([id, label]) => {
                const isFlex = !isFixed(id);
                const nextId = isFlex ? FLEX_ORDER[FLEX_ORDER.indexOf(id as FlexColumnId) + 1] : undefined;
                // handle sits on the right edge of every flex column that has a flex neighbor to its right
                const showHandle = isFlex && nextId !== undefined;
                return (
                  <th key={id} className="relative truncate border-b border-zinc-800 px-2 py-1 font-medium">
                    {label}
                    {showHandle && (
                      <span
                        className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize hover:bg-orange-400/70"
                        onPointerDown={(event) => {
                          event.preventDefault();
                          const leftId = id as FlexColumnId;
                          const rightId = nextId as FlexColumnId;
                          dragCol.current = {
                            leftId,
                            rightId,
                            startX: event.clientX,
                            startLeft: widths[leftId],
                            startRight: widths[rightId],
                          };
                        }}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {songs.map((song, index) => {
              const selected = selectedId === song.id;
              const opened = openedId === song.id;
              const peaks = peaksFromOverview(song.waveformOverview);

              const isDragged = drag?.id === song.id;
              // The dragged row acts as a placeholder that slides to the drop
              // slot; every other row shifts out of its way.
              const shift = drag
                ? isDragged
                  ? (drag.toIndex - drag.fromIndex) * stride
                  : rowShift(index, drag.fromIndex, drag.toIndex, stride)
                : 0;

              return (
                <tr
                  key={song.id}
                  data-song-row
                  onClick={() => onSelect(song.id)}
                  onDoubleClick={() => onOpen(song)}
                  style={{
                    transform: shift ? `translateY(${shift}px)` : undefined,
                    transition: drag ? 'transform 150ms ease' : undefined,
                  }}
                  className={cn(
                    'cursor-default border-b border-zinc-800/80',
                    selected ? 'bg-[#2a3340]' : opened ? 'bg-[#1c242e]' : 'hover:bg-[#171c22]',
                    song.libraryStatus === 'error' && 'bg-red-950/40',
                    song.libraryStatus === 'uploading' && 'opacity-60',
                    isDragged && 'opacity-30',
                  )}
                >
                  <td className="px-0 py-0.5" onDoubleClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      aria-label={`Reorder ${song.title}`}
                      disabled={song.libraryStatus === 'uploading'}
                      onPointerDown={(event) => onRowPointerDown(event, song)}
                      className="flex h-6 w-full touch-none cursor-grab items-center justify-center text-zinc-600 hover:text-zinc-300 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <GripVertical className="h-3.5 w-3.5" />
                    </button>
                  </td>
                  <td className="px-1 py-0.5">
                    <SongCover song={song} className="h-6 w-6 shadow-none" />
                  </td>
                  <td className="truncate px-2 py-0.5 font-medium text-zinc-100">{song.title}</td>
                  <td className="truncate px-2 py-0.5 text-zinc-400">{song.artist}</td>
                  <td className="px-2 py-0.5 font-mono text-zinc-300">{song.bpm > 0 ? song.bpm : '—'}</td>
                  <td className="px-2 py-0.5 font-mono text-zinc-300">{song.key || '—'}</td>
                  <td className="px-2 py-0.5 font-mono text-zinc-300">{song.duration}</td>
                  <td className="px-1 py-0.5">
                    <div className="h-6 relative overflow-hidden rounded-sm bg-[#15181d]">
                      {peaks ? <WaveformCanvas variant="mini" peaks={peaks} /> : null}
                      <CueTicks cues={song.cues} seconds={trackSeconds(song)} />
                    </div>
                  </td>
                  <td className="px-1 py-0.5" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-zinc-400 hover:bg-red-500/20 hover:text-red-300"
                      disabled={song.libraryStatus === 'uploading'}
                      onClick={(event) => {
                        event.stopPropagation();
                        void onDelete(song);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              );
            })}
            {songs.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-zinc-500">
                  No tracks yet. Upload an audio file to start your library.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Floating copy of the row that follows the pointer while dragging */}
      {drag && draggedItem && (
        <div
          className="pointer-events-none fixed z-50 flex items-center gap-2 rounded-sm border border-orange-400/60 bg-[#2a3340] px-2 text-xs shadow-xl"
          style={{
            width: drag.width,
            height: drag.height,
            left: drag.x - drag.offsetX,
            top: drag.y - drag.offsetY,
          }}
        >
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-zinc-300" />
          <SongCover song={draggedItem} className="h-6 w-6 shrink-0 shadow-none" />
          <span className="truncate font-medium text-zinc-100">{draggedItem.title}</span>
          <span className="truncate text-zinc-400">{draggedItem.artist}</span>
        </div>
      )}
    </section>
  );
}