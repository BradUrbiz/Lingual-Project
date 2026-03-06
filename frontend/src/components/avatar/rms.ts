export const AUDIO_RMS_DEFAULTS = {
  fftSize: 2048,
  noiseGate: 0.02,
  scale: 12,
  smoothing: 0.85,
} as const;

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Computes RMS from time-domain bytes returned by `AnalyserNode.getByteTimeDomainData`.
 * Silence is ~128,128,... and yields ~0.
 */
export function computeRmsFromByteTimeDomain(data: Uint8Array): number {
  if (data.length === 0) return 0;

  let sumSquares = 0;
  for (let i = 0; i < data.length; i += 1) {
    const normalized = (data[i] - 128) / 128;
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / data.length);
}

export function rmsToLevel(
  rms: number,
  noiseGate = AUDIO_RMS_DEFAULTS.noiseGate,
  scale = AUDIO_RMS_DEFAULTS.scale
): number {
  return clamp01((rms - noiseGate) * scale);
}

/**
 * `smoothing` is the weight of the previous value.
 */
export function smoothLevel(previous: number, next: number, smoothing = AUDIO_RMS_DEFAULTS.smoothing): number {
  return previous * smoothing + next * (1 - smoothing);
}

