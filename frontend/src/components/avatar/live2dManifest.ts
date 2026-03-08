import type {
  AvatarAffect,
  AvatarDialogueState,
  AvatarMotionGroup
} from '@/types/avatarChat';
import type {
  AvatarExpressionId,
  AvatarMotionRef,
  AvatarEmotionKey,
} from './types';

export type Live2DEmotionKey =
  | 'neutral'
  | 'anger'
  | 'disgust'
  | 'fear'
  | 'joy'
  | 'smirk'
  | 'sadness'
  | 'surprise';

export type Live2DMotionRef = {
  group: string;
  index?: number;
  weight?: number;
};

export type Live2DNamedExpressionBank = {
  candidates: string[];
  cooldownMs: number;
  weights?: number[];
};

export type Live2DNamedMotionBank = {
  candidates: Live2DMotionRef[];
  cooldownMs: number;
  weights?: number[];
};

export type Live2DParameterMap = {
  mouthOpen: string[];
  mouthSpread: string[];
  mouthRound: string[];
  mouthSmile: string[];
  mouthFrown: string[];
  angleX: string[];
  angleY: string[];
  angleZ: string[];
  bodyAngleX: string[];
  bodyAngleY: string[];
  bodyAngleZ: string[];
  eyeBallX: string[];
  eyeBallY: string[];
  eyeBallForm: string[];
  eyeEffect: string[];
  eyeLOpen: string[];
  eyeROpen: string[];
  eyeLSmile: string[];
  eyeRSmile: string[];
  eyeLForm: string[];
  eyeRForm: string[];
  browLY: string[];
  browRY: string[];
  browLX: string[];
  browRX: string[];
  browLAngle: string[];
  browRAngle: string[];
  browLForm: string[];
  browRForm: string[];
  cheek: string[];
  breath: string[];
  leftShoulderUp: string[];
  rightShoulderUp: string[];
};

export type Live2DManifest = {
  modelId: string;
  modelJsonPath: string;
  coreScriptUrl: string;
  scale: number;
  /** Base zoom level (model height in logical units). Calibrated for ~0.88 safe-area fraction on desktop. */
  logicalViewHeight?: number;
  /** Visual center of the character within the model canvas, as fraction (0-1) from top-left. */
  anchor: { x: number; y: number };
  /** CSS-pixel padding around the viewport edges, added on top of runtime insets. */
  viewportPaddingPx?: { top: number; right: number; bottom: number; left: number };
  hitAreas: Record<string, string[]>;
  defaultExpression?: string;
  namedExpressions: Record<AvatarExpressionId, Live2DNamedExpressionBank>;
  namedMotions: Record<AvatarMotionRef, Live2DNamedMotionBank>;
  defaultMotionGroups: Partial<Record<AvatarMotionGroup | AvatarDialogueState, AvatarMotionRef[]>>;
  tapMotions: Partial<Record<'head' | 'face' | 'body' | 'hand' | 'chest', AvatarMotionRef[]>>;
  expressionMap: Partial<Record<AvatarAffect | AvatarEmotionKey | Live2DEmotionKey, AvatarExpressionId[]>>;
  parameterMap: Live2DParameterMap;
};

export const LINGUAL_TUTOR_LIVE2D_MANIFEST: Live2DManifest = {
  modelId: 'mao-pro-en-live2d',
  modelJsonPath: '/avatars/live2d/mao-pro-en/mao_pro.model3.json',
  coreScriptUrl: '/live2d/core/live2dcubismcore.min.js',
  scale: 0.16,
  logicalViewHeight: 5.6,
  anchor: { x: 0.0, y: 0.28 },
  viewportPaddingPx: {
    top: 24,
    right: 24,
    bottom: 24,
    left: 24,
  },
  hitAreas: {
    head: ['Head', 'HitAreaHead', 'head'],
    face: ['Face', 'HitAreaHead', 'face'],
    body: ['Body', 'HitAreaBody', 'body', 'Bust'],
    hand: ['Hand', 'HitAreaHand', 'hand'],
    chest: ['Chest', 'HitAreaChest', 'chest'],
  },
  defaultExpression: 'exp_01',
  namedExpressions: {
    neutral_primary: {
      candidates: ['exp_01'],
      cooldownMs: 240,
      weights: [1],
    },
    neutral_soft: {
      candidates: ['exp_01', 'exp_03'],
      cooldownMs: 420,
      weights: [3, 1],
    },
    warm_smile: {
      candidates: ['exp_04', 'exp_06'],
      cooldownMs: 900,
      weights: [2, 1],
    },
    warm_bright: {
      candidates: ['exp_06', 'exp_02', 'exp_04'],
      cooldownMs: 1100,
      weights: [2, 1, 1],
    },
    curious_lift: {
      candidates: ['exp_07', 'exp_04'],
      cooldownMs: 950,
      weights: [2, 1],
    },
    curious_smile: {
      candidates: ['exp_04', 'exp_07'],
      cooldownMs: 900,
      weights: [2, 1],
    },
    corrective_focus: {
      candidates: ['exp_08', 'exp_05'],
      cooldownMs: 980,
      weights: [2, 1],
    },
    corrective_soft: {
      candidates: ['exp_05', 'exp_08'],
      cooldownMs: 980,
      weights: [2, 1],
    },
    apology_soft: {
      candidates: ['exp_05', 'exp_03'],
      cooldownMs: 1080,
      weights: [2, 1],
    },
    surprised_open: {
      candidates: ['exp_07', 'exp_04'],
      cooldownMs: 960,
      weights: [2, 1],
    },
    playful_smirk: {
      candidates: ['exp_04', 'exp_08'],
      cooldownMs: 1200,
      weights: [3, 1],
    },
    affirm_soft: {
      candidates: ['exp_06', 'exp_04', 'exp_02'],
      cooldownMs: 960,
      weights: [2, 2, 1],
    },
  },
  namedMotions: {
    idle_base: {
      candidates: [{ group: 'Idle', index: 0, weight: 100 }],
      cooldownMs: 240,
    },
    listening_attentive: {
      candidates: [
        { group: 'Idle', index: 0, weight: 70 },
        { group: '', index: 0, weight: 20 },
        { group: '', index: 1, weight: 10 },
      ],
      cooldownMs: 900,
    },
    thinking_soft: {
      candidates: [
        { group: 'Idle', index: 0, weight: 60 },
        { group: '', index: 1, weight: 25 },
        { group: '', index: 2, weight: 15 },
      ],
      cooldownMs: 950,
    },
    speaking_base: {
      candidates: [
        { group: '', index: 0, weight: 38 },
        { group: '', index: 1, weight: 28 },
        { group: '', index: 2, weight: 24 },
        { group: 'Idle', index: 0, weight: 10 },
      ],
      cooldownMs: 700,
    },
    speaking_question: {
      candidates: [
        { group: '', index: 3, weight: 45 },
        { group: '', index: 1, weight: 35 },
        { group: '', index: 2, weight: 20 },
      ],
      cooldownMs: 880,
    },
    speaking_affirm: {
      candidates: [
        { group: '', index: 0, weight: 35 },
        { group: '', index: 5, weight: 35 },
        { group: '', index: 1, weight: 30 },
      ],
      cooldownMs: 860,
    },
    speaking_corrective: {
      candidates: [
        { group: '', index: 2, weight: 40 },
        { group: '', index: 4, weight: 35 },
        { group: '', index: 3, weight: 25 },
      ],
      cooldownMs: 920,
    },
    speaking_apology: {
      candidates: [
        { group: '', index: 4, weight: 45 },
        { group: '', index: 2, weight: 35 },
        { group: 'Idle', index: 0, weight: 20 },
      ],
      cooldownMs: 920,
    },
    react_head_curious: {
      candidates: [
        { group: '', index: 3, weight: 55 },
        { group: '', index: 5, weight: 45 },
      ],
      cooldownMs: 1200,
    },
    react_face_curious: {
      candidates: [
        { group: '', index: 3, weight: 45 },
        { group: '', index: 2, weight: 30 },
        { group: '', index: 5, weight: 25 },
      ],
      cooldownMs: 1200,
    },
    react_body_affirm: {
      candidates: [
        { group: '', index: 4, weight: 45 },
        { group: '', index: 5, weight: 35 },
        { group: '', index: 0, weight: 20 },
      ],
      cooldownMs: 1200,
    },
    post_speaking_soft: {
      candidates: [
        { group: 'Idle', index: 0, weight: 75 },
        { group: '', index: 0, weight: 25 },
      ],
      cooldownMs: 580,
    },
  },
  defaultMotionGroups: {
    idle: ['idle_base'],
    listening: ['listening_attentive'],
    think: ['thinking_soft'],
    thinking: ['thinking_soft'],
    talk: ['speaking_base'],
    speaking: ['speaking_base'],
    question: ['speaking_question'],
    affirm: ['speaking_affirm'],
    corrective: ['speaking_corrective'],
    apology: ['speaking_apology'],
    react_head: ['react_head_curious'],
    react_face: ['react_face_curious'],
    react_body: ['react_body_affirm'],
    post_speaking: ['post_speaking_soft'],
  },
  tapMotions: {
    head: ['react_head_curious'],
    face: ['react_face_curious'],
    body: ['react_body_affirm'],
  },
  expressionMap: {
    neutral: ['neutral_primary', 'neutral_soft'],
    joy: ['warm_smile', 'warm_bright'],
    smirk: ['playful_smirk', 'warm_smile'],
    sadness: ['apology_soft', 'neutral_soft'],
    anger: ['corrective_focus', 'corrective_soft'],
    disgust: ['corrective_focus'],
    fear: ['surprised_open', 'apology_soft'],
    surprise: ['surprised_open', 'curious_lift'],
    encouraging: ['warm_smile', 'warm_bright'],
    curious: ['curious_lift', 'curious_smile'],
    corrective: ['corrective_focus', 'corrective_soft'],
    affirming: ['affirm_soft', 'warm_smile'],
    apologetic: ['apology_soft', 'neutral_soft'],
  },
  parameterMap: {
    mouthOpen: ['ParamA'],
    mouthSpread: ['ParamI', 'ParamE'],
    mouthRound: ['ParamU', 'ParamO'],
    mouthSmile: ['ParamMouthUp'],
    mouthFrown: ['ParamMouthDown', 'ParamMouthAngry', 'ParamMouthAngryLine'],
    angleX: ['ParamAngleX'],
    angleY: ['ParamAngleY'],
    angleZ: ['ParamAngleZ'],
    bodyAngleX: ['ParamBodyAngleX'],
    bodyAngleY: ['ParamBodyAngleY'],
    bodyAngleZ: ['ParamBodyAngleZ'],
    eyeBallX: ['ParamEyeBallX'],
    eyeBallY: ['ParamEyeBallY'],
    eyeBallForm: ['ParamEyeBallForm'],
    eyeEffect: ['ParamEyeEffect'],
    eyeLOpen: ['ParamEyeLOpen'],
    eyeROpen: ['ParamEyeROpen'],
    eyeLSmile: ['ParamEyeLSmile'],
    eyeRSmile: ['ParamEyeRSmile'],
    eyeLForm: ['ParamEyeLForm'],
    eyeRForm: ['ParamEyeRForm'],
    browLY: ['ParamBrowLY'],
    browRY: ['ParamBrowRY'],
    browLX: ['ParamBrowLX'],
    browRX: ['ParamBrowRX'],
    browLAngle: ['ParamBrowLAngle'],
    browRAngle: ['ParamBrowRAngle'],
    browLForm: ['ParamBrowLForm'],
    browRForm: ['ParamBrowRForm'],
    cheek: ['ParamCheek'],
    breath: ['ParamBreath'],
    leftShoulderUp: ['ParamLeftShoulderUp'],
    rightShoulderUp: ['ParamRightShoulderUp'],
  },
};
