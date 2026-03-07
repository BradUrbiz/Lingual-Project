import { clamp01 } from './rms';
import type {
  AvatarAffect,
  AvatarDirective,
  AvatarDirectiveSource,
  AvatarDialogueState,
  AvatarEmotionKey,
  AvatarPerformanceFrame,
  AvatarPerformanceSource,
  AvatarReactionIntent,
} from './types';

type DialogueStateContext = {
  lastUserSpeechStoppedAt: number | null;
};

type BuildFrameArgs = {
  source: AvatarPerformanceSource;
  dialogueState: AvatarDialogueState;
  affect: AvatarAffect;
  audioLevel: number;
};

export const PRE_SPEAKING_WINDOW_MS = 180;
export const POST_SPEAKING_WINDOW_MS = 220;
const THINKING_WINDOW_MS = 2400;

const ENCOURAGING_PATTERNS = [
  /\b(good job|great job|well done|nice work|you're doing well|you're doing great)\b/i,
  /\b(it's okay|no worries|take your time|thank you|thanks|great effort|that works)\b/i,
  /(잘했어요|좋아요|괜찮아요|천천히|감사|잘 하고 있어요|좋은 질문)/,
];

const CORRECTIVE_PATTERNS = [
  /\b(try|let's|instead|better to|you can say|a more natural|correct way)\b/i,
  /\b(rephrase|repeat after me|for example|would be|should be)\b/i,
  /(다시|이렇게 말|이 표현|자연스러운 표현|고쳐|수정|연습해 봐요|해보세요|해 볼까요)/,
];

const AFFIRMING_PATTERNS = [
  /\b(yes|exactly|that's right|correct|i see|right|sure|absolutely)\b/i,
  /(네|맞아요|그래요|그렇죠|알겠어요|이해했어요|좋아요)/,
];

const APOLOGETIC_PATTERNS = [
  /\b(sorry|i'm sorry|apologize|perhaps|maybe|might be)\b/i,
  /(미안|죄송|아마|어쩌면|혹시)/,
];

const CURIOUS_PATTERNS = [
  /\?$/,
  /\b(what|how|why|could you|can you|would you|do you)\b/i,
  /(인가요|할까요|있나요|어요\?|나요\?|까요\?)/,
];

function getActiveTranscript(source: AvatarPerformanceSource): string {
  return (
    source.avatarDirective?.subtitleText?.trim()
    || source.assistantTranscriptDelta.trim()
    || source.assistantTranscriptFinal.trim()
  );
}

function resolveDirectiveAffectFromEmotion(emotionKey: AvatarEmotionKey | null | undefined): AvatarAffect | null {
  switch (emotionKey) {
    case 'joy':
    case 'smirk':
      return 'encouraging';
    case 'surprise':
      return 'curious';
    case 'anger':
    case 'disgust':
      return 'corrective';
    case 'sadness':
    case 'fear':
      return 'apologetic';
    case 'neutral':
      return 'neutral';
    default:
      return null;
  }
}

function resolveDirectiveAffectFromReaction(reactionIntent: AvatarReactionIntent | null | undefined): AvatarAffect | null {
  switch (reactionIntent) {
    case 'tap_head_notice':
    case 'tap_face_focus':
      return 'curious';
    case 'tap_body_affirm':
    case 'tap_chest_reassure':
      return 'affirming';
    case 'tap_hand_wave':
      return 'encouraging';
    default:
      return null;
  }
}

function resolveDirectiveAffect(directive: AvatarDirective | null): AvatarAffect | null {
  if (!directive) return null;
  return (
    resolveDirectiveAffectFromEmotion(directive.emotionKey)
    ?? resolveDirectiveAffectFromReaction(directive.reactionIntent)
  );
}

function getAffectBase(affect: AvatarAffect) {
  switch (affect) {
    case 'encouraging':
      return { smile: 0.32, browInnerUp: 0.12, browOuterUp: 0.08, browDown: 0 };
    case 'curious':
      return { smile: 0.08, browInnerUp: 0.16, browOuterUp: 0.34, browDown: 0 };
    case 'corrective':
      return { smile: 0.04, browInnerUp: 0.05, browOuterUp: 0.04, browDown: 0.2 };
    case 'affirming':
      return { smile: 0.2, browInnerUp: 0.06, browOuterUp: 0.04, browDown: 0 };
    case 'apologetic':
      return { smile: 0.05, browInnerUp: 0.24, browOuterUp: 0.1, browDown: 0.08 };
    default:
      return { smile: 0.04, browInnerUp: 0.03, browOuterUp: 0.02, browDown: 0.02 };
  }
}

function getDialogueIntensity(dialogueState: AvatarDialogueState, audioLevel: number): number {
  switch (dialogueState) {
    case 'speaking':
      return clamp01(0.42 + audioLevel * 1.2);
    case 'pre_speaking':
      return 0.32;
    case 'listening':
      return 0.22;
    case 'thinking':
      return 0.16;
    case 'post_speaking':
      return 0.18;
    default:
      return 0.1;
  }
}

function computeBlink(now: number, dialogueState: AvatarDialogueState): number {
  const cycleMs = dialogueState === 'speaking' ? 4400 : 3900;
  const phase = (now + 680) % cycleMs;
  const blinkStart = cycleMs - 140;
  if (phase < blinkStart) return 0;

  const t = (phase - blinkStart) / 140;
  if (t >= 1) return 0;
  const normalized = t < 0.5 ? t * 2 : (1 - t) * 2;
  return clamp01(normalized * normalized);
}

function getQuestionBias(transcript: string): number {
  if (!transcript) return 0;
  return /[?？]/.test(transcript) ? 0.1 : 0;
}

function getClauseEmphasis(transcript: string): number {
  if (!transcript) return 0;
  const breaks = transcript.split(/[,.!?;:]/).filter(Boolean).length;
  return clamp01(Math.max(0, breaks - 1) * 0.08 + getQuestionBias(transcript));
}

export function inferAvatarAffect(transcript: string): AvatarAffect {
  const text = transcript.trim();
  if (!text) return 'neutral';

  if (CURIOUS_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'curious';
  }
  if (ENCOURAGING_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'encouraging';
  }
  if (CORRECTIVE_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'corrective';
  }
  if (AFFIRMING_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'affirming';
  }
  if (APOLOGETIC_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'apologetic';
  }

  return 'neutral';
}

export function resolveDialogueState(
  source: AvatarPerformanceSource,
  context: DialogueStateContext
): AvatarDialogueState {
  if (source.isListening) {
    return 'listening';
  }

  if (source.isSpeaking) {
    return 'speaking';
  }

  if (source.assistantSpeechEndedAt !== null) {
    const elapsedSinceEnd = source.now - source.assistantSpeechEndedAt;
    if (elapsedSinceEnd >= 0 && elapsedSinceEnd <= POST_SPEAKING_WINDOW_MS) {
      return 'post_speaking';
    }
  }

  const transcript = getActiveTranscript(source);
  if (source.mode === 'text' && transcript === '…') {
    return 'thinking';
  }

  if (source.mode === 'realtime' && transcript && source.assistantSpeechStartedAt === null) {
    return 'pre_speaking';
  }

  if (source.mode === 'realtime' && source.isConnected && context.lastUserSpeechStoppedAt !== null) {
    const elapsedSinceUserStop = source.now - context.lastUserSpeechStoppedAt;
    if (
      elapsedSinceUserStop >= 0 &&
      elapsedSinceUserStop <= THINKING_WINDOW_MS &&
      source.assistantSpeechStartedAt === null
    ) {
      return 'thinking';
    }
  }

  if (source.assistantSpeechStartedAt !== null && source.assistantSpeechEndedAt === null) {
    const elapsedSinceStart = source.now - source.assistantSpeechStartedAt;
    if (elapsedSinceStart >= 0 && elapsedSinceStart <= PRE_SPEAKING_WINDOW_MS) {
      return 'pre_speaking';
    }
  }

  return 'idle';
}

export function buildAvatarPerformanceFrame({
  source,
  dialogueState,
  affect,
  audioLevel,
}: BuildFrameArgs): AvatarPerformanceFrame {
  const t = source.now / 1000;
  const transcript = getActiveTranscript(source);
  const affectBase = getAffectBase(affect);
  const questionBias = getQuestionBias(transcript);
  const clauseEmphasis = getClauseEmphasis(transcript);
  const intensity = getDialogueIntensity(dialogueState, audioLevel);
  const blink = computeBlink(source.now, dialogueState);
  const breathLift = Math.sin(t * 1.55) * 0.006 + Math.sin(t * 0.63 + 0.4) * 0.003;
  const eyeDriftYaw = Math.sin(t * 0.72 + 0.6) * 0.05;
  const eyeDriftPitch = Math.sin(t * 0.48 + 1.2) * 0.03;
  const headDriftYaw = Math.sin(t * 0.9) * 0.02;
  const headDriftPitch = Math.sin(t * 1.35 + 0.5) * 0.012;
  const cadence =
    0.35 +
    Math.abs(Math.sin(t * 10.2 + 0.4)) * 0.28 +
    Math.abs(Math.sin(t * 6.8 + 1.1)) * 0.18;
  const speakingEnvelope =
    source.assistantSpeechStartedAt === null
      ? 0
      : clamp01((source.now - source.assistantSpeechStartedAt) / 150);
  const nodPulse = Math.max(0, Math.sin(t * 2.2 + 0.3)) ** 3;
  const beatPulse = Math.max(0, Math.sin(t * 7.1 + clauseEmphasis)) ** 2;

  let jawOpen = 0.01;
  let mouthRound = 0.02;
  let mouthSpread = 0.02;
  let smile = affectBase.smile;
  let browInnerUp = affectBase.browInnerUp;
  let browOuterUp = affectBase.browOuterUp;
  const browDown = affectBase.browDown;
  let gazeYaw = eyeDriftYaw * 0.5;
  let gazePitch = eyeDriftPitch * 0.6;
  let headPitch = headDriftPitch;
  let headYaw = headDriftYaw;
  let headRoll = Math.sin(t * 0.65) * 0.008;
  let neckPitch = breathLift * 0.8;
  let chestPitch = breathLift * 1.1;
  const explicitIntensity = clamp01(source.avatarDirective?.intensity ?? intensity);
  const directiveSource: AvatarDirectiveSource = source.avatarDirective ? 'directive' : 'fallback';

  switch (dialogueState) {
    case 'listening':
      jawOpen = 0.02;
      mouthRound = 0.02;
      mouthSpread = 0.04 + smile * 0.12;
      smile *= affect === 'encouraging' ? 0.8 : 0.25;
      browInnerUp += 0.04;
      gazeYaw *= 0.55;
      gazePitch = -0.02 + gazePitch * 0.25;
      headPitch = -0.03 + nodPulse * 0.03 + headPitch * 0.5;
      headYaw *= 0.45;
      headRoll = Math.sin(t * 1.15) * 0.01;
      neckPitch = -0.01 + nodPulse * 0.015;
      chestPitch = 0.01 + breathLift;
      break;
    case 'thinking':
      jawOpen = 0.015;
      mouthRound = 0.015;
      mouthSpread = 0.025;
      smile *= 0.35;
      browInnerUp += 0.03;
      gazeYaw = Math.sin(t * 0.35 + 1.4) * 0.09;
      gazePitch = Math.sin(t * 0.4 + 0.8) * 0.035;
      headPitch = -0.015 + headPitch * 0.4;
      headYaw = headDriftYaw * 0.7;
      headRoll = 0;
      neckPitch = -0.006;
      chestPitch = -0.006 + breathLift * 1.2;
      break;
    case 'pre_speaking':
      jawOpen = 0.05 + speakingEnvelope * 0.08;
      mouthRound = 0.04 + questionBias * 0.2;
      mouthSpread = 0.05 + smile * 0.1;
      smile *= 0.65;
      browInnerUp += 0.05;
      browOuterUp += questionBias * 1.8;
      gazeYaw *= 0.3;
      gazePitch = -0.01 + gazePitch * 0.2;
      headPitch = 0.018 + headPitch * 0.5;
      headYaw *= 0.35;
      headRoll = 0;
      neckPitch = 0.008;
      chestPitch = 0.016 + breathLift;
      break;
    case 'speaking':
      jawOpen = clamp01(0.12 * speakingEnvelope + audioLevel * 1.05 + cadence * 0.16);
      mouthRound = clamp01(0.05 + audioLevel * 0.42 + questionBias * 0.18);
      mouthSpread = clamp01(0.06 + audioLevel * 0.35 + smile * 0.24 + cadence * 0.06);
      smile = clamp01(smile * 0.8 + (affect === 'encouraging' || affect === 'affirming' ? 0.08 : 0));
      browInnerUp = clamp01(browInnerUp + (affect === 'apologetic' ? 0.06 : 0));
      browOuterUp = clamp01(browOuterUp + questionBias * 0.3);
      gazeYaw *= 0.2;
      gazePitch = -0.01 + gazePitch * 0.2;
      headPitch = 0.012 + jawOpen * 0.04 + beatPulse * 0.018;
      headYaw = headYaw * 0.35 + Math.sin(t * 2.4) * 0.018;
      headRoll = Math.sin(t * 1.8) * 0.008;
      neckPitch = 0.004 + jawOpen * 0.02;
      chestPitch = 0.012 + beatPulse * 0.01 + breathLift;
      break;
    case 'post_speaking':
      jawOpen = 0.03;
      mouthRound = 0.025;
      mouthSpread = 0.04 + smile * 0.12;
      smile *= 0.7;
      gazeYaw *= 0.35;
      gazePitch *= 0.3;
      headPitch = -0.008 + headPitch * 0.4;
      headYaw *= 0.35;
      headRoll = 0;
      neckPitch = -0.003;
      chestPitch = 0.004 + breathLift;
      break;
    default:
      jawOpen = 0.015;
      mouthRound = 0.02;
      mouthSpread = 0.025 + smile * 0.08;
      smile *= 0.4;
      gazeYaw *= 0.45;
      gazePitch *= 0.4;
      headPitch *= 0.45;
      headYaw *= 0.5;
      headRoll *= 0.5;
      neckPitch = breathLift * 0.55;
      chestPitch = breathLift * 0.85;
      break;
  }

  return {
    dialogueState,
    affect,
    intensity: explicitIntensity,
    jawOpen: clamp01(jawOpen),
    mouthRound: clamp01(mouthRound),
    mouthSpread: clamp01(mouthSpread),
    smile: clamp01(smile),
    browInnerUp: clamp01(browInnerUp),
    browOuterUp: clamp01(browOuterUp),
    browDown: clamp01(browDown),
    blink,
    gazeYaw,
    gazePitch,
    headPitch,
    headYaw,
    headRoll,
    neckPitch,
    chestPitch,
    directive: source.avatarDirective,
    directiveSource,
    debug: {
      audioLevel: clamp01(audioLevel),
      rmsLevel: clamp01(audioLevel),
      transcript,
      hasRemoteAudio: Boolean(source.remoteAudioStream),
      speakingEventState: source.isSpeaking
        ? 'speaking'
        : source.isListening
          ? 'listening'
          : dialogueState === 'thinking' || dialogueState === 'pre_speaking'
            ? 'thinking'
            : 'idle',
      mouthTarget: clamp01(jawOpen),
      detectedExpressionKeys: [
        source.avatarDirective?.expressionId ?? '',
        source.avatarDirective?.emotionKey ?? '',
        source.avatarDirective?.motionRef ?? '',
      ].filter(Boolean),
      directiveSource,
      lastExplicitDirective: source.avatarDirective,
    },
  };
}

export function resolveAvatarAffect(source: AvatarPerformanceSource): AvatarAffect {
  return resolveDirectiveAffect(source.avatarDirective) ?? inferAvatarAffect(getActiveTranscript(source));
}
