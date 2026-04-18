import type { RetentionPolicySummary } from './school';

// ---------------------------------------------------------------------------
// Curriculum primitives (inlined from the now-deleted curriculum.ts — C2).
// These power the assignment bootstrap/analytics DTOs and the Canvas-generated
// activity template metadata that the resolver still emits.
// ---------------------------------------------------------------------------

export type I18nText = Record<string, string>;

export type CurriculumMode =
  | 'interpretive_listening'
  | 'interpersonal_speaking'
  | 'presentational_speaking';

export interface ActivityTemplateDefinition {
  id: string;
  title: I18nText;
  mode: CurriculumMode | string;
  assistantRole: string;
  interactionPattern: {
    openingMoves: string[];
    sustainMoves: string[];
    closingMoves: string[];
    completionRule: string;
  };
  promptCues: string[];
}

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

export interface OutputPolicy {
  minStudentTurnWords: number;
  followUpPressure: 'light' | 'balanced' | 'high' | string;
  allowClarificationRequests: boolean;
}

export interface ModalityPolicy {
  mode: ModalityMode;
  voiceMinutesCap?: number | null;
  textFallbackEnabled: boolean;
}

/**
 * Shape of the `mapping` slot returned by the assignment bootstrap response.
 *
 * C2 deleted the `curriculum_mappings` collection entirely, but the bootstrap
 * payload keeps a mapping-shaped DTO for backwards compatibility with older
 * frontend consumers. The scenario-bearing fields (`generatedScenario`,
 * `targetExpressions`, `focusGrammar`, `teacherNotes`, `outputPolicy`) are
 * populated from the assignment document by the Canvas-generated resolver.
 */
export interface BootstrapMappingDto {
  id: string | null;
  orgId: string | null;
  classId: string | null;
  packageId: string;
  moduleId: string | null;
  objectiveIds: string[];
  situationIds: string[];
  targetExpressions: string[];
  focusGrammar: string[];
  allowedContextTags: string[];
  feedbackPolicy: FeedbackPolicy;
  scaffoldPolicy: ScaffoldPolicy;
  outputPolicy?: OutputPolicy;
  modalityPolicy: ModalityPolicy;
  rubricFocus: string[];
  teacherNotes: string;
  createdByUid: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  generatedScenario?: string;
  sourceCanvasItemTitle?: string;
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
  canvasModuleItemId?: string;
  canvasModuleItemRef?: {
    connection_id?: string;
    canvas_module_id?: string;
    item_id?: string;
  };
  instructions?: string;
  generatedScenario?: string;
  objectives?: string[];
  targetExpressions?: string[];
  focusGrammar?: string[];
  teacherNotes?: string;
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
  communicativeFunctions: string[];
  discourseMoves: string[];
  foundationDomains: string[];
  register?: string | null;
  mastery: {
    rubricId?: string | null;
    threshold?: number | null;
  };
  evidenceModel: {
    taskModel?: string | null;
    timeLimitSec?: number | null;
    minTurns?: number | null;
    inputProfile?: Record<string, unknown>;
  };
  templateRefs: string[];
}

export interface AssignmentBootstrapRubric {
  id: string;
  title: I18nText;
  scale: {
    min: number;
    max: number;
    step?: number;
  };
  dimensions: Array<{
    id: string;
    title: I18nText;
    description: I18nText;
  }>;
  notes?: string;
}

export interface AssignmentBootstrapPedagogy {
  taskModel: string;
  evidence: {
    timeLimitSec?: number | null;
    minTurns?: number | null;
    maxTurns?: number | null;
    maxReplays?: number | null;
  };
  contextTags: string[];
  communicativeFunctions: string[];
  discourseMoves: string[];
  foundationDomains: string[];
  templateRefs: string[];
  activityTemplates: ActivityTemplateDefinition[];
  objectiveIds: string[];
  rubricIds: string[];
  rubricDimensionIds: string[];
}

export interface AssignmentBootstrapData {
  assignment: AssignmentDto;
  mapping: BootstrapMappingDto;
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
      capstone?: {
        mode?: CurriculumMode | string | null;
        taskModel?: string | null;
        situationId?: string | null;
      } | null;
    };
    situation: {
      id: string;
      kind: CurriculumMode | string;
      seed: Record<string, unknown>;
      objectiveIds: string[];
    };
    objectives: AssignmentBootstrapObjective[];
    rubrics: AssignmentBootstrapRubric[];
    pedagogy: AssignmentBootstrapPedagogy;
  };
  launch: {
    modality: ModalityPolicy;
    configuredMode?: ModalityMode | string;
    voiceAllowed: boolean;
    textAllowed: boolean;
    fallbackApplied?: boolean;
    blockedReasons?: string[];
    retentionPolicy?: RetentionPolicySummary | null;
    maxAttempts?: number | null;
    taskType: AssignmentTaskType | string;
  };
  realtimeSessionParams: {
    uiLanguage: string;
    practice: {
      type: 'curriculum_module' | 'canvas_generated' | string;
      curriculumId?: string;
      moduleId?: string;
      situationId?: string;
      assignmentId: string;
      classId: string;
      mappingId?: string | null;
      objectiveIds: string[];
      taskModel: string;
      rubricIds: string[];
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
  objectiveTurnCounts?: Record<string, number>;
  foundationDomainTurnCounts?: Record<string, number>;
  rubricTurnCounts?: Record<string, number>;
  errorCounts?: Record<string, number>;
  repeatedErrorCounts?: Record<string, number>;
  communicativeFunctionSignals?: Record<string, number>;
  discourseMoveSignals?: Record<string, number>;
  rubricDimensionSignalCounts?: Record<string, number>;
  rubricDimensionErrorCounts?: Record<string, number>;
  rubricDimensionScores?: Record<string, number>;
  taskModel?: string;
  evidenceProgress?: {
    minTurnsTarget?: number | null;
    maxTurnsTarget?: number | null;
    timeLimitSec?: number | null;
    maxReplays?: number | null;
    minTurnsReached?: boolean;
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
  class: AssignmentBootstrapData['class'];
  mapping: BootstrapMappingDto;
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
    selfCorrectionCount: number;
    taskCompletionCount: number;
    repeatedErrorCount: number;
    rubricAverageScore?: number | null;
    feedbackCounts: {
      recast: number;
      elicitation: number;
      reviewItem: number;
    };
    eventCount: number;
  };
  pedagogy: {
    taskModel: string;
    evidence: {
      timeLimitSec?: number | null;
      minTurns?: number | null;
      maxTurns?: number | null;
      maxReplays?: number | null;
    };
    targetExpressions: Array<{ id: string; count: number }>;
    contextTagCoverage: Array<{ id: string; count: number }>;
    communicativeFunctionSignals: Array<{ id: string; count: number }>;
    discourseMoveSignals: Array<{ id: string; count: number }>;
    foundationDomainCoverage: Array<{ id: string; count: number }>;
    repeatedErrors: Array<{
      id: string;
      label: string;
      category: string;
      count: number;
      rubricDimensionIds: string[];
      studentCount?: number;
    }>;
    rubricDimensionScores: Array<{ id: string; score: number }>;
    objectives: Array<{
      id: string;
      mode: CurriculumMode | string;
      canDo: I18nText;
      contextTags: string[];
      communicativeFunctions: string[];
      discourseMoves: string[];
      foundationDomains: string[];
      register?: string | null;
      rubricId?: string | null;
      rubricThreshold?: number | null;
      templateRefs: string[];
      turnCount: number;
      estimatedRubricScore?: number | null;
      meetingThreshold?: boolean;
    }>;
    rubrics: Array<{
      id: string;
      title: I18nText;
      scale: {
        min: number;
        max: number;
        step?: number;
      };
      dimensions: Array<{
        id: string;
        title: I18nText;
        description: I18nText;
        averageScore?: number | null;
        threshold?: number | null;
        meetingThreshold?: boolean;
        confidence?: string;
        signalCount: number;
        errorCount: number;
        evidence?: string[];
        concerns?: string[];
      }>;
      notes?: string;
      turnCount: number;
      averageScore?: number | null;
      threshold?: number | null;
      meetingThreshold?: boolean;
      confidence?: string;
    }>;
  };
  recentSessions: PracticeSessionDto[];
  limitations: string[];
}

export interface CreateAssignmentPayload {
  title: string;
  description?: string;
  status?: AssignmentStatus;
  releaseAt?: string;
  dueAt?: string;
  modalityOverride?: Partial<ModalityPolicy>;
  maxAttempts?: number | null;
  taskType?: AssignmentTaskType;
  successCriteria?: string[];
  instructions: string;
  generatedScenario: string;
  objectives?: string[];
  targetExpressions?: string[];
  focusGrammar?: string[];
  teacherNotes?: string;
  canvasModuleItemRef?: {
    connection_id?: string;
    canvas_module_id?: string;
    item_id?: string;
  };
}

export interface CreatePracticeSessionPayload {
  uiLanguage?: string;
  chatId?: string;
}

// ---------------------------------------------------------------------------
// Class-level analytics
// ---------------------------------------------------------------------------

export interface ClassAnalyticsAssignmentCard {
  id: string;
  title: string;
  status: string;
  taskType: string;
  dueAt?: string | null;
  sessionCount: number;
  completedSessionCount: number;
  activeSessionCount: number;
  uniqueStudentCount: number;
  totalStudentTurns: number;
  totalStudentWords: number;
  averageStudentWordsPerTurn: number;
  estimatedSpeakingTimeSeconds: number;
  selfCorrectionCount: number;
  taskCompletionCount: number;
  repeatedErrorCount: number;
  feedbackCounts: {
    recast: number;
    elicitation: number;
    reviewItem: number;
  };
}

export interface ClassAnalyticsStudentCard {
  uid: string;
  displayName: string;
  email: string;
  sessionCount: number;
  completedSessionCount: number;
  activeSessionCount: number;
  uniqueStudentCount: number;
  totalStudentTurns: number;
  totalStudentWords: number;
  averageStudentWordsPerTurn: number;
  estimatedSpeakingTimeSeconds: number;
  selfCorrectionCount: number;
  taskCompletionCount: number;
  repeatedErrorCount: number;
  feedbackCounts: {
    recast: number;
    elicitation: number;
    reviewItem: number;
  };
}

export interface ClassAnalyticsData {
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
  summary: {
    sessionCount: number;
    completedSessionCount: number;
    activeSessionCount: number;
    uniqueStudentCount: number;
    enrolledStudentCount: number;
    assignmentCount: number;
    totalStudentTurns: number;
    totalStudentWords: number;
    averageStudentWordsPerTurn: number;
    estimatedSpeakingTimeSeconds: number;
    selfCorrectionCount: number;
    taskCompletionCount: number;
    repeatedErrorCount: number;
    feedbackCounts: {
      recast: number;
      elicitation: number;
      reviewItem: number;
    };
  };
  assignments: ClassAnalyticsAssignmentCard[];
  students: ClassAnalyticsStudentCard[];
  limitations: string[];
}

// ---------------------------------------------------------------------------
// Student drill-down analytics
// ---------------------------------------------------------------------------

export interface StudentDrillDownAssignmentCard {
  id: string;
  title: string;
  status: string;
  taskType: string;
  dueAt?: string | null;
  sessionCount: number;
  completedSessionCount: number;
  activeSessionCount: number;
  uniqueStudentCount: number;
  totalStudentTurns: number;
  totalStudentWords: number;
  averageStudentWordsPerTurn: number;
  estimatedSpeakingTimeSeconds: number;
  selfCorrectionCount: number;
  taskCompletionCount: number;
  repeatedErrorCount: number;
  feedbackCounts: {
    recast: number;
    elicitation: number;
    reviewItem: number;
  };
  targetExpressionHits: Record<string, number>;
  targetExpressionTotalHits: number;
  rubricDimensionScores: Array<{ id: string; score: number }>;
  rubricAverageScore?: number | null;
}

export interface StudentDrillDownRepeatedError {
  id: string;
  label: string;
  category: string;
  count: number;
  rubricDimensionIds: string[];
}

export interface StudentDrillDownData {
  student: {
    uid: string;
    displayName: string;
    email: string;
  };
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
  summary: {
    sessionCount: number;
    completedSessionCount: number;
    activeSessionCount: number;
    uniqueStudentCount: number;
    totalStudentTurns: number;
    totalStudentWords: number;
    averageStudentWordsPerTurn: number;
    estimatedSpeakingTimeSeconds: number;
    selfCorrectionCount: number;
    taskCompletionCount: number;
    repeatedErrorCount: number;
    feedbackCounts: {
      recast: number;
      elicitation: number;
      reviewItem: number;
    };
  };
  assignments: StudentDrillDownAssignmentCard[];
  repeatedErrors: StudentDrillDownRepeatedError[];
  recentSessions: PracticeSessionDto[];
  limitations: string[];
}
