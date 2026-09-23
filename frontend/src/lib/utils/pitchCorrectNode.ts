/**
 * pitchCorrectNode.ts
 * --------------------
 * Thin wrapper around @soundtouchjs/audio-worklet, used ONLY for pitch
 * correction (see MixerAudioEngine's docblock for the full signal path).
 *
 * Deliberately does NOT drive the worklet's `tempo`/`rate` params — those
 * are for time-stretching a fully-buffered source, and are not safe to
 * apply to a live streaming MediaElementAudioSourceNode (it would need to
 * consume input faster/slower than it's delivered in real time). Speed is
 * handled entirely by HTMLMediaElement.playbackRate upstream; this node's
 * `pitch` param exists purely to cancel the pitch shift that causes.
 */

const WORKLET_URL = '/audio-worklet/soundtouch-processor.js';
const PROCESSOR_NAME = 'soundtouch-processor';

// addModule() may only be called once per (module url, AudioContext) pair;
// a second call is a harmless no-op in spec but there's no reason to repeat
// the network fetch. Cache the in-flight/resolved promise per context so
// every deck's load races against the same one and resolves together.
const moduleLoads = new WeakMap<AudioContext, Promise<void>>();

function ensureWorkletLoaded(context: AudioContext): Promise<void> {
  let load = moduleLoads.get(context);
  if (!load) {
    load = context.audioWorklet.addModule(WORKLET_URL);
    moduleLoads.set(context, load);
  }
  return load;
}

/**
 * Resolves once the worklet module is registered and a fresh node is
 * created. Each deck needs its own node instance (independent pitch
 * ratios), but they all share the one addModule() load.
 */
export async function createPitchCorrectNode(context: AudioContext): Promise<AudioWorkletNode> {
  await ensureWorkletLoaded(context);
  const node = new AudioWorkletNode(context, PROCESSOR_NAME);
  console.log('SoundTouch params:', Array.from(node.parameters.keys()));

  // Lock tempo/rate at unity — see file docblock. `pitch` is a ratio
  // multiplier (1 = unshifted), not semitones.
  node.parameters.get('playbackRate')!.value = 1;
  node.parameters.get('pitch')!.value = 1;

  return node;
}

/** ratio: 1 = unshifted, >1 = higher, <1 = lower (matches the `pitch` param directly). */
export function setPitchRatio(node: AudioWorkletNode, ratio: number): void {
  node.parameters.get('pitch')!.value = ratio;
}