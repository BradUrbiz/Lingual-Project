import {
  buildAvatarPerformanceFrame,
  inferAvatarAffect,
  POST_SPEAKING_WINDOW_MS,
  resolveAvatarAffect,
  resolveDialogueState,
} from './performance';
import type { AvatarPerformanceSource } from './types';

function createSource(overrides: Partial<AvatarPerformanceSource> = {}): AvatarPerformanceSource {
  return {
    mode: 'realtime',
    isConnected: true,
    isListening: false,
    isSpeaking: false,
    remoteAudioStream: null,
    assistantTranscriptDelta: '',
    assistantTranscriptFinal: '',
    assistantSpeechStartedAt: null,
    assistantSpeechEndedAt: null,
    avatarDirective: null,
    now: 1_000,
    ...overrides,
  };
}

describe('avatar performance planner', () => {
  it('transitions through listening, thinking, pre-speaking, speaking, post-speaking, and idle', () => {
    const listening = resolveDialogueState(createSource({ isListening: true }), {
      lastUserSpeechStoppedAt: null,
    });
    expect(listening).toBe('listening');

    const thinking = resolveDialogueState(createSource({ now: 1_250 }), {
      lastUserSpeechStoppedAt: 1_000,
    });
    expect(thinking).toBe('thinking');

    const preSpeaking = resolveDialogueState(
      createSource({
        now: 1_300,
        assistantTranscriptDelta: 'Let us try that one more time.',
      }),
      {
        lastUserSpeechStoppedAt: 1_000,
      }
    );
    expect(preSpeaking).toBe('pre_speaking');

    const speaking = resolveDialogueState(
      createSource({
        isSpeaking: true,
        assistantSpeechStartedAt: 1_320,
        now: 1_420,
      }),
      {
        lastUserSpeechStoppedAt: 1_000,
      }
    );
    expect(speaking).toBe('speaking');

    const postSpeaking = resolveDialogueState(
      createSource({
        assistantSpeechStartedAt: 1_320,
        assistantSpeechEndedAt: 1_600,
        now: 1_600 + POST_SPEAKING_WINDOW_MS - 10,
      }),
      {
        lastUserSpeechStoppedAt: 1_000,
      }
    );
    expect(postSpeaking).toBe('post_speaking');

    const idle = resolveDialogueState(
      createSource({
        assistantSpeechStartedAt: 1_320,
        assistantSpeechEndedAt: 1_600,
        now: 1_600 + POST_SPEAKING_WINDOW_MS + 30,
      }),
      {
        lastUserSpeechStoppedAt: null,
      }
    );
    expect(idle).toBe('idle');
  });

  it('infers affect for English and Korean assistant phrases', () => {
    expect(inferAvatarAffect('Could you try that again?')).toBe('curious');
    expect(inferAvatarAffect('Great job, you are doing well.')).toBe('encouraging');
    expect(inferAvatarAffect("Let's use a more natural expression here.")).toBe('corrective');
    expect(inferAvatarAffect('Yes, that is exactly right.')).toBe('affirming');
    expect(inferAvatarAffect('죄송해요. 혹시 다시 말씀해 주실 수 있나요?')).toBe('curious');
    expect(inferAvatarAffect('잘했어요. 천천히 해도 괜찮아요.')).toBe('encouraging');
    expect(inferAvatarAffect('이렇게 말하면 더 자연스러워요.')).toBe('corrective');
    expect(inferAvatarAffect('네, 맞아요.')).toBe('affirming');
    expect(inferAvatarAffect('미안해요, 제가 조금 헷갈렸어요.')).toBe('apologetic');
  });

  it('keeps face and head motion visible during speaking even without audio energy', () => {
    const source = createSource({
      isSpeaking: true,
      assistantSpeechStartedAt: 900,
      assistantTranscriptFinal: 'Let us practice with a shorter sentence.',
      now: 1_000,
    });
    const frame = buildAvatarPerformanceFrame({
      source,
      dialogueState: 'speaking',
      affect: 'corrective',
      audioLevel: 0,
    });

    expect(frame.jawOpen).toBeGreaterThan(0.12);
    expect(Math.abs(frame.headPitch)).toBeGreaterThan(0.01);
    expect(frame.mouthSpread).toBeGreaterThan(0.05);
  });

  it('prefers explicit avatar directives over transcript heuristics', () => {
    const frame = buildAvatarPerformanceFrame({
      source: createSource({
        assistantTranscriptFinal: 'Could you try that again?',
        avatarDirective: {
          emotionKey: 'joy',
          expressionId: 'warm_smile',
          motionRef: 'speaking_affirm',
          intensity: 0.74,
          holdMs: 900,
        },
      }),
      dialogueState: 'speaking',
      affect: 'encouraging',
      audioLevel: 0.1,
    });

    expect(frame.directive?.expressionId).toBe('warm_smile');
    expect(frame.directiveSource).toBe('directive');
    expect(frame.intensity).toBe(0.74);
    expect(frame.debug.detectedExpressionKeys).toContain('warm_smile');
  });

  it('derives affect from directive expression, motion, and reaction when emotion is absent', () => {
    expect(resolveAvatarAffect(createSource({
      avatarDirective: {
        expressionId: 'corrective_focus',
      },
    }))).toBe('corrective');

    expect(resolveAvatarAffect(createSource({
      avatarDirective: {
        motionRef: 'speaking_apology',
      },
    }))).toBe('apologetic');

    expect(resolveAvatarAffect(createSource({
      avatarDirective: {
        reactionIntent: 'tap_head_notice',
      },
    }))).toBe('curious');
  });

  it('uses directive semantics to make affirming and corrective turns visibly distinct', () => {
    const affirmSource = createSource({
      isSpeaking: true,
      assistantSpeechStartedAt: 900,
      now: 1_000,
      avatarDirective: {
        expressionId: 'warm_smile',
        motionRef: 'speaking_affirm',
        intensity: 0.82,
      },
    });
    const correctiveSource = createSource({
      isSpeaking: true,
      assistantSpeechStartedAt: 900,
      now: 1_000,
      avatarDirective: {
        expressionId: 'corrective_focus',
        motionRef: 'speaking_corrective',
        intensity: 0.82,
      },
    });

    const affirmFrame = buildAvatarPerformanceFrame({
      source: affirmSource,
      dialogueState: 'speaking',
      affect: resolveAvatarAffect(affirmSource),
      audioLevel: 0.08,
    });
    const correctiveFrame = buildAvatarPerformanceFrame({
      source: correctiveSource,
      dialogueState: 'speaking',
      affect: resolveAvatarAffect(correctiveSource),
      audioLevel: 0.08,
    });

    expect(affirmFrame.smile).toBeGreaterThan(correctiveFrame.smile);
    expect(correctiveFrame.browDown).toBeGreaterThan(affirmFrame.browDown);
    expect(correctiveFrame.headPitch).toBeGreaterThan(affirmFrame.headPitch);
    expect(affirmFrame.chestPitch).toBeGreaterThan(correctiveFrame.chestPitch);
  });
});
