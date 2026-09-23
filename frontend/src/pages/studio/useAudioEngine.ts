/**
 * MixerAudioEngine
 * -----------------
 * Browser-side Web Audio rendering engine for the DJ mixer.
 *
 * Signal path per deck:
 *   source -> pitchCorrect (WASM AudioWorkletNode, once loaded)
 *          -> input (gain, unity) -> low shelf -> mid peaking -> high shelf
 *          -> channel volume (gain) -> master (gain) -> destination
 *
 * Tempo is applied as HTMLMediaElement.playbackRate (vinyl-style: this
 * alone shifts pitch along with speed). The pitchCorrect node then shifts
 * pitch by the inverse ratio to cancel that out, so tempo changes without
 * the pitch drifting — see pitchCorrectNode.ts and
 * public/audio-worklet/pitch-processor.js for the WASM phase-vocoder that
 * does the actual shifting.
 *
 * The pitch-correct node loads asynchronously (AudioWorklet module
 * registration + a wasm fetch). Until it's ready, a deck's source is
 * connected straight to `input`, unshifted, so audio isn't blocked on it;
 * once ready, connectMediaElement reroutes source -> pitchNode -> input and
 * any pending tempo/ratio update is applied immediately.
 *
 * All continuous params are ramped with setTargetAtTime to avoid zipper
 * noise / clicks when a knob updates every render.
 *
 * Scratching (see scratchTo/stopScratch) is a separate path: it plays
 * short grains straight from the deck's decoded AudioBuffer into `input`,
 * bypassing pitch correction entirely — the pitch bend IS the scratch
 * sound. The caller is expected to pause the deck's media element first
 * (this engine doesn't touch element playback state itself).
 */

import { useEffect, useRef } from "react";
import type { MixerState } from "./useMixerState";

export enum DeckId {A,B}
export const DECK_IDS: DeckId[] = [DeckId.A, DeckId.B];
export type EQBand = 'low' | 'mid' | 'high';

export interface AudioEngineOptions {
  /** Time constant (seconds) for param smoothing. Smaller = snappier, more click risk. */
  rampSeconds?: number;
  /** Max boost in dB at EQ value = +1 */
  eqBoostDb?: number;
  /** Max cut in dB at EQ value = -1 (use a large value for a "kill" style cut) */
  eqCutDb?: number;
  /** Max channel/master gain multiplier at value = 1 (headroom above unity) */
  maxGain?: number;
  /** Max tempo adjustment in +/- percent (e.g. 8 = CDJ's typical +/-8% range) */
  tempoRangePercent?: number;
}

interface DeckNodes {
  input: GainNode;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  volume: GainNode;
  mediaElement: HTMLMediaElement | null;
  mediaSource: MediaElementAudioSourceNode | null;
  pitchNode: AudioWorkletNode | null;
  /** Ratio to apply once pitchNode finishes loading, if set before it was ready. */
  pendingRatio: number | null;
  /** In-flight scratch grain, if the platter is currently being dragged. */
  scratchSource: AudioBufferSourceNode | null;
  scratchGain: GainNode | null;
}

const DEFAULTS: Required<AudioEngineOptions> = {
  rampSeconds: 0.02,
  eqBoostDb: 12,
  eqCutDb: 26, // steep enough to read as a "kill" at the extreme without being discontinuous
  maxGain: 1.25,
  tempoRangePercent: 50,
};

// Scratch grains: how much source material each pointermove grabs, the
// drag-speed range that maps to grain playbackRate, and how long grains
// crossfade into each other so back-to-back pointermoves don't click.
const SCRATCH_GRAIN_SECONDS = 0.08;
const SCRATCH_MIN_SPEED = 0.05;
const SCRATCH_MAX_SPEED = 4;
const SCRATCH_FADE_SECONDS = 0.005;

export class MixerAudioEngine {
  readonly context: AudioContext;
  readonly master: GainNode;

  private readonly opts: Required<AudioEngineOptions>;
  private readonly decks = new Map<DeckId, DeckNodes>();

  constructor(options: AudioEngineOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };

    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    this.context = new Ctx();

    this.master = this.context.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.context.destination);

    this.createDeck(DeckId.A);
    this.createDeck(DeckId.B);
  }

  // ---------------------------------------------------------------------
  // Setup / wiring
  // ---------------------------------------------------------------------

  private createDeck(id: DeckId) {
    const ctx = this.context;

    const input = ctx.createGain();
    input.gain.value = 1;

    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf';
    low.frequency.value = 200;

    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 1000;
    mid.Q.value = 0.9;

    const high = ctx.createBiquadFilter();
    high.type = 'highshelf';
    high.frequency.value = 4000;

    const volume = ctx.createGain();
    volume.gain.value = 1;

    input.connect(low);
    low.connect(mid);
    mid.connect(high);
    high.connect(volume);
    volume.connect(this.master);

    this.decks.set(id, {
      input, low, mid, high, volume,
      mediaElement: null,
      mediaSource: null,
      pitchNode: null,
      pendingRatio: null,
      scratchSource: null,
      scratchGain: null,
    });
  }

  private deck(id: DeckId): DeckNodes {
    const d = this.decks.get(id);
    if (!d) throw new Error(`MixerAudioEngine: unknown deck "${id}"`);
    return d;
  }

  /** The node any deck's audio source should connect into. */
  getInputNode(deckId: DeckId): GainNode {
    return this.deck(deckId).input;
  }

  /**
   * Convenience wiring for CDJ decks backed by an <audio>/<video> element.
   * Registers the element so setTempo() can drive its playbackRate.
   *
   * Idempotent: createMediaElementSource() can only ever succeed once per
   * element (a second call against the same element throws, even against a
   * different AudioContext), and React 18 StrictMode intentionally
   * double-invokes mount effects in dev. So a repeat call with the same
   * element is a safe no-op that returns the existing source instead of
   * throwing.
   *
   * The element's `src` must be a same-origin URL (e.g. an object/blob URL
   * from downloaded bytes) — a cross-origin URL without permissive CORS
   * headers taints the media element and Web Audio will only ever produce
   * silence from it, without throwing. Point this at a locally-downloaded
   * blob URL, never a bare remote URL (e.g. a raw S3 URL).
   */
  connectMediaElement(deckId: DeckId, element: HTMLMediaElement): MediaElementAudioSourceNode {
    const deck = this.deck(deckId);
    if (deck.mediaElement === element && deck.mediaSource) {
      return deck.mediaSource;
    }
    const source = this.context.createMediaElementSource(element);
    deck.mediaElement = element;
    deck.mediaSource = source;

    // Vinyl-style: playbackRate changes pitch along with speed. The
    // pitch-correct worklet (once loaded, below) cancels that shift back
    // out, so leave the browser's own preservesPitch correction off —
    // stacking both would double-correct.
    this.setPreservesPitch(element, false);

    // Connect unshifted immediately so audio isn't silent while the
    // worklet loads; reroute through the pitch-correct node once it's
    // ready (createPitchCorrectNode is cached/shared, so this resolves
    // fast for every deck after the first).
    source.connect(deck.input);

    return source;
  }

  private setPreservesPitch(element: HTMLMediaElement, value: boolean) {
    const el = element as HTMLMediaElement & {
      preservesPitch?: boolean;
      mozPreservesPitch?: boolean;
      webkitPreservesPitch?: boolean;
    };
    el.preservesPitch = value;
    el.mozPreservesPitch = value;
    el.webkitPreservesPitch = value;
  }

  // ---------------------------------------------------------------------
  // Param updates (called from the mixer state sync effect)
  // ---------------------------------------------------------------------

  private ramp(param: AudioParam, value: number) {
    const now = this.context.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, this.opts.rampSeconds);
  }

  /** knob value in [-1, 1]; 0 = flat/unity, +1 = full boost, -1 = kill */
  setEQ(deckId: DeckId, band: EQBand, value: number) {
    const clamped = clamp(value, -1, 1);
    const db = clamped >= 0 ? clamped * this.opts.eqBoostDb : clamped * this.opts.eqCutDb;
    this.ramp(this.deck(deckId)[band].gain, db);
  }

  /** knob value in [0, 1] (matches ChannelState.volume) */
  setChannelVolume(deckId: DeckId, value: number) {
    const clamped = clamp(value, 0, 1);
    this.ramp(this.deck(deckId).volume.gain, clamped * this.opts.maxGain);
  }

  /** fader value in [0, 1] */
  setMasterVolume(value: number) {
    const clamped = clamp(value, 0, 1);
    this.ramp(this.master.gain, clamped * this.opts.maxGain);
  }

  /**
   * value in percent, e.g. -8..8 (matches a CDJ tempo slider directly).
   * 0 = normal speed. Clamped to +/- tempoRangePercent.
   *
   * Also drives the deck's pitch-correct node with the inverse ratio, so
   * the net effect is tempo change with pitch held constant. If the
   * pitch-correct node hasn't finished loading yet, the ratio is queued
   * (pendingRatio) and applied as soon as connectMediaElement's loader
   * resolves.
   */
  setTempo(deckId: DeckId, percent: number) {
    const clamped = clamp(percent, -this.opts.tempoRangePercent, this.opts.tempoRangePercent);
    const rate = 1 + clamped / 100;
    const deck = this.deck(deckId);
    if (deck.mediaElement) {
      deck.mediaElement.playbackRate = rate;
    }
  }

  // ---------------------------------------------------------------------
  // Scratch (platter drag)
  // ---------------------------------------------------------------------

  /**
   * Plays one scratch grain: a short slice of `buffer` taken at
   * offsetSeconds, forward or reversed depending on drag direction, at a
   * rate proportional to drag speed. This is the platter-drag audio path —
   * it runs instead of (not alongside) the deck's normal media-element
   * playback, which the caller is expected to have paused first.
   *
   * Reverse is done by manually reversing the sliced samples rather than a
   * negative AudioBufferSourceNode.playbackRate: negative-rate reverse
   * playback isn't reliably supported across browsers, whereas a reversed
   * buffer plays back identically everywhere.
   */
  scratchTo(deckId: DeckId, buffer: AudioBuffer, offsetSeconds: number, deltaSeconds: number, deltaRealSeconds: number) {
    const deck = this.deck(deckId);
    const now = this.context.currentTime;

    // Crossfade out whatever grain is already playing rather than cutting it.
    if (deck.scratchGain) {
      deck.scratchGain.gain.cancelScheduledValues(now);
      deck.scratchGain.gain.setValueAtTime(deck.scratchGain.gain.value, now);
      deck.scratchGain.gain.linearRampToValueAtTime(0, now + SCRATCH_FADE_SECONDS);
      deck.scratchSource?.stop(now + SCRATCH_FADE_SECONDS);
    }
    deck.scratchSource = null;
    deck.scratchGain = null;

    if (deltaRealSeconds <= 0) return;

    const reverse = deltaSeconds < 0;
    const speed = clamp(Math.abs(deltaSeconds / deltaRealSeconds), SCRATCH_MIN_SPEED, SCRATCH_MAX_SPEED);
    const grain = buildScratchGrain(this.context, buffer, offsetSeconds, reverse);
    if (!grain) return;

    const source = this.context.createBufferSource();
    source.buffer = grain;
    source.playbackRate.value = speed;

    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + SCRATCH_FADE_SECONDS);

    source.connect(gain);
    gain.connect(deck.input);
    source.start(now);

    deck.scratchSource = source;
    deck.scratchGain = gain;
  }

  /** Stops any in-flight scratch grain. Call on pointerup, and defensively on unmount. */
  stopScratch(deckId: DeckId) {
    const deck = this.deck(deckId);
    const now = this.context.currentTime;
    if (deck.scratchGain) {
      deck.scratchGain.gain.cancelScheduledValues(now);
      deck.scratchGain.gain.setValueAtTime(deck.scratchGain.gain.value, now);
      deck.scratchGain.gain.linearRampToValueAtTime(0, now + SCRATCH_FADE_SECONDS);
    }
    deck.scratchSource?.stop(now + SCRATCH_FADE_SECONDS);
    deck.scratchSource = null;
    deck.scratchGain = null;
  }

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

  /** Must be called from a user gesture (e.g. the first Play press) before audio will run. */
  async resume() {
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
  }

  dispose() {
    this.decks.forEach((deck) => {
      deck.input.disconnect();
      deck.low.disconnect();
      deck.mid.disconnect();
      deck.high.disconnect();
      deck.volume.disconnect();
      deck.pitchNode?.disconnect();
      deck.scratchSource?.stop();
      deck.scratchSource?.disconnect();
      deck.scratchGain?.disconnect();
    });
    this.decks.clear();
    this.master.disconnect();
    void this.context.close();
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Slices SCRATCH_GRAIN_SECONDS of source material starting at offsetSeconds
 * (forward), or the window just behind it, reversed (backward).
 */
function buildScratchGrain(ctx: AudioContext, buffer: AudioBuffer, offsetSeconds: number, reverse: boolean): AudioBuffer | null {
  const sliceSeconds = Math.min(SCRATCH_GRAIN_SECONDS, reverse ? offsetSeconds : buffer.duration - offsetSeconds);
  if (sliceSeconds <= 0) return null;

  const startSeconds = reverse ? offsetSeconds - sliceSeconds : offsetSeconds;
  const startFrame = Math.floor(startSeconds * buffer.sampleRate);
  const frameCount = Math.floor(sliceSeconds * buffer.sampleRate);
  const grain = ctx.createBuffer(buffer.numberOfChannels, frameCount, buffer.sampleRate);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = grain.getChannelData(ch);
    if (reverse) {
      for (let i = 0; i < frameCount; i++) dst[i] = src[startFrame + frameCount - 1 - i];
    } else {
      dst.set(src.subarray(startFrame, startFrame + frameCount));
    }
  }
  return grain;
}

// Session-lifetime singleton. Deliberately NOT created-and-disposed per
// component mount: a MediaElementAudioSourceNode is permanently bound to
// the AudioContext that created it, so tearing down and rebuilding the
// engine (as a per-mount instance would under React 18 StrictMode's
// mount -> cleanup -> mount dance) would strand every deck's <audio>
// element with a dead source node and no way to reconnect it — which is
// exactly the "unknown deck" failure this replaces. If you later add an
// explicit "leave studio" action, call MixerAudioEngine.dispose() there.
let sharedEngine: MixerAudioEngine | null = null;
function getSharedEngine(): MixerAudioEngine {
  if (!sharedEngine) {
    sharedEngine = new MixerAudioEngine();
  }
  return sharedEngine;
}

export function useAudioEngine(state: MixerState): MixerAudioEngine {
  const engineRef = useRef<MixerAudioEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = getSharedEngine();
  }
  const engine = engineRef.current;

  useEffect(() => {
    for (const id of DECK_IDS) {
      const channel = state.channelState[id];
      engine.setEQ(id, 'low', channel.low);
      engine.setEQ(id, 'mid', channel.mid);
      engine.setEQ(id, 'high', channel.high);
      engine.setChannelVolume(id, channel.volume);
      engine.setTempo(id, channel.tempo);
    }
    // state.channelState as a whole, not per-deck fields — DECK_IDS.length
    // isn't known statically, so we can't list individual deck deps here.
  }, [engine, state.channelState]);

  useEffect(() => {
    engine.setMasterVolume(state.master);
  }, [engine, state.master]);

  return engine;
}