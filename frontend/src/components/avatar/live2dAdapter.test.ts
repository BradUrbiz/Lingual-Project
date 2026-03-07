import { describe, expect, it } from 'vitest';
import { buildLive2DAvatarStateFromPerformance } from './live2dAdapter';
import type { AvatarPerformanceFrame } from './types';

function createFrame(overrides: Partial<AvatarPerformanceFrame> = {}): AvatarPerformanceFrame {
  return {
    dialogueState: 'idle',
    affect: 'neutral',
    intensity: 0.1,
    jawOpen: 0.01,
    mouthRound: 0.02,
    mouthSpread: 0.02,
    smile: 0.04,
    browInnerUp: 0.03,
    browOuterUp: 0.02,
    browDown: 0.02,
    blink: 0,
    gazeYaw: 0,
    gazePitch: 0,
    headPitch: 0,
    headYaw: 0,
    headRoll: 0,
    neckPitch: 0,
    chestPitch: 0,
    directive: null,
    directiveSource: 'fallback',
    debug: {
      audioLevel: 0,
      rmsLevel: 0,
      transcript: '',
      hasRemoteAudio: false,
      speakingEventState: 'idle',
      mouthTarget: 0.01,
      detectedExpressionKeys: [],
      directiveSource: 'fallback',
      lastExplicitDirective: null,
    },
    ...overrides,
  };
}

describe('live2dAdapter', () => {
  it('maps curious speaking performance into question-driven live2d state', () => {
    const state = buildLive2DAvatarStateFromPerformance(createFrame({
      dialogueState: 'speaking',
      affect: 'curious',
      intensity: 0.44,
      gazeYaw: 0.06,
      headYaw: 0.02,
      debug: {
        audioLevel: 0.5,
        rmsLevel: 0.2,
        transcript: 'Can you try that again?',
        hasRemoteAudio: true,
        speakingEventState: 'speaking',
        mouthTarget: 0.2,
        detectedExpressionKeys: [],
        directiveSource: 'fallback',
        lastExplicitDirective: null,
      },
    }));

    expect(state.dialogueState).toBe('speaking');
    expect(state.motionGroup).toBe('question');
    expect(state.subtitleText).toBe('Can you try that again?');
    expect(state.blinkMode).toBe('auto');
    expect(state.gaze.x).toBeGreaterThan(0);
  });

  it('keeps listening state focused and converts pre-speaking into speaking anticipation', () => {
    const listeningState = buildLive2DAvatarStateFromPerformance(createFrame({
      dialogueState: 'listening',
      affect: 'encouraging',
    }));
    const preSpeakingState = buildLive2DAvatarStateFromPerformance(createFrame({
      dialogueState: 'pre_speaking',
      affect: 'affirming',
      debug: {
        audioLevel: 0,
        rmsLevel: 0,
        transcript: 'Right, let me explain.',
        hasRemoteAudio: false,
        speakingEventState: 'thinking',
        mouthTarget: 0.05,
        detectedExpressionKeys: [],
        directiveSource: 'fallback',
        lastExplicitDirective: null,
      },
    }));

    expect(listeningState.dialogueState).toBe('listening');
    expect(listeningState.motionGroup).toBe('listen');
    expect(listeningState.blinkMode).toBe('focused');
    expect(preSpeakingState.dialogueState).toBe('speaking');
    expect(preSpeakingState.motionGroup).toBe('affirm');
  });
});
