import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { AlertTriangle, Loader2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TrackLibraryStatus, type Track } from '@/lib/types/Track';
import type { PreparedTrackFile } from '@/hooks/useTrackUpload';

function normalized(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function hasMatchingMetadata(candidate: PreparedTrackFile, other: { artist: string; title: string }) {
  const artist = normalized(candidate.metadata?.artist ?? '');
  const title = normalized(candidate.metadata?.title ?? '');
  if (!artist || !title) return false;

  return normalized(other.artist) === artist && normalized(other.title) === title;
}

function duplicateMatches(candidate: PreparedTrackFile, stagedFiles: PreparedTrackFile[], songs: Track[]) {
  const matchesLibrary = songs.some((song) =>
    song.libraryStatus !== TrackLibraryStatus.Uploading &&
    !song.id.startsWith('upload-') &&
    hasMatchingMetadata(candidate, song),
  );
  const matchesBatch = stagedFiles.some((other) =>
    other.id !== candidate.id &&
    other.metadata !== null &&
    hasMatchingMetadata(candidate, other.metadata),
  );

  return matchesLibrary || matchesBatch;
}

export function TrackUploadModal({
  open,
  songs,
  actionsReady,
  onOpenChange,
  onPrepareFiles,
  onUploadFiles,
}: {
  open: boolean;
  songs: Track[];
  actionsReady: boolean;
  onOpenChange: (open: boolean) => void;
  onPrepareFiles: (files: File[]) => Promise<PreparedTrackFile[]>;
  onUploadFiles: (files: PreparedTrackFile[]) => Promise<void>;
}) {
  const [step, setStep] = useState<'select' | 'confirm'>('select');
  const [stagedFiles, setStagedFiles] = useState<PreparedTrackFile[]>([]);
  const [preparingCount, setPreparingCount] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const preparationEpoch = useRef(0);
  const dragDepth = useRef(0);

  const filesWithDuplicates = useMemo(
    () => stagedFiles.map((item) => ({
      ...item,
      duplicate: duplicateMatches(item, stagedFiles, songs),
    })),
    [songs, stagedFiles],
  );
  const duplicateCount = filesWithDuplicates.filter((item) => item.duplicate).length;
  const preparedFiles = filesWithDuplicates.filter((item) => item.metadata !== null);
  const hasPreparationErrors = filesWithDuplicates.some((item) => item.error !== null);
  const canStartUpload =
    actionsReady &&
    stagedFiles.length > 0 &&
    preparingCount === 0 &&
    !hasPreparationErrors;

  const close = () => {
    preparationEpoch.current += 1;
    setStep('select');
    setStagedFiles([]);
    setPreparingCount(0);
    onOpenChange(false);
  };

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const epoch = preparationEpoch.current;
    setPreparingCount((count) => count + files.length);
    try {
      const prepared = await onPrepareFiles(files);
      if (epoch === preparationEpoch.current) {
        setStagedFiles((current) => [...current, ...prepared]);
      }
    } catch (cause) {
      if (epoch === preparationEpoch.current) {
        const error = cause instanceof Error ? cause.message : 'Could not prepare this file.';
        setStagedFiles((current) => [
          ...current,
          ...files.map((file) => ({
            id: `staged-error-${crypto.randomUUID()}`,
            file,
            metadata: null,
            error,
          })),
        ]);
      }
    } finally {
      if (epoch === preparationEpoch.current) {
        setPreparingCount((count) => Math.max(0, count - files.length));
      }
    }
  };

  const selectFiles = (files: FileList | null) => {
    if (!files) return;
    void addFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!actionsReady) return;
    void addFiles(Array.from(event.dataTransfer.files));
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!actionsReady) return;
    dragDepth.current += 1;
    setDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (actionsReady) {
      event.dataTransfer.dropEffect = 'copy';
      setDragging(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    setDragging(false);
  };

  const handleDropAreaKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    fileInputRef.current?.click();
  };

  const beginUpload = () => {
    if (!canStartUpload) return;
    if (duplicateCount > 0) {
      setStep('confirm');
      return;
    }
    void confirmUpload(preparedFiles);
  };

  const confirmUpload = async (files: PreparedTrackFile[]) => {
    setStep('select');
    setStagedFiles([]);
    onOpenChange(false);
    await onUploadFiles(files);
  };

  return (
    <>
      <Dialog
        open={open && step === 'select'}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) close();
        }}
      >
        <DialogContent
          className="overflow-hidden border border-white/10 bg-[#101419] text-zinc-100 shadow-[0_24px_80px_rgba(0,0,0,.65)] ring-white/10"
          style={{
            width: 'min(48rem, calc(100vw - 2rem))',
            height: 'auto',
            maxWidth: 'calc(100vw - 2rem)',
            maxHeight: 'calc(100dvh - 2rem)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-lg font-bold tracking-tight text-white">Upload tracks</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Choose audio files or drop them here. Nothing uploads until you confirm.
            </DialogDescription>
          </DialogHeader>

          <div
            className="flex min-h-0 gap-4"
            style={{ height: '12rem', flex: 'none' }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              multiple
              disabled={!actionsReady}
              className="hidden"
              onChange={(event) => selectFiles(event.currentTarget.files)}
            />
            <div
              role="button"
              tabIndex={actionsReady ? 0 : -1}
              aria-label="Choose audio files or drop them here"
              aria-disabled={!actionsReady}
              onClick={() => actionsReady && fileInputRef.current?.click()}
              onKeyDown={handleDropAreaKeyDown}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`flex shrink-0 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed px-3 py-4 text-center text-zinc-300 transition-colors ${
                !actionsReady ? 'cursor-not-allowed opacity-50' : 'hover:border-white/35 hover:bg-white/5'
              }`}
              style={{
                width: '12rem',
                height: '12rem',
                flex: '0 0 12rem',
                backgroundColor: dragging ? 'rgba(1, 1, 1, 0.2)' : 'rgba(0, 0, 0, 0.2)',
                borderColor: dragging ? '#fed7aa' : 'rgba(255, 255, 255, 0.2)',
                boxShadow: dragging ? '0 0 0 4px rgba(253, 186, 116, 0.4), 0 0 32px rgba(253, 186, 116, 0.35)' : undefined,
                color: dragging ? '#fff' : undefined,
              }}
            >
              <Upload className={`size-5 ${dragging ? 'text-orange-100' : 'text-zinc-400'}`} aria-hidden="true" />
              <span className="text-sm font-medium">Drop audio files here or browse</span>
              <span className="text-xs text-zinc-500">You can select multiple tracks</span>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2" style={{ minWidth: 0 }}>
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Selected tracks</span>
                <span>{stagedFiles.length}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-md border border-white/10 bg-black/20">
                {filesWithDuplicates.length === 0 && preparingCount === 0 ? (
                  <p className="px-3 py-7 text-center text-sm text-zinc-500">No tracks selected yet.</p>
                ) : (
                  <ul className="divide-y divide-white/5">
                    {filesWithDuplicates.map((item) => {
                      const label = item.metadata?.title || item.file.name;
                      return (
                        <li key={item.id} className="flex min-h-9 items-center gap-2 px-2 py-1">
                          {item.error ? (
                            <AlertTriangle
                              className="size-4 shrink-0 text-red-400"
                              aria-label="Track preparation error"
                            />
                          ) : item.duplicate ? (
                            <AlertTriangle
                              className="size-4 shrink-0"
                              style={{ color: '#facc15', stroke: '#facc15' }}
                              aria-label="Duplicate track"
                            />
                          ) : null}
                          <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
                            {item.error ? (
                              <span className="truncate text-xs text-red-300">
                                {item.file.name}: {item.error}
                              </span>
                            ) : (
                              <>
                                <span className="truncate text-xs text-zinc-100">{label}</span>
                                <span className="shrink-0 text-xs text-zinc-500">—</span>
                                <span className="truncate text-xs text-zinc-400">{item.metadata?.artist}</span>
                                {item.duplicate && (
                                  <span className="sr-only">Duplicate track</span>
                                )}
                              </>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Remove ${label} from upload`}
                            className="shrink-0 text-zinc-400 hover:text-white"
                            onClick={() => setStagedFiles((current) => current.filter((file) => file.id !== item.id))}
                          >
                            <X />
                          </Button>
                        </li>
                      );
                    })}
                    {preparingCount > 0 && (
                      <li className="flex items-center gap-2 px-3 py-3 text-xs text-zinc-400" aria-live="polite">
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        Preparing {preparingCount} {preparingCount === 1 ? 'track' : 'tracks'}...
                      </li>
                    )}
                  </ul>
                )}
              </div>
              {hasPreparationErrors && (
                <p className="text-xs text-red-300">Remove files with errors before uploading.</p>
              )}
            </div>
          </div>

          <DialogFooter className="border-white/10 bg-[#0b0e13]">
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="button" disabled={!canStartUpload} onClick={beginUpload}>
              <Upload />
              Upload {preparedFiles.length > 0 ? `(${preparedFiles.length})` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={open && step === 'confirm'}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) close();
        }}
      >
        <DialogContent
          className="max-w-md border border-white/10 bg-[#101419] text-zinc-100 shadow-[0_24px_80px_rgba(0,0,0,.65)] ring-white/10 sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle className="text-lg font-bold tracking-tight text-white">
              Duplicate tracks found
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              {duplicateCount} {duplicateCount === 1 ? 'selected track matches' : 'selected tracks match'} tracks
              already in your library. Choose which tracks to upload.
            </DialogDescription>
          </DialogHeader>
          {duplicateCount === preparedFiles.length && (
            <p className="rounded-md border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
              All selected tracks are duplicates, so there are no new tracks to upload.
            </p>
          )}
          <DialogFooter className="border-white/10 bg-[#0b0e13]">
            <Button type="button" variant="ghost" onClick={() => setStep('select')}>Go back</Button>
            <Button
              type="button"
              variant="outline"
              disabled={duplicateCount === preparedFiles.length}
              className="border-white/15 bg-[#20262e] text-zinc-100 hover:bg-[#2b333d] hover:text-white"
              onClick={() => void confirmUpload(filesWithDuplicates.filter((item) => !item.duplicate))}
            >
              Upload new only
            </Button>
            <Button
              type="button"
              className="bg-zinc-100 text-zinc-900 hover:bg-white"
              onClick={() => void confirmUpload(preparedFiles)}
            >
              Upload all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
