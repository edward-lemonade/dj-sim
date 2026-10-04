import { useCallback, useEffect, useRef, useState } from 'react';
import { EXTRAPOLATION_CONFIG } from '@/lib/types/Control';

type RemoteControlSample = {
  value: number;
  timestamp: number;
  velocity: number;
};

type ExtrapolatedState = {
  value: number;
  targetValue: number;
  blendStart: number;
  blendStartTimestamp: number;
  isExtrapolating: boolean;
};

export function useRemoteControlExtrapolation(initialValue: number) {
  const samplesRef = useRef<RemoteControlSample[]>([]);
  const frameRef = useRef<number | null>(null);
  const stateRef = useRef<ExtrapolatedState>({
    value: initialValue,
    targetValue: initialValue,
    blendStart: initialValue,
    blendStartTimestamp: 0,
    isExtrapolating: false,
  });
  const [currentValue, setCurrentValue] = useState(initialValue);

  const getPredictedValue = useCallback((now: number = performance.now()) => {
    const state = stateRef.current;
    const samples = samplesRef.current;
    if (samples.length === 0) return state.value;

    const lastSample = samples[samples.length - 1];
    const elapsed = Math.max(0, now - lastSample.timestamp);
    if (elapsed >= EXTRAPOLATION_CONFIG.horizonMs) return lastSample.value;
    return lastSample.value + lastSample.velocity * elapsed;
  }, []);

  const animate = useCallback(() => {
    const step = () => {
      const now = performance.now();
      const state = stateRef.current;
      const blendElapsed = now - state.blendStartTimestamp;
      let nextValue: number;

      if (state.isExtrapolating && blendElapsed < EXTRAPOLATION_CONFIG.blendMs) {
        const progress = Math.max(0, blendElapsed / EXTRAPOLATION_CONFIG.blendMs);
        nextValue = state.blendStart + (state.targetValue - state.blendStart) * progress;
      } else {
        state.isExtrapolating = false;
        nextValue = getPredictedValue(now);
      }

      state.value = nextValue;
      setCurrentValue(nextValue);

      const latestSample = samplesRef.current[samplesRef.current.length - 1];
      if (latestSample && now - latestSample.timestamp < EXTRAPOLATION_CONFIG.horizonMs) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        frameRef.current = null;
      }
    }
    step();
  }, [getPredictedValue]);

  const addSample = useCallback((value: number, timestamp: number) => {
    const samples = samplesRef.current;
    const previous = samples[samples.length - 1];
    let velocity = 0;
    if (previous) {
      const timeDelta = timestamp - previous.timestamp;
      if (timeDelta > 0) velocity = (value - previous.value) / timeDelta;
    }

    samples.push({ value, timestamp, velocity });
    if (samples.length > EXTRAPOLATION_CONFIG.maxSamples) {
      samples.shift();
    }
  }, []);

  const onAuthoritativeUpdate = useCallback((value: number, timestamp: number) => {
    const now = performance.now();
    if (samplesRef.current.length === 0) {
      stateRef.current.value = value;
      stateRef.current.targetValue = value;
      stateRef.current.blendStart = value;
      setCurrentValue(value);
    }
    const predicted = getPredictedValue(now);
    addSample(value, timestamp);
    stateRef.current = {
      value: predicted,
      targetValue: value,
      blendStart: predicted,
      blendStartTimestamp: now,
      isExtrapolating: true,
    };
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(animate);
  }, [addSample, animate, getPredictedValue]);

  const reset = useCallback((value: number) => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    samplesRef.current = [];
    stateRef.current = {
      value,
      targetValue: value,
      blendStart: value,
      blendStartTimestamp: 0,
      isExtrapolating: false,
    };
  }, []);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  return {
    currentValue,
    addSample,
    onAuthoritativeUpdate,
    getPredictedValue,
    reset,
  };
}
