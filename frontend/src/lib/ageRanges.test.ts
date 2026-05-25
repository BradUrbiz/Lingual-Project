import { describe, it, expect } from 'vitest';
import { AGE_RANGES, ageToRangeLabel, ageToRangeI18nKey } from './ageRanges';

describe('ageToRangeLabel', () => {
  it('returns empty string for unset / falsy ages', () => {
    expect(ageToRangeLabel(null)).toBe('');
    expect(ageToRangeLabel(undefined)).toBe('');
    expect(ageToRangeLabel(0)).toBe('');
  });

  it('maps boundary ages to the correct bucket', () => {
    expect(ageToRangeLabel(11)).toBe('Under 12');
    expect(ageToRangeLabel(12)).toBe('12 – 17');
    expect(ageToRangeLabel(17)).toBe('12 – 17');
    expect(ageToRangeLabel(18)).toBe('18 – 24');
    expect(ageToRangeLabel(24)).toBe('18 – 24');
    expect(ageToRangeLabel(25)).toBe('25 – 30');
    expect(ageToRangeLabel(59)).toBe('50 – 59');
    expect(ageToRangeLabel(60)).toBe('60+');
    expect(ageToRangeLabel(150)).toBe('60+');
  });

  it('round-trips: every bucket midpoint resolves back to its own label', () => {
    for (const range of AGE_RANGES) {
      expect(ageToRangeLabel(range.midpoint)).toBe(range.label);
    }
  });
});

describe('age-bucket compliance boundary', () => {
  // Guards backend/services/compliance.py::_derive_is_minor, which treats
  // age < 18 as a minor. The stored value is the bucket MIDPOINT, so every
  // minor-facing bucket must round to < 18 and every adult bucket to >= 18.
  // If a future bucket straddles the 18 line, a minor could be stored as an
  // adult midpoint and silently skip guardian consent.
  it('keeps every minor bucket below 18 and every adult bucket at/above 18', () => {
    for (const range of AGE_RANGES) {
      const labelLooksMinor = range.label === 'Under 12' || range.label === '12 – 17';
      if (labelLooksMinor) {
        expect(range.midpoint).toBeLessThan(18);
      } else {
        expect(range.midpoint).toBeGreaterThanOrEqual(18);
      }
    }
  });

  it('has no bucket whose midpoint lands on the 18 boundary ambiguously', () => {
    // No midpoint should equal 17 or 18 exactly (would be a fragile boundary).
    for (const range of AGE_RANGES) {
      expect(range.midpoint).not.toBe(17);
      expect(range.midpoint).not.toBe(18);
    }
  });
});

describe('ageToRangeI18nKey', () => {
  it('returns the i18n key matching the resolved bucket', () => {
    expect(ageToRangeI18nKey(14)).toBe('profile.ageRange.12to17');
    expect(ageToRangeI18nKey(21)).toBe('profile.ageRange.18to24');
    expect(ageToRangeI18nKey(65)).toBe('profile.ageRange.60plus');
  });

  it('returns empty string for unset age', () => {
    expect(ageToRangeI18nKey(null)).toBe('');
    expect(ageToRangeI18nKey(undefined)).toBe('');
  });

  it('every range has a unique, non-empty i18n key', () => {
    const keys = AGE_RANGES.map((r) => r.i18nKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => k.startsWith('profile.ageRange.'))).toBe(true);
  });
});
