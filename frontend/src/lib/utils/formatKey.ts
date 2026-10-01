import { STANDARD_TO_CAMELOT, KeyNotationType } from "@/constants/KeyNotation";
import type { Track } from "../types/Track";

export function formatKey(key: string, notation: KeyNotationType) {
  if (notation === KeyNotationType.Standard) return key;
  const [note = '', quality = ''] = key.trim().replace('♯', '#').replace('♭', 'b').split(/\s+/);
  const normalized = `${note.charAt(0).toUpperCase()}${note.slice(1)} ${quality.toLowerCase()}`;
  return STANDARD_TO_CAMELOT[normalized] ?? key;
}

export function keyColor(key: NonNullable<Track['key']>): string | undefined {
  const number = parseInt(formatKey(key, KeyNotationType.Camelot), 10);
  if (Number.isNaN(number)) return undefined;
  // 12 hues, 30deg apart
  return `hsl(${(number - 1) * 30}, 70%, 65%)`;
}