import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REALTIME_SPEAKING_SPEED,
  REALTIME_SPEAKING_SPEED_OPTIONS,
  normalizeRealtimeSpeakingSpeed,
} from './realtimeSpeakingSpeed';

describe('realtime speaking speed presets', () => {
  it('exposes conservative language-learning speed presets', () => {
    expect(REALTIME_SPEAKING_SPEED_OPTIONS.map((option) => option.speed)).toEqual([
      0.85,
      1,
      1.15,
      1.3,
    ]);
  });

  it('only accepts configured speeds from stored or submitted values', () => {
    expect(normalizeRealtimeSpeakingSpeed('1.15')).toBe(1.15);
    expect(normalizeRealtimeSpeakingSpeed(1.3)).toBe(1.3);
    expect(normalizeRealtimeSpeakingSpeed('1.5')).toBe(DEFAULT_REALTIME_SPEAKING_SPEED);
    expect(normalizeRealtimeSpeakingSpeed('fast')).toBe(DEFAULT_REALTIME_SPEAKING_SPEED);
  });
});
