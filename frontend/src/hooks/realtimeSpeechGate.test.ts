import { describe, expect, it } from 'vitest';
import {
  assistantPromptLikelyExpectsReply,
  createEmptyRealtimeInputTurnMetrics,
  shouldRespondToRealtimeTurn,
} from './realtimeSpeechGate';

describe('assistantPromptLikelyExpectsReply', () => {
  it('detects assistant prompts that expect a learner reply', () => {
    expect(assistantPromptLikelyExpectsReply('What would you like to order?')).toBe(true);
    expect(assistantPromptLikelyExpectsReply('Let us continue.')).toBe(false);
  });
});

describe('shouldRespondToRealtimeTurn', () => {
  it('rejects short acknowledgements when the assistant did not just prompt the learner', () => {
    const metrics = {
      ...createEmptyRealtimeInputTurnMetrics(),
      hadMicSignal: true,
      peakRms: 0.03,
    };

    expect(shouldRespondToRealtimeTurn('yeah', metrics)).toBe(false);
    expect(shouldRespondToRealtimeTurn('ok', metrics)).toBe(false);
  });

  it('accepts short acknowledgements when the assistant clearly prompted for a reply', () => {
    const metrics = {
      ...createEmptyRealtimeInputTurnMetrics(),
      hadMicSignal: true,
      peakRms: 0.03,
      assistantPromptedUser: true,
    };

    expect(shouldRespondToRealtimeTurn('yes', metrics)).toBe(true);
  });

  it('rejects low-signal side conversation fragments without direct-address cues', () => {
    const metrics = {
      ...createEmptyRealtimeInputTurnMetrics(),
      hadMicSignal: true,
      peakRms: 0.009,
      durationMs: 440,
    };

    expect(shouldRespondToRealtimeTurn('that is fine', metrics)).toBe(false);
  });

  it('accepts quieter greeting turns with near-field signal', () => {
    const metrics = {
      ...createEmptyRealtimeInputTurnMetrics(),
      hadMicSignal: true,
      peakRms: 0.013,
      durationMs: 520,
    };

    expect(shouldRespondToRealtimeTurn('hello', metrics)).toBe(true);
  });

  it('accepts near-field learner requests', () => {
    const metrics = {
      ...createEmptyRealtimeInputTurnMetrics(),
      hadMicSignal: true,
      peakRms: 0.028,
      durationMs: 1100,
    };

    expect(shouldRespondToRealtimeTurn('Can you help me practice ordering coffee?', metrics)).toBe(true);
  });

  it('accepts learner intent cues even when the audio is slightly quiet', () => {
    const metrics = {
      ...createEmptyRealtimeInputTurnMetrics(),
      hadMicSignal: true,
      peakRms: 0.01,
      durationMs: 980,
    };

    expect(shouldRespondToRealtimeTurn('I want to practice ordering food', metrics)).toBe(true);
  });

  it('accepts explicit direct-address cues even when the mic signal is weak', () => {
    const metrics = {
      ...createEmptyRealtimeInputTurnMetrics(),
      hadMicSignal: true,
      peakRms: 0.01,
      durationMs: 700,
    };

    expect(shouldRespondToRealtimeTurn('Lingu, how do I say this?', metrics)).toBe(true);
  });
});
