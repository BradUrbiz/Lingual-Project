import { describe, it, expect } from 'vitest';
import { detectLocale, buildLocalePath } from './localeRouting';

describe('detectLocale', () => {
  it('detects ko from a /ko path', () => {
    expect(detectLocale('/ko/app/teacher', '')).toEqual({ localePrefix: '/ko', lang: 'ko' });
  });
  it('detects ko from the bare /ko path', () => {
    expect(detectLocale('/ko', '')).toEqual({ localePrefix: '/ko', lang: 'ko' });
  });
  it('defaults to en with no prefix', () => {
    expect(detectLocale('/app/teacher', '')).toEqual({ localePrefix: '', lang: 'en' });
  });
  it('does not treat /korean as a ko prefix', () => {
    expect(detectLocale('/korean-class', '')).toEqual({ localePrefix: '', lang: 'en' });
  });
  it('honors an existing Vite base', () => {
    expect(detectLocale('/app-base/ko/login', '/app-base')).toEqual({ localePrefix: '/ko', lang: 'ko' });
  });
});

describe('buildLocalePath', () => {
  it('adds /ko when switching to ko', () => {
    expect(buildLocalePath('/app/teacher', 'ko', '')).toBe('/ko/app/teacher');
  });
  it('removes /ko when switching to en', () => {
    expect(buildLocalePath('/ko/app/teacher', 'en', '')).toBe('/app/teacher');
  });
  it('is idempotent switching ko→ko', () => {
    expect(buildLocalePath('/ko/login', 'ko', '')).toBe('/ko/login');
  });
  it('maps bare /ko → / when switching to en', () => {
    expect(buildLocalePath('/ko', 'en', '')).toBe('/');
  });
  it('preserves an existing base', () => {
    expect(buildLocalePath('/app-base/login', 'ko', '/app-base')).toBe('/app-base/ko/login');
  });
});
