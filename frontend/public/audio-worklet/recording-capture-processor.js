const RECORDING_LIMIT_SECONDS = 60 * 60;
const AUDIO_BLOCK_FRAMES = 16384;

class RecordingCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.totalFrames = 0;
    this.bufferedFrames = 0;
    this.buffer = new Float32Array(AUDIO_BLOCK_FRAMES * 2);
    this.port.onmessage = (event) => {
      if (event.data.type === 'start') {
        this.recording = true;
        this.totalFrames = 0;
        this.bufferedFrames = 0;
      } else if (event.data.type === 'stop') {
        this.recording = false;
        this.flush();
        this.port.postMessage({
          type: 'stopped',
          durationSeconds: this.totalFrames / sampleRate,
        });
      }
    };
  }

  process(inputs, outputs) {
    for (const channel of outputs[0] ?? []) channel.fill(0);
    if (!this.recording) return true;

    const input = inputs[0] ?? [];
    const left = input[0];
    const right = input[1] ?? left;
    if (!left || !right) return true;

    const frames = Math.min(left.length, right.length);
    const maxFrames = sampleRate * RECORDING_LIMIT_SECONDS;
    const framesToRecord = Math.min(frames, maxFrames - this.totalFrames);
    for (let frame = 0; frame < framesToRecord; frame += 1) {
      const offset = this.bufferedFrames * 2;
      this.buffer[offset] = left[frame];
      this.buffer[offset + 1] = right[frame];
      this.bufferedFrames += 1;
      this.totalFrames += 1;

      if (this.bufferedFrames === AUDIO_BLOCK_FRAMES) this.flush();
    }

    if (this.totalFrames >= maxFrames) {
      this.recording = false;
      this.flush();
      this.port.postMessage({
        type: 'limit',
        durationSeconds: this.totalFrames / sampleRate,
      });
    }
    return true;
  }

  flush() {
    if (this.bufferedFrames === 0) return;
    const samples = this.buffer.slice(0, this.bufferedFrames * 2);
    this.port.postMessage({ type: 'samples', samples }, [samples.buffer]);
    this.bufferedFrames = 0;
  }
}

registerProcessor('recording-capture-processor', RecordingCaptureProcessor);
