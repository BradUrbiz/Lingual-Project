import type {
  AvatarDiagnostics,
  AvatarDirective,
  AvatarEmotionKey,
  AvatarExpressionId,
  AvatarMotionRef,
  AvatarReactionIntent,
} from '@/components/avatar/types';

const AVATAR_EMOTION_KEYS: AvatarEmotionKey[] = [
  'neutral',
  'anger',
  'disgust',
  'fear',
  'joy',
  'smirk',
  'sadness',
  'surprise',
];

const AVATAR_EXPRESSION_IDS: AvatarExpressionId[] = [
  'neutral_primary',
  'neutral_soft',
  'warm_smile',
  'warm_bright',
  'curious_lift',
  'curious_smile',
  'corrective_focus',
  'corrective_soft',
  'apology_soft',
  'surprised_open',
  'playful_smirk',
  'affirm_soft',
];

const AVATAR_MOTION_REFS: AvatarMotionRef[] = [
  'idle_base',
  'listening_attentive',
  'thinking_soft',
  'speaking_base',
  'speaking_question',
  'speaking_affirm',
  'speaking_corrective',
  'speaking_apology',
  'react_head_curious',
  'react_face_curious',
  'react_body_affirm',
  'post_speaking_soft',
];

const AVATAR_REACTION_INTENTS: AvatarReactionIntent[] = [
  'none',
  'tap_head_notice',
  'tap_face_focus',
  'tap_body_affirm',
  'tap_hand_wave',
  'tap_chest_reassure',
];

function isStringEnumValue<T extends string>(value: unknown, candidates: T[]): value is T {
  return typeof value === 'string' && candidates.includes(value as T);
}

function clampDirectiveNumber(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.max(minimum, Math.min(maximum, value));
}

export function sanitizeAvatarDirective(input: unknown): AvatarDirective | null {
  if (!input || typeof input !== 'object') return null;

  const record = input as Record<string, unknown>;
  const directive: AvatarDirective = {
    emotionKey: isStringEnumValue(record.emotionKey, AVATAR_EMOTION_KEYS) ? record.emotionKey : null,
    expressionId: isStringEnumValue(record.expressionId, AVATAR_EXPRESSION_IDS) ? record.expressionId : null,
    motionRef: isStringEnumValue(record.motionRef, AVATAR_MOTION_REFS) ? record.motionRef : null,
    reactionIntent: isStringEnumValue(record.reactionIntent, AVATAR_REACTION_INTENTS) ? record.reactionIntent : null,
    intensity: clampDirectiveNumber(record.intensity, 0, 1),
    holdMs: clampDirectiveNumber(record.holdMs, 120, 4000),
    subtitleText: typeof record.subtitleText === 'string' && record.subtitleText.trim()
      ? record.subtitleText.trim()
      : null,
  };

  if (
    !directive.emotionKey &&
    !directive.expressionId &&
    !directive.motionRef &&
    !directive.reactionIntent
  ) {
    return null;
  }

  return directive;
}

export function parseAvatarDirectiveArguments(serialized: string): AvatarDirective | null {
  try {
    const parsed = JSON.parse(serialized) as unknown;
    return sanitizeAvatarDirective(parsed);
  } catch {
    return null;
  }
}

export function shouldTriggerAvatarContextResponse(args: {
  isConnected: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  currentResponseId: string | null;
}) {
  return (
    args.isConnected &&
    !args.isListening &&
    !args.isSpeaking &&
    !args.currentResponseId
  );
}

export function buildBaseAvatarDiagnostics(args: {
  hasRemoteAudio: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  hasPendingAssistantTranscript: boolean;
  lastExplicitDirective: AvatarDirective | null;
}): AvatarDiagnostics {
  return {
    audioLevel: 0,
    rmsLevel: 0,
    hasRemoteAudio: args.hasRemoteAudio,
    speakingEventState: args.isSpeaking
      ? 'speaking'
      : args.isListening
        ? 'listening'
        : args.hasPendingAssistantTranscript
          ? 'thinking'
          : 'idle',
    mouthTarget: 0,
    paramA: null,
    paramI: null,
    paramU: null,
    paramE: null,
    paramO: null,
    lastExplicitDirective: args.lastExplicitDirective,
    source: args.lastExplicitDirective ? 'directive' : 'fallback',
  };
}
