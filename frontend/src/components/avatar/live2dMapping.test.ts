import { describe, expect, it } from 'vitest';
import { DEFAULT_AVATAR_STATE, type AvatarReaction } from '@/types/avatarChat';
import { LINGUAL_TUTOR_LIVE2D_MANIFEST } from './live2dManifest';
import {
  buildLive2DParameterTargets,
  resolveExpressionIds,
  resolveHitAreaName,
  resolveMotionRefs,
} from './live2dMapping';

describe('live2dMapping', () => {
  it('drives mouth open during speaking even with low audio to avoid a dead face', () => {
    const targets = buildLive2DParameterTargets({
      manifest: LINGUAL_TUTOR_LIVE2D_MANIFEST,
      avatarState: {
        ...DEFAULT_AVATAR_STATE,
        dialogueState: 'speaking',
        motionGroup: 'talk',
      },
      avatarReaction: null,
      audioLevel: 0,
      pointerFocus: { x: 0, y: 0 },
      now: 1_250,
      performance: {
        dialogueState: 'speaking',
        affect: 'neutral',
        intensity: 0.4,
        jawOpen: 0.22,
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
          speakingEventState: 'speaking',
          mouthTarget: 0.22,
          detectedExpressionKeys: [],
          directiveSource: 'fallback',
          lastExplicitDirective: null,
        },
      },
    });

    expect(targets.values.ParamA).toBeGreaterThan(0.15);
    expect(targets.motionRefs[0]).toBe('speaking_base');
    expect(targets.emotionKey).toBe('neutral');
  });

  it('prioritizes explicit directive and reaction motions ahead of dialogue motions', () => {
    const reaction: AvatarReaction = {
      area: 'head',
      affect: 'curious',
      motionGroup: 'react_head',
      subtitleText: 'Oh?',
      durationMs: 700,
    };

    const motionRefs = resolveMotionRefs(
      LINGUAL_TUTOR_LIVE2D_MANIFEST,
      {
        ...DEFAULT_AVATAR_STATE,
        dialogueState: 'speaking',
        motionGroup: 'talk',
      },
      reaction,
      {
        dialogueState: 'speaking',
        affect: 'curious',
        intensity: 0.5,
        jawOpen: 0.2,
        mouthRound: 0.1,
        mouthSpread: 0.2,
        smile: 0.1,
        browInnerUp: 0.2,
        browOuterUp: 0.2,
        browDown: 0.1,
        blink: 0,
        gazeYaw: 0,
        gazePitch: 0,
        headPitch: 0,
        headYaw: 0,
        headRoll: 0,
        neckPitch: 0,
        chestPitch: 0,
        directive: {
          motionRef: 'speaking_question',
        },
        directiveSource: 'directive',
        debug: {
          audioLevel: 0.15,
          rmsLevel: 0.08,
          transcript: 'Could you try that again?',
          hasRemoteAudio: true,
          speakingEventState: 'speaking',
          mouthTarget: 0.2,
          detectedExpressionKeys: ['speaking_question'],
          directiveSource: 'directive',
          lastExplicitDirective: { motionRef: 'speaking_question' },
        },
      }
    );

    expect(motionRefs[0]).toBe('speaking_question');
    expect(motionRefs).toEqual(expect.arrayContaining(['react_head_curious', 'speaking_base']));
  });

  it('maps raw live2d hit area aliases back into logical Lingual hit areas', () => {
    expect(resolveHitAreaName(LINGUAL_TUTOR_LIVE2D_MANIFEST, 'HitAreaHead')).toBe('head');
    expect(resolveHitAreaName(LINGUAL_TUTOR_LIVE2D_MANIFEST, 'Body')).toBe('body');
    expect(resolveHitAreaName(LINGUAL_TUTOR_LIVE2D_MANIFEST, 'unknown')).toBe('body');
  });

  it('resolves symbolic expression banks for corrective speech and explicit directives', () => {
    const resolved = resolveExpressionIds(
      LINGUAL_TUTOR_LIVE2D_MANIFEST,
      {
        ...DEFAULT_AVATAR_STATE,
        dialogueState: 'speaking',
        affect: 'corrective',
        motionGroup: 'corrective',
        subtitleText: 'Try saying it this way.',
      },
      null,
      {
        dialogueState: 'speaking',
        affect: 'corrective',
        intensity: 0.52,
        jawOpen: 0.34,
        mouthRound: 0.12,
        mouthSpread: 0.28,
        smile: 0.06,
        browInnerUp: 0.05,
        browOuterUp: 0.04,
        browDown: 0.31,
        blink: 0,
        gazeYaw: 0.04,
        gazePitch: -0.02,
        headPitch: 0.03,
        headYaw: 0.02,
        headRoll: 0.01,
        neckPitch: 0.01,
        chestPitch: 0.02,
        directive: {
          expressionId: 'corrective_focus',
          emotionKey: 'anger',
        },
        directiveSource: 'directive',
        debug: {
          audioLevel: 0.18,
          rmsLevel: 0.09,
          transcript: 'Try saying it this way.',
          hasRemoteAudio: true,
          speakingEventState: 'speaking',
          mouthTarget: 0.34,
          detectedExpressionKeys: ['corrective_focus', 'anger'],
          directiveSource: 'directive',
          lastExplicitDirective: {
            expressionId: 'corrective_focus',
            emotionKey: 'anger',
          },
        },
      }
    );

    expect(resolved.emotionKey).toBe('anger');
    expect(resolved.expressionIds[0]).toBe('corrective_focus');
    expect(resolved.expressionIds).toContain('corrective_soft');
  });
});
