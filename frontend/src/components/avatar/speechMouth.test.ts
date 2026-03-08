import { describe, expect, it } from 'vitest';
import {
  buildSpeechMouthTarget,
  inferMouthVisemeProfile,
  smoothSpeechMouthDrive,
} from './speechMouth';

describe('speechMouth', () => {
  it('extracts dominant vowel tendencies from English and Korean transcript tails', () => {
    const englishFront = inferMouthVisemeProfile('see me please', 'neutral', 'speaking');
    const englishRound = inferMouthVisemeProfile('go home soon', 'neutral', 'speaking');
    const koreanA = inferMouthVisemeProfile('아야', 'neutral', 'speaking');
    const koreanU = inferMouthVisemeProfile('우유', 'neutral', 'speaking');

    expect(englishFront.i + englishFront.e).toBeGreaterThan(englishFront.a + englishFront.o);
    expect(englishRound.o + englishRound.u).toBeGreaterThan(englishRound.i + englishRound.e);
    expect(koreanA.a).toBeGreaterThan(koreanA.i);
    expect(koreanU.u).toBeGreaterThan(koreanU.a);
  });

  it('adds question and corrective energy to speaking mouth targets', () => {
    const neutralTarget = buildSpeechMouthTarget({
      audioLevel: 0.1,
      rawRms: 0.025,
      transcript: 'Let us practice together.',
      affect: 'neutral',
      dialogueState: 'speaking',
      now: 1_000,
      assistantSpeechStartedAt: 900,
    });
    const questionTarget = buildSpeechMouthTarget({
      audioLevel: 0.1,
      rawRms: 0.025,
      transcript: 'Could you try that again?',
      affect: 'curious',
      dialogueState: 'speaking',
      now: 1_000,
      assistantSpeechStartedAt: 900,
    });
    const correctiveTarget = buildSpeechMouthTarget({
      audioLevel: 0.1,
      rawRms: 0.025,
      transcript: 'Try saying it this way instead.',
      affect: 'corrective',
      dialogueState: 'speaking',
      now: 1_000,
      assistantSpeechStartedAt: 900,
    });
    const neutralCorrectiveLine = buildSpeechMouthTarget({
      audioLevel: 0.1,
      rawRms: 0.025,
      transcript: 'Try saying it this way instead.',
      affect: 'neutral',
      dialogueState: 'speaking',
      now: 1_000,
      assistantSpeechStartedAt: 900,
    });

    expect(questionTarget).toBeGreaterThan(neutralTarget);
    expect(correctiveTarget).toBeGreaterThan(neutralCorrectiveLine);
  });

  it('uses faster rise and slower fall while speaking', () => {
    const raised = smoothSpeechMouthDrive(0.1, 0.6, 'speaking');
    const released = smoothSpeechMouthDrive(raised, 0.05, 'speaking');

    expect(raised).toBeGreaterThan(0.3);
    expect(released).toBeGreaterThan(0.1);
    expect(released).toBeLessThan(raised);
  });
});
