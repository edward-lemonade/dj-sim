import type { WaveformOverview } from '@/lib/types/track';

export const OVERVIEW_COLUMNS = 1600;
export const HIRES_COLUMNS = 12000;

export type ThreeBandPeaks = {
  lows: Float32Array;
  mids: Float32Array;
  highs: Float32Array;
  durationSeconds: number;
};

export type WaveformDrawOptions = {
  playhead?: number;
  viewportStart?: number;
  viewportEnd?: number;
  showViewport?: boolean;
  background?: string;
  // Mono draw only: draw one sample every `resolution` device pixels instead
  // of every pixel, filling that whole block in one fillRect call. Higher =
  // fewer amplitude computations and fillRect calls, chunkier bars. Ignored
  // by drawRgbWaveform, which always draws at full pixel resolution.
  resolution?: number;
};

type BandLayer = {
  r: number;
  g: number;
  b: number;
  alpha: number;
  // Exponent applied to the already-normalized (0..1) value. >1 suppresses
  // mid-level values (band reads thinner most of the time); <1 lifts them.
  curve: number;
  // Max half-height this band can reach, as a fraction of the canvas height.
  // This is what makes mid *structurally* thinner than lows/highs, independent
  // of how loud the midrange happens to be in a given mix.
  heightFraction: number;
};

// Drawn back-to-front as separate translucent layers (not blended per-column) so
// each band reads as its own overlaid waveform, the way rekordbox renders lows/
// mids/highs as three stacked colors rather than one mixed hue.
//
// Paint order is low -> high -> mid (mid on top), matching rekordbox: mid is
// tuned to normally be the thinnest of the three, so lows and highs poke out
// from underneath it instead of being buried by it.
const LOW_LAYER: BandLayer = { r: 59, g: 130, b: 246, alpha: 1, curve: 0.7, heightFraction: 0.46 };
const HIGH_LAYER: BandLayer = { r: 255, g: 122, b: 24, alpha: 1, curve: 0.7, heightFraction: 0.4 };
const MID_LAYER: BandLayer = { r: 244, g: 244, b: 244, alpha: 1, curve: 0.85, heightFraction: 0.26 };

// Single flat tone used by the cheap one-band path (overview / mini). No band
// colors to layer, so this is just a neutral, legible-on-dark fill.
const MONO_COLOR = 'rgba(203,213,225,0.85)';
const MONO_CURVE = 0.72;
const MONO_HEIGHT_FRACTION = 0.42;

let sharedContext: AudioContext | null = null;

export function getAudioContext() {
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!sharedContext || sharedContext.state === 'closed') {
    sharedContext = new Ctor();
  }
  return sharedContext;
}

export async function decodeToAudioBuffer(source: ArrayBuffer | Blob): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => undefined);
  }
  const buffer = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
  return ctx.decodeAudioData(buffer.slice(0));
}

export function mixToMono(buffer: AudioBuffer): Float32Array {
  const length = buffer.length;
  const channels = buffer.numberOfChannels;
  const out = new Float32Array(length);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      out[i] += data[i];
    }
  }
  if (channels > 1) {
    const inv = 1 / channels;
    for (let i = 0; i < length; i += 1) {
      out[i] *= inv;
    }
  }
  return out;
}

export function computeThreeBandPeaks(buffer: AudioBuffer, columnCount: number): ThreeBandPeaks {
  const columns = Math.max(32, Math.floor(columnCount));
  const mono = mixToMono(buffer);
  const sampleRate = buffer.sampleRate;
  const low = applyBiquad(mono, lowpassCoeffs(250, sampleRate));
  const high = applyBiquad(mono, highpassCoeffs(4000, sampleRate));
  const mid = applyBiquad(applyBiquad(mono, highpassCoeffs(250, sampleRate)), lowpassCoeffs(4000, sampleRate));

  const lows = new Float32Array(columns);
  const mids = new Float32Array(columns);
  const highs = new Float32Array(columns);
  const samplesPerColumn = mono.length / columns;

  for (let i = 0; i < columns; i += 1) {
    const start = Math.floor(i * samplesPerColumn);
    const end = Math.min(mono.length, Math.floor((i + 1) * samplesPerColumn));
    lows[i] = columnEnergy(low, start, end);
    mids[i] = columnEnergy(mid, start, end);
    highs[i] = columnEnergy(high, start, end);
  }

  // Normalize each band independently against its own dynamic range in this
  // track, rather than against a fixed gain assumption. This is what stops
  // quiet masters from under-filling and loud masters from pinning every
  // column to max height.
  normalizeBand(lows);
  normalizeBand(mids);
  normalizeBand(highs);

  return {
    lows,
    mids,
    highs,
    durationSeconds: buffer.duration,
  };
}

// Normalizes a band's raw energy values in place to 0..1, using a high
// percentile as the ceiling rather than the absolute max. A single transient
// spike (a kick hit, a cymbal crash) would otherwise become the ceiling and
// compress every other column toward invisibility; anything above the
// percentile just clips to 1 instead.
function normalizeBand(band: Float32Array, percentile = 0.98) {
  if (band.length === 0) return;
  const sorted = Float32Array.from(band).sort();
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * percentile));
  const ceiling = sorted[idx];
  if (ceiling <= 1e-6) return;
  const inv = 1 / ceiling;
  for (let i = 0; i < band.length; i += 1) {
    band[i] = Math.min(1, band[i] * inv);
  }
}

export async function computeOverviewFromFile(file: File, columnCount = OVERVIEW_COLUMNS): Promise<WaveformOverview> {
  const buffer = await decodeToAudioBuffer(file);
  return peaksToJson(computeThreeBandPeaks(buffer, columnCount));
}

export function peaksToJson(peaks: ThreeBandPeaks): WaveformOverview {
  return {
    lows: Array.from(peaks.lows),
    mids: Array.from(peaks.mids),
    highs: Array.from(peaks.highs),
    durationSeconds: peaks.durationSeconds,
  };
}

export function peaksFromOverview(overview?: WaveformOverview | null): ThreeBandPeaks | null {
  if (!overview?.lows?.length || !overview.mids?.length || !overview.highs?.length) {
    return null;
  }
  return {
    lows: Float32Array.from(overview.lows),
    mids: Float32Array.from(overview.mids),
    highs: Float32Array.from(overview.highs),
    durationSeconds: overview.durationSeconds ?? 0,
  };
}

// Shared setup for both draw paths: sizes the backing store to the canvas's
// current CSS size (accounting for devicePixelRatio) and fills the background.
// Returns null if the canvas has no usable 2D context.
function beginFrame(canvas: HTMLCanvasElement, background: string | undefined) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = background ?? '#0b0d10';
  ctx.fillRect(0, 0, width, height);

  return { ctx, width, height, dpr };
}

// Shared overlay drawing (the highlighted viewport box + playhead line), used
// by both the full 3-band draw and the cheap 1-band draw.
function drawOverlays(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  start: number,
  span: number,
  playhead: number | undefined,
  options: WaveformDrawOptions,
) {
  if (options.showViewport && options.viewportStart != null && options.viewportEnd != null) {
    const x0 = ((options.viewportStart - start) / span) * width;
    const x1 = ((options.viewportEnd - start) / span) * width;
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(x0, 0, Math.max(2, x1 - x0), height);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(1, dpr);
    ctx.strokeRect(x0, 1, Math.max(2, x1 - x0), height - 2);
  }

  if (playhead != null && Number.isFinite(playhead)) {
    const x = ((playhead - start) / span) * width;
    if (x >= 0 && x <= width) {
      ctx.fillStyle = 'rgba(255,255,0,1)';
      ctx.fillRect(x, 0, Math.max(1, dpr), height);
    }
  }
}

// Full 3-band draw, used for the zoomed/scrubbable waveform where the extra
// per-band color detail is worth the extra draw cost.
export function drawRgbWaveform(
  canvas: HTMLCanvasElement,
  peaks: ThreeBandPeaks | null,
  viewStart: number,
  viewEnd: number,
  playhead: number | undefined,
  options: WaveformDrawOptions = {},
) {
  const frame = beginFrame(canvas, options.background);
  if (!frame) return;
  const { ctx, width, height, dpr } = frame;

  if (!peaks) return;

  const start = clamp01(Math.min(viewStart, viewEnd));
  const end = clamp01(Math.max(viewStart, viewEnd));
  const span = Math.max(1e-6, end - start);
  const midY = height / 2;
  const columns = peaks.lows.length;

  // low (blue) first as the widest base layer, high (orange) next, mid (white)
  // last as the thin line riding on top — mid's curve/heightFraction keep it
  // the thinnest band by construction, so lows and highs read through it.
  drawBandLayer(ctx, peaks.lows, LOW_LAYER, start, span, columns, width, height, midY);
  drawBandLayer(ctx, peaks.highs, HIGH_LAYER, start, span, columns, width, height, midY);
  drawBandLayer(ctx, peaks.mids, MID_LAYER, start, span, columns, width, height, midY);

  drawOverlays(ctx, width, height, dpr, start, span, playhead, options);
}

// Cheap single-band draw for the overview strip and per-row mini waveforms:
// one fill color, one amplitude curve, one fillRect per column instead of
// three — this is the version that matters when many of these are on screen
// at once (every row in the track table). Reuses the same stored ThreeBandPeaks
// data (no extra analysis pass); the three bands are just collapsed into one
// envelope value at draw time via a per-column max.
export function drawMonoWaveform(
  canvas: HTMLCanvasElement,
  peaks: ThreeBandPeaks | null,
  viewStart: number,
  viewEnd: number,
  playhead: number | undefined,
  options: WaveformDrawOptions = {},
) {
  const frame = beginFrame(canvas, options.background);
  if (!frame) return;
  const { ctx, width, height, dpr } = frame;

  if (!peaks) return;

  const start = clamp01(Math.min(viewStart, viewEnd));
  const end = clamp01(Math.max(viewStart, viewEnd));
  const span = Math.max(1e-6, end - start);
  const midY = height / 2;
  const columns = peaks.lows.length;

  ctx.fillStyle = MONO_COLOR;
  const step = Math.max(1, Math.floor(options.resolution ?? 1));
  for (let x = 0; x < width; x += step) {
    const t = start + (x / width) * span;
    const index = Math.min(columns - 1, Math.max(0, t * columns));
    const left = Math.floor(index);
    const right = Math.min(columns - 1, left + 1);
    const frac = index - left;
    const v = Math.max(
      lerp(peaks.lows[left], peaks.lows[right], frac),
      lerp(peaks.mids[left], peaks.mids[right], frac),
      lerp(peaks.highs[left], peaks.highs[right], frac),
    );
    const amplitude = Math.min(1, Math.pow(v, MONO_CURVE));
    const half = amplitude * (height * MONO_HEIGHT_FRACTION);
    // one fillRect covers the whole `step`-wide block, so cutting fidelity
    // directly cuts both the per-column math and the number of draw calls
    ctx.fillRect(x, midY - half, step, Math.max(1, half * 2));
  }

  drawOverlays(ctx, width, height, dpr, start, span, playhead, options);
}

function drawBandLayer(
  ctx: CanvasRenderingContext2D,
  band: Float32Array,
  layer: BandLayer,
  start: number,
  span: number,
  columns: number,
  width: number,
  height: number,
  midY: number,
) {
  ctx.fillStyle = `rgba(${layer.r},${layer.g},${layer.b},${layer.alpha})`;
  for (let x = 0; x < width; x += 1) {
    const t = start + (x / width) * span;
    const index = Math.min(columns - 1, Math.max(0, t * columns));
    const left = Math.floor(index);
    const right = Math.min(columns - 1, left + 1);
    const frac = index - left;
    const v = lerp(band[left], band[right], frac);
    const amplitude = Math.min(1, Math.pow(v, layer.curve));
    const half = amplitude * (height * layer.heightFraction);
    ctx.fillRect(x, midY - half, 1, Math.max(1, half * 2));
  }
}

type BiquadCoeffs = { b0: number; b1: number; b2: number; a1: number; a2: number };

function lowpassCoeffs(freq: number, sampleRate: number): BiquadCoeffs {
  return biquadCoeffs(freq, sampleRate, 'lowpass');
}

function highpassCoeffs(freq: number, sampleRate: number): BiquadCoeffs {
  return biquadCoeffs(freq, sampleRate, 'highpass');
}

function biquadCoeffs(freq: number, sampleRate: number, type: 'lowpass' | 'highpass'): BiquadCoeffs {
  const f0 = Math.min(freq, sampleRate * 0.45);
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Math.SQRT1_2);
  let b0: number;
  let b1: number;
  let b2: number;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;
  if (type === 'lowpass') {
    b0 = (1 - cosw0) / 2;
    b1 = 1 - cosw0;
    b2 = (1 - cosw0) / 2;
  } else {
    b0 = (1 + cosw0) / 2;
    b1 = -(1 + cosw0);
    b2 = (1 + cosw0) / 2;
  }
  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

function applyBiquad(input: Float32Array, coeffs: BiquadCoeffs): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i += 1) {
    const x0 = input[i];
    const y0 = coeffs.b0 * x0 + coeffs.b1 * x1 + coeffs.b2 * x2 - coeffs.a1 * y1 - coeffs.a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

function columnEnergy(samples: Float32Array, start: number, end: number) {
  let peak = 0;
  let sumSq = 0;
  const n = Math.max(1, end - start);
  for (let i = start; i < end; i += 1) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / n);
  return peak * 0.62 + rms * 0.38;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}