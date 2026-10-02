import type { DeckId } from '../../hooks/useAudioEngine';

export const FX_TYPES = ['echo', 'reverb', 'flanger'] as const;
export type FxType = (typeof FX_TYPES)[number];

// In beats: echo time = this many beats, flanger sweep = 4x this many beats
export type FxDivision = number;

export interface FxState {
  type: FxType;
  division: FxDivision;
  /** Return level in [0, 1]; 0 = effect inaudible */
  wet: number;
  assign: Record<DeckId, boolean>;
}

const RAMP_SECONDS = 0.02;
// Slower so tempo changes glide the echo time instead of zippering
const TIMING_RAMP_SECONDS = 0.05;
const MAX_DELAY_SECONDS = 8;
const ECHO_FEEDBACK = 0.45;
const ECHO_DAMPING_HZ = 3500;
const REVERB_SECONDS = 2.2;
const FLANGER_MAX_DELAY_SECONDS = 0.02;
const FLANGER_BASE_SECONDS = 0.004;
const FLANGER_DEPTH_SECONDS = 0.0025;
const FLANGER_SWEEP_BEATS = 4;

/** Shared wet return for all decks; dry audio remains on each channel path. */
export class FxRack {
  readonly input: GainNode;
  readonly output: GainNode;

  private readonly context: AudioContext;
  private readonly gates: Record<FxType, GainNode>;
  private readonly echoDelay: DelayNode;
  private readonly lfo: OscillatorNode;

  constructor(context: AudioContext) {
    this.context = context;
    this.input = context.createGain();
    this.output = context.createGain();
    this.output.gain.value = 0;

    const makeGate = () => {
      const gate = context.createGain();
      gate.gain.value = 0;
      this.input.connect(gate);
      return gate;
    };
    this.gates = { echo: makeGate(), reverb: makeGate(), flanger: makeGate() };

    this.echoDelay = context.createDelay(MAX_DELAY_SECONDS);
    const damping = context.createBiquadFilter();
    damping.type = 'lowpass';
    damping.frequency.value = ECHO_DAMPING_HZ;
    const feedback = context.createGain();
    feedback.gain.value = ECHO_FEEDBACK;
    this.gates.echo.connect(this.echoDelay);
    this.echoDelay.connect(this.output);
    this.echoDelay.connect(damping);
    damping.connect(feedback);
    feedback.connect(this.echoDelay);

    const convolver = context.createConvolver();
    convolver.buffer = buildImpulse(context);
    this.gates.reverb.connect(convolver);
    convolver.connect(this.output);

    const flangerDelay = context.createDelay(FLANGER_MAX_DELAY_SECONDS);
    flangerDelay.delayTime.value = FLANGER_BASE_SECONDS;
    this.lfo = context.createOscillator();
    this.lfo.frequency.value = 0.25;
    const depth = context.createGain();
    depth.gain.value = FLANGER_DEPTH_SECONDS;
    this.lfo.connect(depth);
    depth.connect(flangerDelay.delayTime);
    this.lfo.start();
    this.gates.flanger.connect(flangerDelay);
    flangerDelay.connect(this.output);
  }

  private ramp(param: AudioParam, value: number, seconds = RAMP_SECONDS) {
    const now = this.context.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, seconds);
  }

  setType(type: FxType) {
    for (const id of FX_TYPES) {
      this.ramp(this.gates[id].gain, id === type ? 1 : 0);
    }
  }

  /** level in [0, 1] */
  setWet(value: number) {
    this.ramp(this.output.gain, Math.min(1, Math.max(0, value)));
  }

  setTiming(bpm: number, beats: number) {
    if (bpm <= 0) return;
    const beatSeconds = 60 / bpm;
    this.ramp(this.echoDelay.delayTime, Math.min(beats * beatSeconds, MAX_DELAY_SECONDS), TIMING_RAMP_SECONDS);
    this.ramp(this.lfo.frequency, 1 / (beats * FLANGER_SWEEP_BEATS * beatSeconds), TIMING_RAMP_SECONDS);
  }

  dispose() {
    this.lfo.stop();
    this.input.disconnect();
    this.output.disconnect();
  }
}

// Decaying noise is a good-enough room for a DJ send reverb
function buildImpulse(context: AudioContext): AudioBuffer {
  const length = Math.floor(context.sampleRate * REVERB_SECONDS);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let ch = 0; ch < impulse.numberOfChannels; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
    }
  }
  return impulse;
}