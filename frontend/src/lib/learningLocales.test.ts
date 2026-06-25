import { describe, it, expect } from 'vitest';
import { LEARNING_LOCALES, defaultLearningLocaleFor } from './learningLocales';

describe('learningLocales', () => {
  it('includes en-US as a selectable target', () => {
    expect(LEARNING_LOCALES.map((l) => l.value)).toContain('en-US');
  });

  it('defaults Korean UI to English target', () => {
    expect(defaultLearningLocaleFor('ko')).toBe('en-US');
  });

  it('defaults English UI to ko-KR (unchanged)', () => {
    expect(defaultLearningLocaleFor('en')).toBe('ko-KR');
  });
});
