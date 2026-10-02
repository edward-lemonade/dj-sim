/// <reference lib="webworker" />

import { registerMp3Encoder } from '@mediabunny/mp3-encoder';
import { AudioSample, AudioSampleSource, Mp3OutputFormat, Output, StreamTarget } from 'mediabunny';

type WorkerRequest =
  | { type: 'start'; sampleRate: number }
  | { type: 'samples'; samples: Float32Array }
  | { type: 'finish' };

type WorkerResponse =
  | { type: 'ready' }
  | { type: 'chunk'; data: Uint8Array }
  | { type: 'finalized' }
  | { type: 'error'; message: string };

const worker = self as DedicatedWorkerGlobalScope;
let source: AudioSampleSource | null = null;
let output: Output<Mp3OutputFormat, StreamTarget> | null = null;
let sampleRate = 0;
let frameCount = 0;
let pendingSamples = Promise.resolve();
let finishing = false;

worker.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'start') {
    void startEncoder(request.sampleRate);
  } else if (request.type === 'samples') {
    if (!source || finishing) return;
    pendingSamples = pendingSamples.then(async () => {
      const frames = request.samples.length / 2;
      const sample = new AudioSample({
        data: request.samples,
        format: 'f32',
        numberOfChannels: 2,
        sampleRate,
        timestamp: frameCount / sampleRate,
      });
      frameCount += frames;
      try {
        await source?.add(sample);
      } finally {
        sample.close();
      }
    });
    pendingSamples.catch(reportError);
  } else if (request.type === 'finish') {
    void finishEncoder();
  }
};

async function startEncoder(rate: number) {
  try {
    sampleRate = rate;
    registerMp3Encoder();

    const target = new StreamTarget(
      new WritableStream({
        write(chunk) {
          const data = chunk.data;
          worker.postMessage({ type: 'chunk', data } satisfies WorkerResponse, [data.buffer]);
        },
      }),
      { chunked: true, chunkSize: 1024 * 1024 },
    );
    output = new Output({
      format: new Mp3OutputFormat({ xingHeader: false }),
      target,
    });
    source = new AudioSampleSource({ codec: 'mp3', bitrate: 192_000, bitrateMode: 'constant' });
    output.addAudioTrack(source, { bitrate: 192_000, averageBitrate: 192_000 });
    await output.start();
    worker.postMessage({ type: 'ready' } satisfies WorkerResponse);
  } catch (error) {
    reportError(error);
  }
}

async function finishEncoder() {
  if (!source || !output || finishing) return;
  finishing = true;
  try {
    await pendingSamples;
    source.close();
    await output.finalize();
    worker.postMessage({ type: 'finalized' } satisfies WorkerResponse);
  } catch (error) {
    reportError(error);
  }
}

function reportError(error: unknown) {
  worker.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : 'MP3 encoding failed.',
  } satisfies WorkerResponse);
}

export {};
