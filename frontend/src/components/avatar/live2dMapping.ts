import type { AvatarReaction, AvatarState } from '@/types/avatarChat';
import type {
  AvatarDirectiveSource,
  AvatarExpressionId,
  AvatarMotionRef,
  AvatarPerformanceFrame,
} from './types';
import type {
  Live2DEmotionKey,
  Live2DManifest,
} from './live2dManifest';

export type Live2DFocusPoint = {
  x: number;
  y: number;
};

export type Live2DParameterTargets = {
  values: Record<string, number>;
  motionRefs: AvatarMotionRef[];
  expressionIds: AvatarExpressionId[];
  emotionKey: Live2DEmotionKey;
  debug: {
    mouthOpen: number;
    motionKey: string;
    reactionKey: string | null;
    emotionKey: Live2DEmotionKey;
    directiveSource: AvatarDirectiveSource;
  };
};

type BuildLive2DTargetsInput = {
  manifest: Live2DManifest;
  avatarState: AvatarState;
  avatarReaction: AvatarReaction | null;
  audioLevel: number;
  pointerFocus: Live2DFocusPoint;
  now: number;
  performance?: AvatarPerformanceFrame | null;
};

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function setAliases(
  target: Record<string, number>,
  aliases: string[],
  value: number
) {
  for (const alias of aliases) {
    target[alias] = value;
  }
}

function amplifyAudioLevel(audioLevel: number, speaking: boolean) {
  if (!speaking) {
    return clamp(audioLevel * 0.35, 0, 1);
  }
  return clamp(audioLevel * 1.85 + 0.15, 0, 1);
}

export function resolveMotionRefs(
  manifest: Live2DManifest,
  avatarState: AvatarState,
  avatarReaction: AvatarReaction | null,
  performance?: AvatarPerformanceFrame | null
): AvatarMotionRef[] {
  const directiveMotion = performance?.directive?.motionRef ? [performance.directive.motionRef] : [];
  const reactionCandidates = avatarReaction
    ? [
      ...(manifest.tapMotions[avatarReaction.area as keyof typeof manifest.tapMotions] ?? []),
      ...(manifest.defaultMotionGroups[avatarReaction.motionGroup] ?? []),
    ]
    : [];
  const stateCandidates = manifest.defaultMotionGroups[avatarState.motionGroup]
    ?? manifest.defaultMotionGroups[avatarState.dialogueState]
    ?? [];

  return [...directiveMotion, ...reactionCandidates, ...stateCandidates];
}

function inferEmotionKey(
  avatarState: AvatarState,
  avatarReaction: AvatarReaction | null,
  performance?: AvatarPerformanceFrame | null
): Live2DEmotionKey {
  if (performance?.directive?.emotionKey) {
    return performance.directive.emotionKey;
  }

  if (avatarReaction) {
    if (avatarReaction.motionGroup === 'react_head' || avatarReaction.affect === 'curious') {
      return 'surprise';
    }
    if (avatarReaction.affect === 'affirming') {
      return 'joy';
    }
  }

  const transcript = performance?.debug.transcript ?? avatarState.subtitleText ?? '';
  const lowered = transcript.toLowerCase();
  const smile = performance?.smile ?? 0;
  const browDown = performance?.browDown ?? 0;
  const browOuterUp = performance?.browOuterUp ?? 0;
  const mouthRound = performance?.mouthRound ?? 0;

  if (/[!?？]/.test(transcript) || avatarState.affect === 'curious' || browOuterUp > 0.26) {
    return 'surprise';
  }

  if (avatarState.affect === 'apologetic' || /\b(sorry|perhaps|maybe)\b/.test(lowered) || /(미안|죄송|혹시|아마)/.test(transcript)) {
    return 'sadness';
  }

  if (avatarState.affect === 'corrective') {
    if (browDown > 0.18 || /\b(no|not|wrong|instead|should)\b/.test(lowered) || /(아니|다시|고쳐|수정)/.test(transcript)) {
      return 'anger';
    }
    return 'disgust';
  }

  if (avatarState.affect === 'encouraging') {
    return smile > 0.2 ? 'joy' : 'smirk';
  }

  if (avatarState.affect === 'affirming') {
    return smile > 0.16 ? 'joy' : 'smirk';
  }

  if (avatarState.dialogueState === 'thinking' && mouthRound > 0.08) {
    return 'fear';
  }

  return 'neutral';
}

export function resolveExpressionIds(
  manifest: Live2DManifest,
  avatarState: AvatarState,
  avatarReaction: AvatarReaction | null,
  performance?: AvatarPerformanceFrame | null
): { emotionKey: Live2DEmotionKey; expressionIds: AvatarExpressionId[] } {
  const emotionKey = inferEmotionKey(avatarState, avatarReaction, performance);
  const directiveExpressionIds = performance?.directive?.expressionId
    ? [performance.directive.expressionId]
    : [];
  const directiveEmotionIds = performance?.directive?.emotionKey
    ? manifest.expressionMap[performance.directive.emotionKey] ?? []
    : [];
  const emotionCandidates = manifest.expressionMap[emotionKey] ?? [];
  const affectCandidates = avatarReaction
    ? manifest.expressionMap[avatarReaction.affect] ?? []
    : manifest.expressionMap[avatarState.affect] ?? [];

  return {
    emotionKey,
    expressionIds: [
      ...directiveExpressionIds,
      ...directiveEmotionIds,
      ...emotionCandidates,
      ...affectCandidates,
    ],
  };
}

export function buildLive2DParameterTargets({
  manifest,
  avatarState,
  avatarReaction,
  audioLevel,
  pointerFocus,
  now,
  performance,
}: BuildLive2DTargetsInput): Live2DParameterTargets {
  const values: Record<string, number> = {};
  const phase = now / 1000;
  const speaking = avatarState.dialogueState === 'speaking';
  const listening = avatarState.dialogueState === 'listening';
  const thinking = avatarState.dialogueState === 'thinking';
  const reactionKey = avatarReaction?.motionGroup ?? null;
  const boostedAudio = amplifyAudioLevel(audioLevel, speaking);
  const performanceJaw = performance?.jawOpen ?? 0;
  const performanceRound = performance?.mouthRound ?? 0;
  const performanceSpread = performance?.mouthSpread ?? 0;
  const performanceSmile = performance?.smile ?? 0;
  const performanceBrowInner = performance?.browInnerUp ?? 0;
  const performanceBrowOuter = performance?.browOuterUp ?? 0;
  const performanceBrowDown = performance?.browDown ?? 0;
  const performanceHeadPitch = performance?.headPitch ?? 0;
  const performanceHeadYaw = performance?.headYaw ?? 0;
  const performanceHeadRoll = performance?.headRoll ?? 0;
  const performanceChestPitch = performance?.chestPitch ?? 0;
  const performanceNeckPitch = performance?.neckPitch ?? 0;

  const talkPulse = speaking ? 0.18 + ((Math.sin(phase * 14) + 1) / 2) * 0.28 : 0;
  const mouthOpen = speaking
    ? clamp(Math.max(boostedAudio * 0.88, talkPulse, performanceJaw * 1.15), 0, 1)
    : listening
      ? 0.03
      : 0;

  const smile = avatarReaction?.affect === 'affirming' || avatarState.affect === 'encouraging'
    ? Math.max(0.36, performanceSmile * 1.1)
    : avatarState.affect === 'affirming'
      ? Math.max(0.28, performanceSmile)
      : avatarState.affect === 'apologetic'
        ? -0.18
        : performanceSmile * 0.75;

  const curiousLift = avatarReaction?.affect === 'curious' || avatarState.affect === 'curious' ? 0.26 : 0;
  const correctiveTension = avatarState.affect === 'corrective' ? -0.2 - performanceBrowDown * 0.4 : 0;
  const mouthForm = clamp(smile + curiousLift * 0.15 + correctiveTension, -1, 1);
  const mouthSpread = clamp(Math.max(mouthForm, 0) + performanceSpread * 0.9 + mouthOpen * 0.2, 0, 1);
  const mouthRound = clamp(Math.max(-mouthForm, 0) + performanceRound * 0.95 + mouthOpen * 0.15, 0, 1);
  const mouthSmile = clamp((smile > 0 ? smile : 0) + performanceSmile * 0.5, 0, 1);
  const mouthFrown = clamp((mouthForm < 0 ? -mouthForm : 0) + performanceBrowDown * 0.5, 0, 1);
  const angryMouth = clamp(
    (avatarState.affect === 'corrective' ? 0.42 : 0) +
    (avatarReaction?.motionGroup === 'react_face' ? 0.2 : 0) +
    performanceBrowDown * 0.95,
    0,
    1
  );

  const swayWave = Math.sin(phase * 1.8) * avatarState.bodySway * 7;
  const beat = speaking ? Math.sin(phase * 6.5) * 1.6 : 0;
  const reactionPitch = avatarReaction?.motionGroup === 'react_head' ? -8 : 0;
  const reactionYaw = avatarReaction?.motionGroup === 'react_face' ? 7 : 0;
  const angleX = clamp(
    (avatarState.gaze.x + pointerFocus.x * 0.45) * 18 +
    swayWave +
    beat +
    reactionYaw +
    performanceHeadYaw * 180,
    -25,
    25
  );
  const angleY = clamp(
    (avatarState.gaze.y + pointerFocus.y * 0.4) * 14 +
    (thinking ? 4 : 0) +
    reactionPitch +
    performanceHeadPitch * 180 +
    performanceNeckPitch * 80,
    -20,
    18
  );
  const angleZ = clamp(
    Math.sin(phase * 1.6) * avatarState.bodySway * 5 +
    (avatarReaction ? 2.5 : 0) +
    performanceHeadRoll * 160,
    -15,
    15
  );
  const bodyAngleX = clamp((avatarState.gaze.x * 8) + swayWave * 0.5 + performanceHeadYaw * 60, -12, 12);
  const bodyAngleY = clamp(-performanceChestPitch * 120, -10, 10);
  const bodyAngleZ = clamp(performanceHeadRoll * 110 + Math.sin(phase * 0.9) * avatarState.bodySway * 3, -10, 10);
  const eyeBallX = clamp((avatarState.gaze.x * 0.75) + pointerFocus.x * 0.25, -1, 1);
  const eyeBallY = clamp((avatarState.gaze.y * 0.75) + pointerFocus.y * 0.25, -1, 1);
  const eyeBallForm = clamp(
    (avatarState.affect === 'curious' ? -0.4 : 0) +
    (avatarState.affect === 'corrective' ? 0.3 : 0) +
    performanceRound * 0.4 -
    performanceBrowOuter * 0.6,
    -1,
    1
  );
  const eyeEffect = clamp(
    (avatarState.affect === 'curious' ? 0.35 : 0) +
    (avatarState.affect === 'encouraging' ? 0.2 : 0) +
    performanceSmile * 0.35,
    0,
    1
  );

  const blinkBase = avatarState.blinkMode === 'focused' ? 0.97 : avatarState.blinkMode === 'soft' ? 0.9 : 0.94;
  const blinkWave = ((Math.sin(phase * 2.4) + 1) / 2);
  const blinkDip = blinkWave > 0.96 ? (blinkWave - 0.96) * 22 : 0;
  const eyeOpen = clamp(blinkBase - blinkDip, 0, 1);
  const browLift = clamp(curiousLift + (listening ? 0.08 : 0) + (thinking ? 0.04 : 0) + performanceBrowInner * 0.8, -0.5, 0.8);
  const browTension = avatarState.affect === 'corrective'
    ? 0.22 + performanceBrowDown * 0.8
    : avatarState.affect === 'apologetic'
      ? -0.08
      : performanceBrowOuter * 0.55;
  const browShift = clamp(pointerFocus.x * 0.12 + performanceHeadYaw * 0.4, -0.3, 0.3);
  const browAngle = clamp(
    (avatarState.affect === 'corrective' ? -0.55 : 0) +
    (avatarState.affect === 'apologetic' ? -0.35 : 0) +
    performanceBrowDown * -1.4 +
    performanceBrowOuter * 0.6,
    -1,
    1
  );
  const browForm = clamp(
    (avatarState.affect === 'curious' ? 0.8 : 0) +
    (avatarState.affect === 'corrective' ? -0.5 : 0) +
    performanceBrowOuter * 1.1 -
    performanceBrowDown * 0.9,
    -1,
    1
  );
  const cheek = clamp(smile > 0 ? smile * 0.45 : 0, 0, 1);
  const eyeSmile = clamp(mouthSmile * 0.85 + (avatarState.affect === 'encouraging' ? 0.15 : 0), 0, 1);
  const eyeForm = clamp(
    angryMouth * 0.75 + (avatarState.affect === 'curious' ? -0.15 : 0),
    0,
    1
  );
  const breath = clamp(0.25 + avatarState.bodySway * 0.35 + performanceChestPitch * 4 + mouthOpen * 0.15, 0, 1);
  const shoulderLift = clamp((speaking ? 0.06 : 0) + performanceChestPitch * 2.2 + beat * 0.015, -1, 1);

  setAliases(values, manifest.parameterMap.mouthOpen, round(clamp(mouthOpen * 1.3, 0, 1)));
  setAliases(values, manifest.parameterMap.mouthSpread, round(clamp(mouthSpread, 0, 1)));
  setAliases(values, manifest.parameterMap.mouthRound, round(clamp(mouthRound, 0, 1)));
  setAliases(values, manifest.parameterMap.mouthSmile, round(mouthSmile));
  setAliases(values, manifest.parameterMap.mouthFrown, round(clamp(Math.max(mouthFrown, angryMouth), 0, 1)));
  setAliases(values, manifest.parameterMap.angleX, round(angleX));
  setAliases(values, manifest.parameterMap.angleY, round(angleY));
  setAliases(values, manifest.parameterMap.angleZ, round(angleZ));
  setAliases(values, manifest.parameterMap.bodyAngleX, round(bodyAngleX));
  setAliases(values, manifest.parameterMap.bodyAngleY, round(bodyAngleY));
  setAliases(values, manifest.parameterMap.bodyAngleZ, round(bodyAngleZ));
  setAliases(values, manifest.parameterMap.eyeBallX, round(eyeBallX));
  setAliases(values, manifest.parameterMap.eyeBallY, round(eyeBallY));
  setAliases(values, manifest.parameterMap.eyeBallForm, round(eyeBallForm));
  setAliases(values, manifest.parameterMap.eyeEffect, round(eyeEffect));
  setAliases(values, manifest.parameterMap.eyeLOpen, round(eyeOpen));
  setAliases(values, manifest.parameterMap.eyeROpen, round(eyeOpen));
  setAliases(values, manifest.parameterMap.eyeLSmile, round(eyeSmile));
  setAliases(values, manifest.parameterMap.eyeRSmile, round(eyeSmile));
  setAliases(values, manifest.parameterMap.eyeLForm, round(clamp(eyeForm + performanceBrowDown * 0.35, -1, 1)));
  setAliases(values, manifest.parameterMap.eyeRForm, round(clamp(eyeForm + performanceBrowDown * 0.35, -1, 1)));
  setAliases(values, manifest.parameterMap.browLY, round(browLift + browTension));
  setAliases(values, manifest.parameterMap.browRY, round(browLift + browTension));
  setAliases(values, manifest.parameterMap.browLX, round(browShift));
  setAliases(values, manifest.parameterMap.browRX, round(-browShift));
  setAliases(values, manifest.parameterMap.browLAngle, round(browAngle));
  setAliases(values, manifest.parameterMap.browRAngle, round(browAngle));
  setAliases(values, manifest.parameterMap.browLForm, round(browForm));
  setAliases(values, manifest.parameterMap.browRForm, round(browForm));
  setAliases(values, manifest.parameterMap.cheek, round(cheek));
  setAliases(values, manifest.parameterMap.breath, round(breath));
  setAliases(values, manifest.parameterMap.leftShoulderUp, round(shoulderLift));
  setAliases(values, manifest.parameterMap.rightShoulderUp, round(-shoulderLift * 0.7));

  const { emotionKey, expressionIds } = resolveExpressionIds(
    manifest,
    avatarState,
    avatarReaction,
    performance
  );

  return {
    values,
    motionRefs: resolveMotionRefs(manifest, avatarState, avatarReaction, performance),
    expressionIds,
    emotionKey,
    debug: {
      mouthOpen: round(clamp(mouthOpen * 1.3, 0, 1)),
      motionKey: avatarState.motionGroup,
      reactionKey,
      emotionKey,
      directiveSource: performance?.directiveSource ?? 'fallback',
    },
  };
}

export function resolveHitAreaName(
  manifest: Live2DManifest,
  live2dHitAreaName: string
): string {
  for (const [logicalArea, aliases] of Object.entries(manifest.hitAreas)) {
    if (aliases.some((alias) => alias.toLowerCase() === live2dHitAreaName.toLowerCase())) {
      return logicalArea;
    }
  }
  return 'body';
}
