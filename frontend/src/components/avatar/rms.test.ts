import { describe, expect, it } from 'vitest';
import { computeRmsFromByteTimeDomain, rmsToLevel } from './rms';

describe('computeRmsFromByteTimeDomain', () => {
  it('returns ~0 for silence', () => {
    const data = new Uint8Array(2048).fill(128);
    const rms = computeRmsFromByteTimeDomain(data);
    expect(rms).toBeLessThan(0.001);
    expect(rmsToLevel(rms)).toBe(0);
  });

  it('returns a high RMS for a loud sine wave', () => {
    const size = 2048;
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) {
      const sine = Math.sin((2 * Math.PI * i) / size);
      data[i] = Math.round(128 + sine * 127);
    }

    const rms = computeRmsFromByteTimeDomain(data);
    expect(rms).toBeGreaterThan(0.6);
    expect(rms).toBeLessThan(0.8);
    expect(rmsToLevel(rms)).toBe(1);
  });

  it('applies a noise gate via rmsToLevel', () => {
    const size = 2048;
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) {
      const sine = Math.sin((2 * Math.PI * i) / size);
      data[i] = Math.round(128 + sine * 1);
    }

    const rms = computeRmsFromByteTimeDomain(data);
    expect(rms).toBeGreaterThan(0);
    expect(rmsToLevel(rms)).toBe(0);
  });
});

