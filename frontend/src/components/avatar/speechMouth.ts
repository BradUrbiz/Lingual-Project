import { clamp01 } from './rms';
import type {
  AvatarAffect,
  AvatarDialogueState,
  AvatarMouthVisemeProfile,
} from './types';

export const DEFAULT_MOUTH_VISEME_PROFILE: AvatarMouthVisemeProfile = {
  a: 0.26,
  i: 0.18,
  u: 0.17,
  e: 0.2,
  o: 0.19,
};

function createEmptyVisemeProfile(): AvatarMouthVisemeProfile {
  return {
    a: 0,
    i: 0,
    u: 0,
    e: 0,
    o: 0,
  };
}

function addWeightedViseme(
  profile: AvatarMouthVisemeProfile,
  weights: Partial<AvatarMouthVisemeProfile>,
  factor: number
) {
  profile.a += (weights.a ?? 0) * factor;
  profile.i += (weights.i ?? 0) * factor;
  profile.u += (weights.u ?? 0) * factor;
  profile.e += (weights.e ?? 0) * factor;
  profile.o += (weights.o ?? 0) * factor;
}

function normalizeVisemeProfile(profile: AvatarMouthVisemeProfile): AvatarMouthVisemeProfile {
  const total = profile.a + profile.i + profile.u + profile.e + profile.o;
  if (total <= 0.0001) {
    return { ...DEFAULT_MOUTH_VISEME_PROFILE };
  }

  return {
    a: profile.a / total,
    i: profile.i / total,
    u: profile.u / total,
    e: profile.e / total,
    o: profile.o / total,
  };
}

function getLatinVisemeWeights(character: string): Partial<AvatarMouthVisemeProfile> | null {
  switch (character) {
    case 'a':
      return { a: 1 };
    case 'e':
      return { e: 1 };
    case 'i':
    case 'y':
      return { i: 1 };
    case 'o':
      return { o: 1 };
    case 'u':
    case 'w':
      return { u: 0.7, o: 0.3 };
    default:
      return null;
  }
}

function getHangulVisemeWeights(character: string): Partial<AvatarMouthVisemeProfile> | null {
  const code = character.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return null;

  const syllableIndex = code - 0xac00;
  const jungseongIndex = Math.floor((syllableIndex % 588) / 28);

  switch (jungseongIndex) {
    case 0: // ㅏ
    case 2: // ㅑ
      return { a: 1 };
    case 1: // ㅐ
    case 3: // ㅒ
    case 5: // ㅔ
    case 7: // ㅖ
      return { e: 1 };
    case 4: // ㅓ
      return { o: 0.65, e: 0.35 };
    case 6: // ㅕ
      return { o: 0.45, e: 0.55 };
    case 8: // ㅗ
    case 12: // ㅛ
      return { o: 1 };
    case 9: // ㅘ
      return { a: 0.58, o: 0.42 };
    case 10: // ㅙ
      return { e: 0.72, o: 0.28 };
    case 11: // ㅚ
      return { i: 0.42, o: 0.58 };
    case 13: // ㅜ
    case 17: // ㅠ
      return { u: 1 };
    case 14: // ㅝ
      return { u: 0.42, o: 0.58 };
    case 15: // ㅞ
      return { u: 0.3, e: 0.7 };
    case 16: // ㅟ
      return { u: 0.32, i: 0.68 };
    case 18: // ㅡ
      return { u: 0.68, i: 0.32 };
    case 19: // ㅢ
      return { u: 0.28, i: 0.72 };
    case 20: // ㅣ
      return { i: 1 };
    default:
      return null;
  }
}

function getTranscriptTail(transcript: string) {
  return transcript.trim().slice(-18);
}

function countSpeechUnits(transcript: string) {
  const latinChunks = transcript.match(/[A-Za-z]+/g)?.length ?? 0;
  const hangulSyllables = transcript.match(/[가-힣]/g)?.length ?? 0;
  return latinChunks + hangulSyllables;
}

function hashTranscriptSeed(transcript: string) {
  let hash = 0;
  for (let index = 0; index < transcript.length; index += 1) {
    hash = ((hash << 5) - hash + transcript.charCodeAt(index)) | 0;
  }
  return Math.abs(hash % 10_000) / 10_000;
}

function getQuestionTailBoost(transcript: string) {
  return /[?？]\s*$/.test(transcript) ? 0.12 : 0;
}

function getCorrectionStress(transcript: string, affect: AvatarAffect) {
  if (affect === 'corrective') {
    return 0.1;
  }

  if (/\b(try|instead|better|should|repeat|again)\b/i.test(transcript)) {
    return 0.08;
  }

  if (/(다시|이렇게|고쳐|수정|해보세요|연습)/.test(transcript)) {
    return 0.08;
  }

  return 0;
}

export function inferMouthVisemeProfile(
  transcript: string,
  affect: AvatarAffect,
  dialogueState: AvatarDialogueState
): AvatarMouthVisemeProfile {
  const profile = createEmptyVisemeProfile();
  const tail = getTranscriptTail(transcript);
  const characters = Array.from(tail);

  characters.forEach((character, index) => {
    const factor = 0.45 + ((index + 1) / Math.max(characters.length, 1)) * 0.95;
    const hangulWeights = getHangulVisemeWeights(character);
    if (hangulWeights) {
      addWeightedViseme(profile, hangulWeights, factor);
      return;
    }

    const latinWeights = getLatinVisemeWeights(character.toLowerCase());
    if (latinWeights) {
      addWeightedViseme(profile, latinWeights, factor);
    }
  });

  if (dialogueState === 'pre_speaking' || dialogueState === 'post_speaking') {
    addWeightedViseme(profile, { o: 0.5, u: 0.3, e: 0.2 }, 0.2);
  }

  if (affect === 'corrective') {
    addWeightedViseme(profile, { i: 0.45, e: 0.35, a: 0.2 }, 0.42);
  } else if (affect === 'apologetic') {
    addWeightedViseme(profile, { u: 0.4, o: 0.36, e: 0.24 }, 0.4);
  } else if (affect === 'encouraging' || affect === 'affirming') {
    addWeightedViseme(profile, { a: 0.38, e: 0.34, i: 0.28 }, 0.32);
  } else if (affect === 'curious') {
    addWeightedViseme(profile, { o: 0.34, e: 0.32, i: 0.18, a: 0.16 }, 0.36);
  }

  if (getQuestionTailBoost(transcript) > 0) {
    addWeightedViseme(profile, { o: 0.4, e: 0.34, i: 0.14, a: 0.12 }, 0.4);
  }

  return normalizeVisemeProfile(profile);
}

type BuildSpeechMouthTargetArgs = {
  audioLevel: number;
  rawRms: number;
  transcript: string;
  affect: AvatarAffect;
  dialogueState: AvatarDialogueState;
  now: number;
  assistantSpeechStartedAt: number | null;
};

export function buildSpeechMouthTarget({
  audioLevel,
  rawRms,
  transcript,
  affect,
  dialogueState,
  now,
  assistantSpeechStartedAt,
}: BuildSpeechMouthTargetArgs) {
  const speechUnits = countSpeechUnits(transcript);
  const density = clamp01(speechUnits / 18);
  const transcriptSeed = hashTranscriptSeed(transcript) * Math.PI * 2;
  const seconds = now / 1000;
  const questionBoost = getQuestionTailBoost(transcript);
  const correctionStress = getCorrectionStress(transcript, affect);
  const encouragementBoost = affect === 'encouraging' || affect === 'affirming' ? 0.04 : 0;
  const apologySoftness = affect === 'apologetic' ? 0.03 : 0;
  const syllableRate = 5.4 + density * 3.8 + questionBoost * 3.2;
  const syllablePulse = Math.max(0, Math.sin(seconds * syllableRate + transcriptSeed)) ** 2;
  const microPulse = Math.max(0, Math.sin(seconds * (syllableRate * 1.82) + transcriptSeed * 0.7 + 0.4)) ** 4;
  const feedEnergy = clamp01(audioLevel * 0.88 + rawRms * 10.5);
  const emphasis = clamp01(questionBoost + correctionStress + encouragementBoost);
  const speechStartedAt = assistantSpeechStartedAt ?? now;
  const attackEnvelope = clamp01((now - speechStartedAt) / 140);

  switch (dialogueState) {
    case 'pre_speaking':
      return clamp01(0.05 + attackEnvelope * 0.08 + syllablePulse * 0.04 + questionBoost * 0.03);
    case 'speaking': {
      const floor = 0.08 + density * 0.05 + apologySoftness;
      return clamp01(
        floor * Math.max(attackEnvelope, 0.75) +
        feedEnergy * 0.58 +
        syllablePulse * 0.17 +
        microPulse * 0.08 +
        emphasis * 0.1
      );
    }
    case 'post_speaking':
      return clamp01(0.025 + feedEnergy * 0.12 + syllablePulse * 0.04);
    case 'listening':
      return 0.025;
    case 'thinking':
      return 0.015;
    default:
      return 0.01;
  }
}

export function smoothSpeechMouthDrive(
  previous: number,
  target: number,
  dialogueState: AvatarDialogueState
) {
  let rise = 0.22;
  let fall = 0.14;

  switch (dialogueState) {
    case 'pre_speaking':
      rise = 0.44;
      fall = 0.2;
      break;
    case 'speaking':
      rise = 0.56;
      fall = 0.24;
      break;
    case 'post_speaking':
      rise = 0.28;
      fall = 0.18;
      break;
    case 'listening':
      rise = 0.2;
      fall = 0.16;
      break;
    default:
      rise = 0.18;
      fall = 0.12;
      break;
  }

  const factor = target > previous ? rise : fall;
  return clamp01(previous + (target - previous) * factor);
}
