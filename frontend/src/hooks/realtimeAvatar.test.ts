import { describe, expect, it } from 'vitest';
import {
  buildBaseAvatarDiagnostics,
  parseAvatarDirectiveArguments,
  shouldTriggerAvatarContextResponse,
} from './realtimeAvatar';

describe('realtimeAvatar helpers', () => {
  it('parses a valid avatar directive payload', () => {
    const directive = parseAvatarDirectiveArguments(JSON.stringify({
      emotionKey: 'joy',
      expressionId: 'warm_smile',
      motionRef: 'speaking_affirm',
      reactionIntent: 'tap_body_affirm',
      intensity: 0.72,
      holdMs: 860,
    }));

    expect(directive).toEqual({
      emotionKey: 'joy',
      expressionId: 'warm_smile',
      motionRef: 'speaking_affirm',
      reactionIntent: 'tap_body_affirm',
      intensity: 0.72,
      holdMs: 860,
      subtitleText: null,
    });
  });

  it('requires the assistant to be idle before an avatar hit triggers a response', () => {
    expect(shouldTriggerAvatarContextResponse({
      isConnected: true,
      isListening: false,
      isSpeaking: false,
      currentResponseId: null,
    })).toBe(true);

    expect(shouldTriggerAvatarContextResponse({
      isConnected: true,
      isListening: false,
      isSpeaking: true,
      currentResponseId: 'resp_123',
    })).toBe(false);
  });

  it('builds fallback diagnostics without losing the last directive', () => {
    const diagnostics = buildBaseAvatarDiagnostics({
      hasRemoteAudio: true,
      isListening: false,
      isSpeaking: true,
      hasPendingAssistantTranscript: true,
      lastExplicitDirective: {
        motionRef: 'speaking_base',
      },
    });

    expect(diagnostics.hasRemoteAudio).toBe(true);
    expect(diagnostics.speakingEventState).toBe('speaking');
    expect(diagnostics.lastExplicitDirective?.motionRef).toBe('speaking_base');
    expect(diagnostics.source).toBe('directive');
  });
});
