export type AvatarChatMode = 'text' | 'realtime';

export type AvatarDialogueState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'pre_speaking'
  | 'speaking'
  | 'post_speaking';

export type AvatarAffect =
  | 'neutral'
  | 'encouraging'
  | 'curious'
  | 'corrective'
  | 'affirming'
  | 'apologetic';

export type AvatarEmotionKey =
  | 'neutral'
  | 'anger'
  | 'disgust'
  | 'fear'
  | 'joy'
  | 'smirk'
  | 'sadness'
  | 'surprise';

export type AvatarExpressionId =
  | 'neutral_primary'
  | 'neutral_soft'
  | 'warm_smile'
  | 'warm_bright'
  | 'curious_lift'
  | 'curious_smile'
  | 'corrective_focus'
  | 'corrective_soft'
  | 'apology_soft'
  | 'surprised_open'
  | 'playful_smirk'
  | 'affirm_soft';

export type AvatarMotionRef =
  | 'idle_base'
  | 'listening_attentive'
  | 'thinking_soft'
  | 'speaking_base'
  | 'speaking_question'
  | 'speaking_affirm'
  | 'speaking_corrective'
  | 'speaking_apology'
  | 'react_head_curious'
  | 'react_face_curious'
  | 'react_body_affirm'
  | 'post_speaking_soft';

export type AvatarReactionIntent =
  | 'none'
  | 'tap_head_notice'
  | 'tap_face_focus'
  | 'tap_body_affirm'
  | 'tap_hand_wave'
  | 'tap_chest_reassure';

export type AvatarDirective = {
  emotionKey?: AvatarEmotionKey | null;
  expressionId?: AvatarExpressionId | null;
  motionRef?: AvatarMotionRef | null;
  reactionIntent?: AvatarReactionIntent | null;
  intensity?: number | null;
  holdMs?: number | null;
  subtitleText?: string | null;
};

export type AvatarDirectiveSource = 'directive' | 'reaction' | 'fallback';

export type AvatarPerformanceSource = {
  mode: AvatarChatMode;
  isConnected: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  remoteAudioStream: MediaStream | null;
  assistantTranscriptDelta: string;
  assistantTranscriptFinal: string;
  assistantSpeechStartedAt: number | null;
  assistantSpeechEndedAt: number | null;
  avatarDirective: AvatarDirective | null;
  now: number;
};

export type AvatarPerformanceDebug = {
  audioLevel: number;
  rmsLevel: number;
  transcript: string;
  hasRemoteAudio: boolean;
  speakingEventState: 'idle' | 'listening' | 'speaking' | 'thinking';
  mouthTarget: number;
  detectedExpressionKeys: string[];
  directiveSource: AvatarDirectiveSource;
  lastExplicitDirective: AvatarDirective | null;
};

export type AvatarDiagnostics = {
  audioLevel: number;
  rmsLevel: number;
  hasRemoteAudio: boolean;
  speakingEventState: 'idle' | 'listening' | 'speaking' | 'thinking';
  mouthTarget: number;
  paramA: number | null;
  paramI: number | null;
  paramU: number | null;
  paramE: number | null;
  paramO: number | null;
  lastExplicitDirective: AvatarDirective | null;
  source: AvatarDirectiveSource;
};

export type AvatarPerformanceFrame = {
  dialogueState: AvatarDialogueState;
  affect: AvatarAffect;
  intensity: number;
  jawOpen: number;
  mouthRound: number;
  mouthSpread: number;
  smile: number;
  browInnerUp: number;
  browOuterUp: number;
  browDown: number;
  blink: number;
  gazeYaw: number;
  gazePitch: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  neckPitch: number;
  chestPitch: number;
  directive: AvatarDirective | null;
  directiveSource: AvatarDirectiveSource;
  debug: AvatarPerformanceDebug;
};
