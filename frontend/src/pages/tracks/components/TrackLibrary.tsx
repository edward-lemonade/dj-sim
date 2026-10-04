import {
  type ChangeEvent,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from 'cn';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ChevronDown,
  GripVertical,
  Loader2,
  Search,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { peaksFromOverview } from '@/lib/utils/threeBandWaveform';
import { SongCover } from '@/components/SongCover';
import { TrackLibraryStatus, type Track } from '@/lib/types/bruh';
import { WaveformCanvas } from '../../../components/WaveformCanvas';
import { WaveformVariant } from '@/components/WaveformCanvas';
import { rowShift, useListItemMove } from '../../../hooks/useListItemMove'; // adjust path
import { trackSeconds } from '@/lib/types/Cues';
import { CueTicks } from '../../../components/CueTicks';
import { CircularProgress } from '@/components/CircularProgress';
import { KeyNotationType } from '@/constants/KeyNotation';
import { formatKey, keyColor } from '@/lib/utils/formatKey';

const STORAGE_KEY = 'dj-sim.tracks.columnWidths';

// grip, cover and actions are fixed, icon-sized columns. Every other column is
// "flex": their widths always sum to (container width - fixed columns), and
// dragging the border between any two of them moves pixels from one to the
// other (reciprocal), so the total never drifts and the table never needs
// horizontal scroll or trailing dead space.
const GRIP_WIDTH = 24;
const COVER_WIDTH = 40;
const ACTIONS_WIDTH = 64;
const FIXED_TOTAL = GRIP_WIDTH + COVER_WIDTH + ACTIONS_WIDTH;

enum FixedColumnId {
  Grip = 'grip',
  Cover = 'cover',
  Actions = 'actions',
}

const FIXED_WIDTHS: Record<FixedColumnId, number> = {
  [FixedColumnId.Grip]: GRIP_WIDTH,
  [FixedColumnId.Cover]: COVER_WIDTH,
  [FixedColumnId.Actions]: ACTIONS_WIDTH,
};

enum FlexColumnId {
  Title = 'title',
  Artist = 'artist',
  Bpm = 'bpm',
  Key = 'key',
  Duration = 'duration',
  Waveform = 'waveform',
}
const FLEX_ORDER: FlexColumnId[] = [
  FlexColumnId.Title,
  FlexColumnId.Artist,
  FlexColumnId.Bpm,
  FlexColumnId.Key,
  FlexColumnId.Duration,
  FlexColumnId.Waveform,
];

const MIN_WIDTHS: Record<FlexColumnId, number> = {
  [FlexColumnId.Title]: 100,
  [FlexColumnId.Artist]: 80,
  [FlexColumnId.Bpm]: 44,
  [FlexColumnId.Key]: 44,
  [FlexColumnId.Duration]: 56,
  [FlexColumnId.Waveform]: 100,
};

const DEFAULT_WIDTHS: Record<FlexColumnId, number> = {
  [FlexColumnId.Title]: 260,
  [FlexColumnId.Artist]: 160,
  [FlexColumnId.Bpm]: 56,
  [FlexColumnId.Key]: 56,
  [FlexColumnId.Duration]: 68,
  [FlexColumnId.Waveform]: 200,
};

// 'custom' is the manual order, i.e. the order of the `songs` array itself.
// Every other field is a derived view of it.
enum SortField {
  Custom = 'custom',
  Added = 'added',
  Title = 'title',
  Artist = 'artist',
  Bpm = 'bpm',
  Key = 'key',
  Duration = 'duration',
}
enum SortDirection {
  Ascending = 'asc',
  Descending = 'desc',
}

const SORT_LABELS: Record<SortField, string> = {
  [SortField.Custom]: 'Custom',
  [SortField.Added]: 'Date added',
  [SortField.Title]: 'Title',
  [SortField.Artist]: 'Artist',
  [SortField.Bpm]: 'BPM',
  [SortField.Key]: 'Key',
  [SortField.Duration]: 'Duration',
};

// null = no value, always sorted to the end
function sortValue(song: Track, field: Exclude<SortField, SortField.Custom>): string | number | null {
  switch (field) {
    case SortField.Added:
      return song.createdAt ?? null;
    case SortField.Title:
      return song.title;
    case SortField.Artist:
      return song.artist;
    case SortField.Bpm:
      return song.bpm > 0 ? song.bpm : null;
    case SortField.Key:
      return song.key ? formatKey(song.key, KeyNotationType.Camelot) : null;
    case SortField.Duration:
      return trackSeconds(song);
  }
}

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
  onAnalyze,
  onCancelAnalyze,
  loading,
}: {
  songs: Track[];
  setSongs: Dispatch<SetStateAction<Track[]>>;
  selectedId: string | null;
  openedId: string | null;
  uploadRef: MutableRefObject<HTMLInputElement | null>;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelect: (id: string) => void;
  onOpen: (song: Track | null) => void;
  onDelete: (song: Track) => void;
  onAnalyze: (song: Track) => void;
  onCancelAnalyze: (song: Track) => void;
  loading: boolean;
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
  const [keyNotation, setKeyNotation] = useState<KeyNotationType>(KeyNotationType.Camelot);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const [sortField, setSortField] = useState<SortField>(SortField.Custom);
  const [sortDirection, setSortDirection] = useState<SortDirection>(SortDirection.Ascending);
  // Memoized so the list handed to useListItemMove keeps the same identity
  // between renders (the hook re-renders this component on every pointer move
  // during a drag).
  const visibleSongs = useMemo(() => {
    const filtered = normalizedQuery
      ? songs.filter(
          (song) =>
            song.title.toLowerCase().includes(normalizedQuery) ||
            song.artist.toLowerCase().includes(normalizedQuery),
        )
      : songs;
    if (sortField === SortField.Custom) return filtered;
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sortField);
      const bv = sortValue(b, sortField);
      if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
      const result =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
      return sortDirection === SortDirection.Ascending ? result : -result;
    });
  }, [songs, normalizedQuery, sortField, sortDirection]);

  // With a search active, the visible rows are a subset, so there's no
  // unambiguous place to write a reorder back to. Drag works in every sort
  // mode otherwise.
  const canReorder = !normalizedQuery;

  // The hook reorders what's on screen. Whatever order the user ends up with
  // becomes the new custom order, and the sort switches to custom (ascending,
  // since custom is stored in display order) so the list doesn't jump back.
  // Stable identity (reads the latest list through a ref) so the hook doesn't
  // see a new setItems on every render.
  const visibleRef = useRef(visibleSongs);
  visibleRef.current = visibleSongs;
  const commitReorder = useCallback<Dispatch<SetStateAction<Track[]>>>(
    (action) => {
      const current = visibleRef.current;
      const next = typeof action === 'function' ? action(current) : action;
      const unchanged = next.length === current.length && next.every((song, i) => song.id === current[i].id);
      if (unchanged) return;
      setSongs(next);
      setSortField(SortField.Custom);
      setSortDirection(SortDirection.Ascending);
    },
    [setSongs],
  );

  // Row reordering. Rows are flush (no gap) and the sticky header occupies the
  // top of the scroll area, so it acts as the list's "padding".
  const { drag, draggedItem, stride, onRowPointerDown } = useListItemMove({
    items: visibleSongs,
    setItems: commitReorder,
    listRef: wrapperRef,
    rowGap: 0,
    listPadding: headerHeight,
    canDrag: (song) => canReorder && song.libraryStatus !== TrackLibraryStatus.Uploading,
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
    [FixedColumnId.Grip, ''],
    [FixedColumnId.Cover, ''],
    [FlexColumnId.Title, 'Title'],
    [FlexColumnId.Artist, 'Artist'],
    [FlexColumnId.Bpm, 'BPM'],
    [FlexColumnId.Key, 'Key'],
    [FlexColumnId.Duration, 'Duration'],
    [FlexColumnId.Waveform, 'Waveform'],
    [FixedColumnId.Actions, ''],
  ];

  const isFixed = (id: string): id is FixedColumnId => Object.values(FixedColumnId).some((column) => column === id);

  return (
    <section className="flex min-h-0 flex-1 flex-col border-t bg-[#0d0f12]">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Library</p>
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{songs.length} tracks</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title or artist"
            className="h-7 w-52 rounded-md border bg-transparent px-2 text-xs text-zinc-200 outline-none placeholder:text-zinc-500 focus:border-zinc-500"
          />
          {/* Sort field and direction share one bordered control. The native
              arrow is replaced so it can sit inside the padding. */}
          <div className="flex h-7 items-center rounded-md border focus-within:border-zinc-500">
            <div className="relative h-full">
              <select
                aria-label="Sort by"
                value={sortField}
                onChange={(event) => {
                  const selected = Object.values(SortField).find((field) => field === event.target.value);
                  if (selected) setSortField(selected);
                }}
                className="h-full appearance-none rounded-l-md bg-transparent pl-2 pr-7 text-xs text-zinc-200 outline-none"
              >
                {Object.entries(SORT_LABELS).map(([value, label]) => (
                  <option key={value} value={value} className="bg-[#1b2027]">
                    {label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-zinc-500" />
            </div>
            <span aria-hidden className="h-full w-px shrink-0 bg-border" />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={sortDirection === SortDirection.Ascending ? 'Ascending' : 'Descending'}
                    disabled={sortField === SortField.Custom}
                    className="h-full w-7 rounded-l-none rounded-r-md text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-100 disabled:opacity-30"
                    onClick={() => setSortDirection((current) => (
                      current === SortDirection.Ascending
                        ? SortDirection.Descending
                        : SortDirection.Ascending
                    ))}
                  />
                }
              >
                {sortDirection === SortDirection.Ascending ? <ArrowUp /> : <ArrowDown />}
              </TooltipTrigger>
              <TooltipContent>{sortDirection === SortDirection.Ascending ? 'Ascending' : 'Descending'}</TooltipContent>
            </Tooltip>
          </div>
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
                  <th key={id} className="relative truncate border-b px-2 py-1 font-medium">
                    {label}
                    {id === FlexColumnId.Key && (
                      <Tooltip>
                        <TooltipTrigger
                          delay={0}
                          render={
                            <button
                              type="button"
                              aria-label="Switch key notation"
                              className="ml-1 inline-flex size-4 items-center justify-center align-middle text-zinc-500 hover:text-zinc-200"
                              onClick={() => setKeyNotation((current) => (current === KeyNotationType.Standard ? KeyNotationType.Camelot : KeyNotationType.Standard))}
                            />
                          }
                        >
                          <ArrowLeftRight className="size-3" />
                        </TooltipTrigger>
                        <TooltipContent>{KeyNotationType[keyNotation]}</TooltipContent>
                      </Tooltip>
                    )}
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
            {visibleSongs.map((song, index) => {
              const selected = selectedId === song.id;
              const opened = openedId === song.id;
              const analyzing = song.libraryStatus === TrackLibraryStatus.Analyzing;
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
                  data-drag-row
                  onClick={() => onSelect(song.id)}
                  onDoubleClick={() => onOpen(opened ? null : song)}
                  style={{
                    transform: shift ? `translateY(${shift}px)` : undefined,
                    transition: drag ? 'transform 150ms ease' : undefined,
                  }}
                  className={cn(
                    'cursor-default border-b/80',
                    selected ? 'bg-[#2a3340]' : opened ? 'bg-[#1c242e]' : 'hover:bg-[#171c22]',
                    song.libraryStatus === TrackLibraryStatus.Error && 'bg-red-950/40',
                    song.libraryStatus === TrackLibraryStatus.Uploading && 'opacity-60',
                    isDragged && 'opacity-30',
                  )}
                >
                  <td className="px-0 py-0.5" onDoubleClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      aria-label={`Reorder ${song.title}`}
                      disabled={song.libraryStatus === TrackLibraryStatus.Uploading || !canReorder}
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
                  <td
                    className="px-2 py-0.5 font-mono text-zinc-300"
                    style={{ color: song.key ? keyColor(song.key) : undefined }}
                  >
                    {song.key ? formatKey(song.key, keyNotation) : '—'}
                  </td>
                  <td className="px-2 py-0.5 font-mono text-zinc-300">{song.duration}</td>
                  <td className="px-1 py-0.5">
                    <div className="h-6 relative overflow-hidden rounded-sm bg-[#15181d] text-zinc-400">
                      {song.libraryStatus === TrackLibraryStatus.Uploading ? (
                        <CircularProgress percent={song.uploadProgress} />
                      ) : (
                        <>
                          {peaks ? <WaveformCanvas variant={WaveformVariant.Mini} peaks={peaks} /> : null}
                          <CueTicks cues={song.cues} seconds={trackSeconds(song)} />
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-1 py-0.5" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                    <div className="flex items-center">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label="Delete track"
                              className="text-zinc-400 hover:bg-red-500/20 hover:text-red-300"
                              disabled={song.libraryStatus === TrackLibraryStatus.Uploading}
                              onClick={(event) => {
                                event.stopPropagation();
                                void onDelete(song);
                              }}
                            />
                          }
                        >
                          <Trash2 />
                        </TooltipTrigger>
                        <TooltipContent>Delete track</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={analyzing ? 'Stop analysis' : 'Analyze track'}
                              className="group text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-100"
                              disabled={song.libraryStatus === TrackLibraryStatus.Uploading}
                              onClick={(event) => {
                                event.stopPropagation();
                                analyzing ? onCancelAnalyze(song) : onAnalyze(song);
                              }}
                            />
                          }
                        >
                          {analyzing ? (
                            <>
                              <Loader2 className="animate-spin group-hover:hidden" />
                              <Square className="hidden fill-current group-hover:block" />
                            </>
                          ) : (
                            <Search />
                          )}
                        </TooltipTrigger>
                        <TooltipContent>{analyzing ? 'Stop analysis' : 'Analyze track'}</TooltipContent>
                      </Tooltip>
                    </div>
                  </td>
                </tr>
              );
            })}
            {visibleSongs.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-zinc-500">
                  {loading ? (
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  ) : songs.length === 0 ? (
                    'No tracks yet. Upload an audio file to start your library.'
                  ) : (
                    'No tracks match your search.'
                  )}
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