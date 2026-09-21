import { parseBuffer, selectCover, type IPicture, type ITag } from 'music-metadata';

export type ParsedTrackMetadata = {
  title: string;
  artist: string;
  bpm: number;
  key: string;
  duration: string;
  coverUrl: string | null;
  coverDataUrl: string | null;
  coverLabel: string;
};

export function coverLabelFromTitle(title: string) {
  const letters = title.replace(/[^a-zA-Z0-9]/g, '');
  return (letters.slice(0, 2) || 'TR').toUpperCase();
}

export function revokeCoverUrl(url?: string | null) {
  if (url?.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}

export async function readTrackMetadata(file: File): Promise<ParsedTrackMetadata> {
  const fromName = inferFromFilename(file.name);
  let title = fromName.title;
  let artist = fromName.artist;
  let bpm = fromName.bpm;
  let key = '';
  let duration = '--:--';
  let coverUrl: string | null = null;
  let coverDataUrl: string | null = null;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const metadata = await parseBuffer(
      bytes,
      { mimeType: mimeFromFile(file), size: file.size, path: file.name },
      { duration: true, skipCovers: false },
    );

    title = firstText(metadata.common.title) || title;
    artist =
      firstText(metadata.common.artist) ||
      firstText(metadata.common.albumartist) ||
      metadata.common.artists?.map((name) => name.trim()).filter(Boolean).join(', ') ||
      artist;
    bpm =
      parseBpm(metadata.common.bpm) ||
      bpmFromNative(metadata.native) ||
      bpmFromComments(metadata.common.comment) ||
      bpm;
    key = parseKey(metadata.common.key) || keyFromNative(metadata.native);
    duration = formatDuration(metadata.format.duration);

    const cover = selectCover(metadata.common.picture) ?? metadata.common.picture?.[0];
    coverDataUrl = coverDataUrlFromPicture(cover);
    coverUrl = coverDataUrl ?? null;
  } catch (error) {
    console.warn('Could not parse audio tags', error);
  }

  if (duration === '--:--') {
    duration = formatDuration(await durationFromMediaElement(file));
  }

  return {
    title,
    artist,
    bpm,
    key,
    duration,
    coverUrl,
    coverDataUrl,
    coverLabel: coverLabelFromTitle(title),
  };
}

export function inferFromFilename(fileName: string) {
  let name = fileName.replace(/\.[^/.]+$/, '') || 'New track';
  name = name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

  let bpm = 0;
  const bpmMatch = name.match(/(?:^|[^\d])(\d{2,3})\s*bpm\b/i);
  if (bpmMatch) {
    bpm = Number.parseInt(bpmMatch[1], 10);
    name = name.replace(/[-–—]?\s*[\(\[]?\d{2,3}\s*bpm[\)\]]?/gi, ' ').replace(/\s+/g, ' ').trim();
  }

  let artist = 'Unknown Artist';
  let title = name;
  const separator = name.indexOf(' - ');
  if (separator > 0) {
    artist = name.slice(0, separator).trim() || artist;
    title = name.slice(separator + 3).trim() || title;
  }

  return { title: title || 'Untitled Track', artist, bpm };
}

function firstText(value?: string | string[] | null) {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).find(Boolean) || '';
  }
  return value?.trim() || '';
}

function parseKey(value?: string | string[] | null) {
  return firstText(value);
}

function keyFromNative(native?: Record<string, ITag[]>) {
  if (!native) return '';
  for (const tags of Object.values(native)) {
    for (const tag of tags ?? []) {
      const id = String(tag.id ?? '').toLowerCase();
      if (
        id === 'tkey' ||
        id === 'initialkey' ||
        id.endsWith(':tkey') ||
        id.endsWith(':initialkey') ||
        id.includes('initialkey')
      ) {
        const key = parseKey(typeof tag.value === 'string' ? tag.value : String(tag.value ?? ''));
        if (key) return key;
      }
      if (id.includes('txxx') && typeof tag.value === 'object' && tag.value) {
        const description = String((tag.value as { description?: string }).description ?? '').toLowerCase();
        if (description === 'tkey' || description === 'initialkey' || description === 'key') {
          const key = parseKey((tag.value as { text?: string }).text);
          if (key) return key;
        }
      }
    }
  }
  return '';
}

function parseBpm(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 400) {
    return Math.round(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed > 0 && parsed < 400) {
      return Math.round(parsed);
    }
  }
  return 0;
}

function bpmFromNative(native?: Record<string, ITag[]>) {
  if (!native) return 0;
  for (const tags of Object.values(native)) {
    for (const tag of tags ?? []) {
      const id = String(tag.id ?? '').toLowerCase();
      if (id === 'tbpm' || id === 'bpm' || id.endsWith(':bpm') || id.endsWith(':tbpm')) {
        const bpm = parseBpm(tag.value);
        if (bpm) return bpm;
      }
      if (id.includes('txxx') && typeof tag.value === 'object' && tag.value) {
        const description = String((tag.value as { description?: string }).description ?? '').toLowerCase();
        if (description === 'bpm' || description.includes('tempo')) {
          const bpm = parseBpm((tag.value as { text?: string }).text ?? tag.value);
          if (bpm) return bpm;
        }
      }
    }
  }
  return 0;
}

function bpmFromComments(comments?: Array<{ descriptor?: string; text?: string }>) {
  if (!comments) return 0;
  for (const comment of comments) {
    const text = `${comment.descriptor ?? ''} ${comment.text ?? ''}`;
    const match = text.match(/(\d{2,3})\s*bpm/i) || text.match(/\bbpm\s*[:=]?\s*(\d{2,3})/i);
    if (match) {
      const bpm = parseBpm(match[1]);
      if (bpm) return bpm;
    }
  }
  return 0;
}

function formatDuration(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '--:--';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${minutes}:${remaining.toString().padStart(2, '0')}`;
}

function coverDataUrlFromPicture(picture?: IPicture | null) {
  const bytes = toUint8Array(picture?.data);
  if (!bytes || bytes.byteLength === 0) return null;
  const mimeType = imageMime(picture?.format);
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function toUint8Array(data: unknown): Uint8Array | null {
  if (!data) return null;
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (Array.isArray(data)) return Uint8Array.from(data);
  if (typeof data === 'object' && data !== null && 'data' in data) {
    return toUint8Array((data as { data: unknown }).data);
  }
  return null;
}

function imageMime(format?: string) {
  const value = (format || 'image/jpeg').toLowerCase();
  if (value === 'image/jpg' || value === 'jpg' || value === 'jpeg') return 'image/jpeg';
  if (value === 'png' || value === 'image/png') return 'image/png';
  if (value === 'webp' || value === 'image/webp') return 'image/webp';
  if (value.startsWith('image/')) return value;
  return `image/${value}`;
}

function mimeFromFile(file: File) {
  if (file.type && file.type !== 'application/octet-stream') return file.type;
  switch (file.name.split('.').pop()?.toLowerCase()) {
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'flac':
      return 'audio/flac';
    case 'm4a':
    case 'mp4':
      return 'audio/mp4';
    case 'aac':
      return 'audio/aac';
    case 'ogg':
    case 'oga':
      return 'audio/ogg';
    case 'aiff':
    case 'aif':
      return 'audio/aiff';
    default:
      return file.type || 'application/octet-stream';
  }
}

function durationFromMediaElement(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const finish = (value?: number) => {
      window.clearTimeout(timer);
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(undefined), 4000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const value = audio.duration;
      finish(Number.isFinite(value) && value > 0 ? value : undefined);
    };
    audio.onerror = () => finish(undefined);
    audio.src = url;
  });
}
