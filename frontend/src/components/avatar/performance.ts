import { clamp01 } from './rms';
import { inferMouthVisemeProfile } from './speechMouth';
import type {
  AvatarAffect,
  AvatarDirective,
  AvatarDirectiveSource,
  AvatarDialogueState,
  AvatarEmotionKey,
  AvatarExpressionId,
  AvatarMotionRef,
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
  feedAudioLevel?: number;
  rawRmsLevel?: number;
};

type DirectivePerformanceBias = {
  jawOpen: number;
  mouthRound: number;
  mouthSpread: number;
  smile: number;
  browInnerUp: number;
  browOuterUp: number;
  browDown: number;
  gazeYaw: number;
  gazePitch: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  neckPitch: number;
  chestPitch: number;
  questionBias: number;
  clauseEmphasis: number;
  cadenceBoost: number;
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

function resolveDirectiveAffectFromExpression(expressionId: AvatarExpressionId | null | undefined): AvatarAffect | null {
  switch (expressionId) {
    case 'warm_smile':
    case 'warm_bright':
    case 'playful_smirk':
      return 'encouraging';
    case 'affirm_soft':
      return 'affirming';
    case 'curious_lift':
    case 'curious_smile':
    case 'surprised_open':
      return 'curious';
    case 'corrective_focus':
    case 'corrective_soft':
      return 'corrective';
    case 'apology_soft':
      return 'apologetic';
    case 'neutral_primary':
    case 'neutral_soft':
      return 'neutral';
    default:
      return null;
  }
}

function resolveDirectiveAffectFromMotion(motionRef: AvatarMotionRef | null | undefined): AvatarAffect | null {
  switch (motionRef) {
    case 'speaking_question':
    case 'react_head_curious':
    case 'react_face_curious':
      return 'curious';
    case 'speaking_affirm':
    case 'react_body_affirm':
      return 'affirming';
    case 'speaking_corrective':
      return 'corrective';
    case 'speaking_apology':
      return 'apologetic';
    case 'speaking_base':
    case 'idle_base':
    case 'listening_attentive':
    case 'thinking_soft':
    case 'post_speaking_soft':
      return 'neutral';
    default:
      return null;
  }
}

function resolveDirectiveAffect(directive: AvatarDirective | null): AvatarAffect | null {
  if (!directive) return null;
  return (
    resolveDirectiveAffectFromEmotion(directive.emotionKey)
    ?? resolveDirectiveAffectFromExpression(directive.expressionId)
    ?? resolveDirectiveAffectFromMotion(directive.motionRef)
    ?? resolveDirectiveAffectFromReaction(directive.reactionIntent)
  );
}

function createEmptyDirectiveBias(): DirectivePerformanceBias {
  return {
    jawOpen: 0,
    mouthRound: 0,
    mouthSpread: 0,
    smile: 0,
    browInnerUp: 0,
    browOuterUp: 0,
    browDown: 0,
    gazeYaw: 0,
    gazePitch: 0,
    headPitch: 0,
    headYaw: 0,
    headRoll: 0,
    neckPitch: 0,
    chestPitch: 0,
    questionBias: 0,
    clauseEmphasis: 0,
    cadenceBoost: 0,
  };
}

function scaleDirectiveBias(
  bias: Partial<DirectivePerformanceBias>,
  weight: number
): DirectivePerformanceBias {
  return {
    ...createEmptyDirectiveBias(),
    jawOpen: (bias.jawOpen ?? 0) * weight,
    mouthRound: (bias.mouthRound ?? 0) * weight,
    mouthSpread: (bias.mouthSpread ?? 0) * weight,
    smile: (bias.smile ?? 0) * weight,
    browInnerUp: (bias.browInnerUp ?? 0) * weight,
    browOuterUp: (bias.browOuterUp ?? 0) * weight,
    browDown: (bias.browDown ?? 0) * weight,
    gazeYaw: (bias.gazeYaw ?? 0) * weight,
    gazePitch: (bias.gazePitch ?? 0) * weight,
    headPitch: (bias.headPitch ?? 0) * weight,
    headYaw: (bias.headYaw ?? 0) * weight,
    headRoll: (bias.headRoll ?? 0) * weight,
    neckPitch: (bias.neckPitch ?? 0) * weight,
    chestPitch: (bias.chestPitch ?? 0) * weight,
    questionBias: (bias.questionBias ?? 0) * weight,
    clauseEmphasis: (bias.clauseEmphasis ?? 0) * weight,
    cadenceBoost: (bias.cadenceBoost ?? 0) * weight,
  };
}

function mergeDirectiveBias(...biases: DirectivePerformanceBias[]): DirectivePerformanceBias {
  return biases.reduce((accumulator, bias) => ({
    jawOpen: accumulator.jawOpen + bias.jawOpen,
    mouthRound: accumulator.mouthRound + bias.mouthRound,
    mouthSpread: accumulator.mouthSpread + bias.mouthSpread,
    smile: accumulator.smile + bias.smile,
    browInnerUp: accumulator.browInnerUp + bias.browInnerUp,
    browOuterUp: accumulator.browOuterUp + bias.browOuterUp,
    browDown: accumulator.browDown + bias.browDown,
    gazeYaw: accumulator.gazeYaw + bias.gazeYaw,
    gazePitch: accumulator.gazePitch + bias.gazePitch,
    headPitch: accumulator.headPitch + bias.headPitch,
    headYaw: accumulator.headYaw + bias.headYaw,
    headRoll: accumulator.headRoll + bias.headRoll,
    neckPitch: accumulator.neckPitch + bias.neckPitch,
    chestPitch: accumulator.chestPitch + bias.chestPitch,
    questionBias: accumulator.questionBias + bias.questionBias,
    clauseEmphasis: accumulator.clauseEmphasis + bias.clauseEmphasis,
    cadenceBoost: accumulator.cadenceBoost + bias.cadenceBoost,
  }), createEmptyDirectiveBias());
}

function getDirectiveExpressionBias(expressionId: AvatarExpressionId | null | undefined, weight: number) {
  switch (expressionId) {
    case 'warm_smile':
      return scaleDirectiveBias({ smile: 0.18, mouthSpread: 0.1, browInnerUp: 0.04 }, weight);
    case 'warm_bright':
      return scaleDirectiveBias({ smile: 0.22, mouthSpread: 0.12, browOuterUp: 0.08, gazePitch: -0.02 }, weight);
    case 'curious_lift':
      return scaleDirectiveBias({ browOuterUp: 0.18, browInnerUp: 0.05, gazePitch: -0.04, headPitch: -0.015, questionBias: 0.18 }, weight);
    case 'curious_smile':
      return scaleDirectiveBias({ smile: 0.08, browOuterUp: 0.14, gazePitch: -0.03, questionBias: 0.14 }, weight);
    case 'corrective_focus':
      return scaleDirectiveBias({ browDown: 0.18, mouthSpread: 0.08, headPitch: 0.012, gazePitch: 0.015 }, weight);
    case 'corrective_soft':
      return scaleDirectiveBias({ browDown: 0.12, browInnerUp: 0.03, mouthSpread: 0.05, headPitch: 0.006 }, weight);
    case 'apology_soft':
      return scaleDirectiveBias({ browInnerUp: 0.12, mouthRound: 0.1, headPitch: 0.02, chestPitch: -0.01 }, weight);
    case 'surprised_open':
      return scaleDirectiveBias({ jawOpen: 0.08, mouthRound: 0.08, browOuterUp: 0.2, gazePitch: -0.06, questionBias: 0.2 }, weight);
    case 'playful_smirk':
      return scaleDirectiveBias({ smile: 0.14, mouthSpread: 0.08, headRoll: 0.018, headYaw: 0.02 }, weight);
    case 'affirm_soft':
      return scaleDirectiveBias({ smile: 0.12, mouthSpread: 0.08, headPitch: 0.018, clauseEmphasis: 0.06 }, weight);
    case 'neutral_soft':
      return scaleDirectiveBias({ smile: 0.03, browInnerUp: 0.02 }, weight);
    case 'neutral_primary':
    default:
      return createEmptyDirectiveBias();
  }
}

function getDirectiveMotionBias(motionRef: AvatarMotionRef | null | undefined, weight: number) {
  switch (motionRef) {
    case 'speaking_question':
      return scaleDirectiveBias({ questionBias: 0.22, browOuterUp: 0.1, headPitch: -0.018, clauseEmphasis: 0.08, cadenceBoost: 0.08 }, weight);
    case 'speaking_affirm':
      return scaleDirectiveBias({ smile: 0.1, headPitch: 0.022, chestPitch: 0.012, clauseEmphasis: 0.08 }, weight);
    case 'speaking_corrective':
      return scaleDirectiveBias({ browDown: 0.14, mouthSpread: 0.07, headPitch: 0.018, gazePitch: 0.018, cadenceBoost: 0.05 }, weight);
    case 'speaking_apology':
      return scaleDirectiveBias({ browInnerUp: 0.08, mouthRound: 0.07, headPitch: 0.018, neckPitch: 0.01, chestPitch: -0.012 }, weight);
    case 'react_head_curious':
      return scaleDirectiveBias({ browOuterUp: 0.12, headPitch: -0.03, headYaw: 0.028, headRoll: 0.01, questionBias: 0.14 }, weight);
    case 'react_face_curious':
      return scaleDirectiveBias({ browOuterUp: 0.1, gazePitch: -0.04, headYaw: 0.02, questionBias: 0.1 }, weight);
    case 'react_body_affirm':
      return scaleDirectiveBias({ smile: 0.1, chestPitch: 0.02, headPitch: 0.02 }, weight);
    case 'post_speaking_soft':
      return scaleDirectiveBias({ smile: 0.04, neckPitch: -0.006, chestPitch: -0.008 }, weight);
    case 'speaking_base':
      return scaleDirectiveBias({ clauseEmphasis: 0.04, cadenceBoost: 0.03 }, weight);
    default:
      return createEmptyDirectiveBias();
  }
}

function getDirectiveReactionBias(reactionIntent: AvatarReactionIntent | null | undefined, weight: number) {
  switch (reactionIntent) {
    case 'tap_head_notice':
      return scaleDirectiveBias({ browOuterUp: 0.16, headPitch: -0.028, headYaw: 0.02, questionBias: 0.12 }, weight);
    case 'tap_face_focus':
      return scaleDirectiveBias({ gazePitch: -0.03, browInnerUp: 0.06, headYaw: 0.012 }, weight);
    case 'tap_body_affirm':
      return scaleDirectiveBias({ smile: 0.1, headPitch: 0.02, chestPitch: 0.018 }, weight);
    case 'tap_hand_wave':
      return scaleDirectiveBias({ smile: 0.14, headRoll: 0.012, headYaw: 0.018 }, weight);
    case 'tap_chest_reassure':
      return scaleDirectiveBias({ smile: 0.08, browInnerUp: 0.08, mouthRound: 0.05, chestPitch: -0.01 }, weight);
    default:
      return createEmptyDirectiveBias();
  }
}

function getDirectiveEmotionBias(emotionKey: AvatarEmotionKey | null | undefined, weight: number) {
  switch (emotionKey) {
    case 'joy':
      return scaleDirectiveBias({ smile: 0.14, mouthSpread: 0.07, browInnerUp: 0.04 }, weight);
    case 'smirk':
      return scaleDirectiveBias({ smile: 0.1, mouthSpread: 0.05, headRoll: 0.01 }, weight);
    case 'surprise':
      return scaleDirectiveBias({ jawOpen: 0.05, mouthRound: 0.08, browOuterUp: 0.16, questionBias: 0.14 }, weight);
    case 'anger':
    case 'disgust':
      return scaleDirectiveBias({ browDown: 0.14, mouthSpread: 0.06, headPitch: 0.012 }, weight);
    case 'sadness':
    case 'fear':
      return scaleDirectiveBias({ browInnerUp: 0.09, mouthRound: 0.06, headPitch: 0.014 }, weight);
    default:
      return createEmptyDirectiveBias();
  }
}

function getDirectivePerformanceBias(directive: AvatarDirective | null, weight: number): DirectivePerformanceBias {
  if (!directive || weight <= 0) {
    return createEmptyDirectiveBias();
  }

  return mergeDirectiveBias(
    getDirectiveEmotionBias(directive.emotionKey, weight * 0.7),
    getDirectiveExpressionBias(directive.expressionId, weight),
    getDirectiveMotionBias(directive.motionRef, weight * 0.9),
    getDirectiveReactionBias(directive.reactionIntent, weight * 0.8),
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
  feedAudioLevel,
  rawRmsLevel,
}: BuildFrameArgs): AvatarPerformanceFrame {
  const t = source.now / 1000;
  const transcript = getActiveTranscript(source);
  const mouthVisemes = inferMouthVisemeProfile(transcript, affect, dialogueState);
  const affectBase = getAffectBase(affect);
  const intensity = getDialogueIntensity(dialogueState, audioLevel);
  const blink = computeBlink(source.now, dialogueState);
  const breathLift = Math.sin(t * 1.55) * 0.006 + Math.sin(t * 0.63 + 0.4) * 0.003;
  const eyeDriftYaw = Math.sin(t * 0.72 + 0.6) * 0.05;
  const eyeDriftPitch = Math.sin(t * 0.48 + 1.2) * 0.03;
  const headDriftYaw = Math.sin(t * 0.9) * 0.02;
  const headDriftPitch = Math.sin(t * 1.35 + 0.5) * 0.012;
  const explicitIntensity = clamp01(source.avatarDirective?.intensity ?? intensity);
  const directiveBias = getDirectivePerformanceBias(source.avatarDirective, explicitIntensity);
  const questionBias = clamp01(getQuestionBias(transcript) + directiveBias.questionBias);
  const clauseEmphasis = clamp01(getClauseEmphasis(transcript) + directiveBias.clauseEmphasis);
  const cadence =
    0.35 +
    Math.abs(Math.sin(t * 10.2 + 0.4)) * 0.28 +
    Math.abs(Math.sin(t * 6.8 + 1.1)) * 0.18 +
    directiveBias.cadenceBoost;
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

  jawOpen = clamp01(jawOpen + directiveBias.jawOpen);
  mouthRound = clamp01(mouthRound + directiveBias.mouthRound);
  mouthSpread = clamp01(mouthSpread + directiveBias.mouthSpread);
  smile = clamp01(smile + directiveBias.smile);
  browInnerUp = clamp01(browInnerUp + directiveBias.browInnerUp);
  browOuterUp = clamp01(browOuterUp + directiveBias.browOuterUp);
  const directedGazeBlend = source.avatarDirective ? clamp01(0.28 + explicitIntensity * 0.36) : 0;
  gazeYaw = gazeYaw * (1 - directedGazeBlend) + directiveBias.gazeYaw;
  gazePitch = gazePitch * (1 - directedGazeBlend) + directiveBias.gazePitch;
  headPitch += directiveBias.headPitch;
  headYaw += directiveBias.headYaw;
  headRoll += directiveBias.headRoll;
  neckPitch += directiveBias.neckPitch;
  chestPitch += directiveBias.chestPitch;

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
    browDown: clamp01(browDown + directiveBias.browDown),
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
      audioLevel: clamp01(feedAudioLevel ?? audioLevel),
      rmsLevel: clamp01(rawRmsLevel ?? feedAudioLevel ?? audioLevel),
      mouthDrive: clamp01(audioLevel),
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
      mouthVisemes,
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
