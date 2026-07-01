import { describe, expect, it } from 'vitest';
import {
  assistantPromptLikelyExpectsReply,
  createEmptyRealtimeInputTurnMetrics,
  shouldRespondToRealtimeTurn,
  shouldSpeculativelyRespond,
  SPECULATIVE_MIN_DURATION_MS,
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

describe('shouldSpeculativelyRespond', () => {
  const near = (over: Partial<import('./realtimeSpeechGate').RealtimeInputTurnMetrics> = {}) => ({
    ...createEmptyRealtimeInputTurnMetrics(),
    hadMicSignal: true,
    peakRms: 0.03,
    durationMs: 800,
    ...over,
  });

  it('accepts directed near-field speech of sufficient duration', () => {
    expect(shouldSpeculativelyRespond(near())).toBe(true);
  });

  it('rejects far-field / quiet audio (peakRms below threshold)', () => {
    expect(shouldSpeculativelyRespond(near({ peakRms: 0.005 }))).toBe(false);
  });

  it('rejects audio shorter than the duration floor', () => {
    expect(shouldSpeculativelyRespond(near({ durationMs: SPECULATIVE_MIN_DURATION_MS - 1 }))).toBe(false);
  });

  it('rejects when there was no mic signal (cannot assess near-field)', () => {
    expect(shouldSpeculativelyRespond(near({ hadMicSignal: false }))).toBe(false);
  });

  it('accepts exactly at the duration floor', () => {
    expect(shouldSpeculativelyRespond(near({ durationMs: SPECULATIVE_MIN_DURATION_MS }))).toBe(true);
  });

  it('accepts exactly at the RMS threshold', () => {
    expect(shouldSpeculativelyRespond(near({ peakRms: 0.012 }))).toBe(true);
  });
});
