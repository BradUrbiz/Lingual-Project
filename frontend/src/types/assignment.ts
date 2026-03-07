import type { CurriculumMode, I18nText } from './curriculum';

export type FeedbackMode = 'fluency_first' | 'balanced' | 'accuracy_first' | string;
export type ModalityMode = 'text_only' | 'voice_only' | 'hybrid';
export type AssignmentStatus = 'draft' | 'published' | 'archived';
export type AssignmentTaskType = 'information_gap' | 'opinion_gap' | 'decision_making';

export interface FeedbackPolicy {
  mode: FeedbackMode;
  targetOnlyStrict: boolean;
  recastDefault: boolean;
  elicitationRepeatThreshold: number;
  endReviewEnabled: boolean;
}

export interface ScaffoldPolicy {
  silenceToleranceMs: number;
  hintLadder: string[];
  maxModelingSteps: number;
}

export interface ModalityPolicy {
  mode: ModalityMode;
  voiceMinutesCap?: number | null;
  textFallbackEnabled: boolean;
}

export interface CurriculumMappingDto {
  id: string;
  orgId: string;
  classId: string;
  packageId: string;
  moduleId: string;
  objectiveIds: string[];
  situationIds: string[];
  targetExpressions: string[];
  focusGrammar: string[];
  allowedContextTags: string[];
  feedbackPolicy: FeedbackPolicy;
  scaffoldPolicy: ScaffoldPolicy;
  modalityPolicy: ModalityPolicy;
  rubricFocus: string[];
  teacherNotes: string;
  createdByUid: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface TeacherCurriculumPackageSummary {
  id: string;
  title: I18nText;
  learningLocale: string;
  levelBand: string;
  version: string;
  sourceType: string;
  status: string;
  ownerScope: string;
}

export interface AssignmentDto {
  id: string;
  orgId: string;
  classId: string;
  mappingId: string;
  title: string;
  description: string;
  status: AssignmentStatus | string;
  releaseAt?: string | null;
  dueAt?: string | null;
  modalityOverride: ModalityPolicy;
  maxAttempts?: number | null;
  taskType: AssignmentTaskType | string;
  successCriteria: string[];
  createdByUid: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface StudentAssignmentSummary extends AssignmentDto {
  className?: string;
}

export interface AssignmentBootstrapObjective {
  id: string;
  mode: CurriculumMode | string;
  canDo: I18nText;
  contextTags: string[];
}

export interface AssignmentBootstrapData {
  assignment: AssignmentDto;
  mapping: CurriculumMappingDto;
  class: {
    id: string;
    orgId: string;
    name: string;
    term?: string;
    subject?: string;
    learningLocale: string;
    gradeBand?: string;
    status: string;
  };
  curriculum: {
    package: TeacherCurriculumPackageSummary;
    unit: {
      id: string;
      title: I18nText;
      unitNumber?: number;
    };
    module: {
      id: string;
      title: I18nText;
      goal: I18nText;
    };
    situation: {
      id: string;
      kind: CurriculumMode | string;
      seed: Record<string, unknown>;
    };
    objectives: AssignmentBootstrapObjective[];
  };
  launch: {
    modality: ModalityPolicy;
    voiceAllowed: boolean;
    textAllowed: boolean;
    maxAttempts?: number | null;
    taskType: AssignmentTaskType | string;
  };
  realtimeSessionParams: {
    uiLanguage: string;
    practice: {
      type: 'curriculum_module';
      curriculumId: string;
      moduleId: string;
      situationId: string;
      assignmentId: string;
      classId: string;
      mappingId: string;
    };
  };
  systemPromptPreview: string;
  limitations: string[];
  teacherPreview?: boolean;
}

export interface PracticeSessionSummary {
  totalTurns: number;
  studentTurnCount: number;
  assistantTurnCount: number;
  totalStudentWords: number;
  averageStudentWordsPerTurn: number;
  estimatedSpeakingTimeSeconds: number;
  targetExpressionHits: Record<string, number>;
  targetExpressionTotalHits: number;
  selfCorrectionCount: number;
  taskCompletionCount: number;
  feedbackCounts: {
    recast: number;
    elicitation: number;
    reviewItem: number;
  };
  endedReason?: string | null;
}

export interface PracticeSessionCostSummary {
  estimatedUsd: number;
  estimatedVoiceSeconds: number;
  estimatedTextTurns: number;
}

export interface PracticeSessionDto {
  id: string;
  orgId: string;
  classId: string;
  assignmentId: string;
  studentUid: string;
  chatId?: string | null;
  status: string;
  modality: ModalityMode | string;
  voiceEnabled: boolean;
  textEnabled: boolean;
  startedAt?: string | null;
  endedAt?: string | null;
  promptVersion: string;
  sessionSummary: PracticeSessionSummary;
  costSummary: PracticeSessionCostSummary;
  teacherPreview?: boolean;
}

export interface PracticeSessionEventPayload {
  eventType: string;
  turnIndex?: number | null;
  payload?: Record<string, unknown>;
}

export interface AssignmentAnalyticsData {
  assignment: AssignmentDto;
  summary: {
    sessionCount: number;
    completedSessionCount: number;
    activeSessionCount: number;
    uniqueStudentCount: number;
    totalStudentTurns: number;
    totalAssistantTurns: number;
    totalStudentWords: number;
    averageStudentWordsPerTurn: number;
    estimatedSpeakingTimeSeconds: number;
    targetExpressionHits: Record<string, number>;
    targetExpressionTotalHits: number;
  };
  recentSessions: PracticeSessionDto[];
  limitations: string[];
}

export interface CreateCurriculumMappingPayload {
  packageId: string;
  moduleId: string;
  objectiveIds: string[];
  situationIds: string[];
  targetExpressions?: string[];
  focusGrammar?: string[];
  allowedContextTags?: string[];
  feedbackPolicy?: Partial<FeedbackPolicy>;
  scaffoldPolicy?: Partial<ScaffoldPolicy>;
  modalityPolicy?: Partial<ModalityPolicy>;
  rubricFocus?: string[];
  teacherNotes?: string;
}

export interface CreateAssignmentPayload {
  mappingId: string;
  title: string;
  description?: string;
  status?: AssignmentStatus;
  releaseAt?: string;
  dueAt?: string;
  modalityOverride?: Partial<ModalityPolicy>;
  maxAttempts?: number | null;
  taskType?: AssignmentTaskType;
  successCriteria?: string[];
}

export interface CreatePracticeSessionPayload {
  uiLanguage?: string;
  chatId?: string;
}
