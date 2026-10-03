import { useRef, useCallback } from 'react';
import type { ControlId } from '@/lib/types/Control';
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

export function useRemoteControlExtrapolation(controlId: ControlId) {
  const samplesRef = useRef<RemoteControlSample[]>([]);
  const stateRef = useRef<ExtrapolatedState>({
    value: 0,
    targetValue: 0,
    blendStart: 0,
    blendStartTimestamp: 0,
    isExtrapolating: false,
  });

  const addSample = useCallback((value: number, timestamp: number) => {
    const samples = samplesRef.current;
    const now = Date.now();
    
    let velocity = 0;
    if (samples.length > 0) {
      const lastSample = samples[samples.length - 1];
      const timeDelta = Math.max(timestamp - lastSample.timestamp, 1);
      velocity = (value - lastSample.value) / timeDelta;
    }
    
    samples.push({ value, timestamp, velocity });
    if (samples.length > EXTRAPOLATION_CONFIG.maxSamples) {
      samples.shift();
    }
    
    stateRef.current = {
      value,
      targetValue: value,
      blendStart: value,
      blendStartTimestamp: now,
      isExtrapolating: false,
    };
  }, [controlId]);

  const getPredictedValue = useCallback((now: number = Date.now()) => {
    const state = stateRef.current;
    const samples = samplesRef.current;
    
    if (samples.length === 0) return state.value;
    
    const timeSinceLastSample = now - samples[samples.length - 1].timestamp;
    
    if (timeSinceLastSample > EXTRAPOLATION_CONFIG.horizonMs) {
      return state.value;
    }
    
    const lastSample = samples[samples.length - 1];
    const predictedValue = lastSample.value + (lastSample.velocity * timeSinceLastSample);
    
    if (state.isExtrapolating) {
      const blendProgress = Math.min(timeSinceLastSample / EXTRAPOLATION_CONFIG.blendMs, 1);
      const blendedValue = state.blendStart + (predictedValue - state.blendStart) * blendProgress;
      return blendedValue;
    }
    
    return predictedValue;
  }, [controlId]);

  const onAuthoritativeUpdate = useCallback((value: number, timestamp: number) => {
    const now = Date.now();
    const predicted = getPredictedValue(now);
    
    addSample(value, timestamp);
    
    stateRef.current = {
      value: predicted,
      targetValue: value,
      blendStart: predicted,
      blendStartTimestamp: now,
      isExtrapolating: true,
    };
  }, [controlId, getPredictedValue, addSample]);

  const updateBlend = useCallback(() => {
    const state = stateRef.current;
    if (!state.isExtrapolating) return;
    
    const now = Date.now();
    const blendElapsed = now - state.blendStartTimestamp;
    
    if (blendElapsed >= EXTRAPOLATION_CONFIG.blendMs) {
      stateRef.current = {
        value: state.targetValue,
        targetValue: state.targetValue,
        blendStart: state.targetValue,
        blendStartTimestamp: now,
        isExtrapolating: false,
      };
    } else {
      const progress = blendElapsed / EXTRAPOLATION_CONFIG.blendMs;
      stateRef.current.value = state.blendStart + (state.targetValue - state.blendStart) * progress;
    }
  }, [controlId]);

  return {
    currentValue: stateRef.current.value,
    addSample,
    onAuthoritativeUpdate,
    updateBlend,
    getPredictedValue,
  };
}
