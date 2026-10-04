export enum EncoderRequestType {
  Start = 'start',
  Samples = 'samples',
  Finish = 'finish',
}

export enum EncoderResponseType {
  Ready = 'ready',
  Chunk = 'chunk',
  Finalized = 'finalized',
  Error = 'error',
}

export enum RecordingTapMessageType {
  Start = 'start',
  Stop = 'stop',
  Samples = 'samples',
  Stopped = 'stopped',
  Limit = 'limit',
}
