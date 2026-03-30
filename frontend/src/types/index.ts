import type { MembershipSummary, SchoolRole } from './school';

// User Types
export interface User {
  uid: string;
  email: string;
  name: string;
  memberships?: MembershipSummary[];
  activeMembershipId?: string | null;
  activeOrganizationId?: string | null;
  activeRoles?: SchoolRole[];
}

// Profile form data for GeneralPage
export type Gender = 'male' | 'female' | 'other' | 'prefer_not_to_say';
export type Rigor = 'light' | 'casual' | 'moderate' | 'serious' | 'intense';
export type FrequencyUnit = 'day' | 'week' | 'month';
export type AssessmentPreference = 'take' | 'skip';

export interface ProfileFormData {
  displayName: string;
  age: number | null;
  gender: Gender | null;
  rigor: Rigor | null;
  frequency: number | null;
  frequencyUnit: FrequencyUnit | null;
  levelObjective: string;
  learningLocale?: LearningLocale;
  assessmentPreference?: AssessmentPreference;
  avatarUrl?: string;
  contactEmail?: string;
  gradeLevel?: string;
  nativeLanguage?: string;
  location?: string;
  schoolName?: string;
}

export interface UserProfile {
  // Profile completion status
  profileCompleted: boolean;
  assessed: boolean;

  // Basic info
  displayName?: string;
  age?: number;
  gender?: Gender;
  avatarUrl?: string;
  contactEmail?: string;
  gradeLevel?: string;
  nativeLanguage?: string;
  location?: string;
  schoolName?: string;

  // Learning preferences
  rigor?: Rigor;
  frequency?: number;
  frequencyUnit?: FrequencyUnit;
  levelObjective?: string;
  learningLocale?: LearningLocale;
  assessmentPreference?: AssessmentPreference;

  // Assessment results
  framework?: string;
  globalStage?: number;
  proficiencyLevel?: string;
  proficiencyDescription?: string;
  actflLevel?: string;
  actflDescription?: string;
  // Backward-compatible aliases.
  sklcLevel?: string;
  sklcDescription?: string;
  domainBands?: Record<string, number>;
  selectedCategories?: string[];
}

// Assessment Types
export interface AssessmentItem {
  id: string;
  section: string;
  item_type: 'mcq_single' | 'text_short' | 'audio_read';
  order: number;
  domains: Record<string, number>;
  ui: {
    prompt_en: string;
    prompt_ko: string;
    context?: string;
    instructions_en?: string;
    instructions_ko?: string;
  };
  content: {
    options?: Array<{ id: string; text: string }>;
    word_list?: string[];
    sentences?: string[];
  };
  scoring: {
    response_type: string;
    method: string;
    rules?: Array<{
      condition: Record<string, string>;
      score: number;
    }>;
  };
}

export interface AssessmentState {
  items: AssessmentItem[];
  currentIndex: number;
  responses: Record<string, string>;
  totalItems: number;
}

export interface AssessmentResults {
  framework?: string;
  bandScale?: number;
  globalStage: number;
  domainBands: Record<string, number>;
  proficiencyLevel: string;
  proficiencyDescription: string;
  actflLevel?: string;
  actflDescription?: string;
  // Backward-compatible aliases.
  sklcLevel?: string;
  sklcDescription?: string;
}

// Chat Types
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

// Raw message from API (no id)
export interface RawChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message?: string;
}

export interface ChatSessionDetail {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: RawChatMessage[];
}

// Pronunciation Types
export type PronunciationScoreSet = {
  accuracy?: number;
  fluency?: number;
  completeness?: number;
  prosody?: number | null;
};

export type PronunciationPhoneme = {
  phoneme: string;
  accuracy?: number;
};

export type PronunciationWord = {
  word: string;
  accuracy?: number;
  errorType?: string;
  phonemes?: PronunciationPhoneme[];
};

export interface PronunciationAttempt {
  id?: string;
  sessionId?: string;
  promptId: string;
  objectiveId?: string;
  referenceText: string;
  recognizedText: string;
  locale: LearningLocale;
  scores: PronunciationScoreSet;
  words: PronunciationWord[];
  audioUrl?: string;
  createdAt?: string;
  rawResult?: unknown;
}

export interface PronunciationSession {
  id: string;
  locale: LearningLocale;
  createdAt: string;
  updatedAt: string;
  voiceAllowed?: boolean;
  rawAudioStorageAllowed?: boolean;
  retentionPolicyId?: string;
}

// Minigame Types
export type MinigameType = 'listening_quiz' | 'grammar_challenge';

export interface MinigameAttempt {
  id?: string;
  gameType: MinigameType;
  locale: LearningLocale;
  objectiveId?: string | null;
  scenarioId?: string | null;
  score: number;
  correctAnswers: number;
  totalQuestions: number;
  accuracy?: number;
  durationSeconds?: number;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface MinigameSummaryByGame {
  attempts: number;
  averageAccuracy: number;
  bestScore: number;
}

export interface MinigameSummary {
  totalAttempts: number;
  averageAccuracy: number;
  bestScore: number;
  totalQuestions: number;
  totalCorrectAnswers: number;
  byGame: Record<string, MinigameSummaryByGame>;
  recentAttempts: MinigameAttempt[];
}

// API Response Types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// Language Type
export type Language = 'en' | 'ko';
export type LearningLocale = 'ko-KR' | 'es-ES' | 'fr-FR';

// Curriculum Types
export type {
  BulkUpdateClassCompliancePayload,
  BulkUpdateClassComplianceResult,
  ClassComplianceRosterData,
  ClassComplianceRosterSummary,
  ClassComplianceStudentEntry,
  ConsentStatus,
  CreateSchoolPayload,
  CreateTeacherClassPayload,
  GuardianConsentContactChannel,
  GuardianConsentDecisionResult,
  GuardianConsentDeliveryMethod,
  GuardianConsentIssueResult,
  GuardianConsentPacket,
  GuardianConsentPacketStatus,
  GuardianConsentPublicView,
  IssueGuardianConsentPacketPayload,
  MembershipSummary,
  RetentionPolicySummary,
  SchoolContextSummary,
  OrganizationType,
  SetupChecklistItem,
  StudentComplianceRecord,
  TeacherClassSummary,
  TeacherDashboardData,
  TeacherDashboardSummary,
  UpdateStudentCompliancePayload,
  ClassJoinCodeData,
  ClassRosterStudent,
  JoinClassResult,
  MembershipStatus,
  SchoolRole,
  DeletionScopeType,
  DeletionRequestStatus,
  DeletionRunStatus,
  DeletionRequest,
  DeletionExecutionRun,
  CreateDeletionRequestPayload,
  DeletionRequestDetail,
  OrgComplianceSummary,
  OrgComplianceStudentEntry,
  OrgComplianceRosterData,
  OrgGuardianPacketsData,
  SchoolRequest,
  TeacherInvitation,
} from './school';

export type {
  AssignmentAnalyticsData,
  AssignmentBootstrapData,
  AssignmentDto,
  AssignmentStatus,
  AssignmentTaskType,
  ClassAnalyticsAssignmentCard,
  ClassAnalyticsData,
  ClassAnalyticsStudentCard,
  CreateAssignmentPayload,
  CreateCurriculumMappingPayload,
  CreatePracticeSessionPayload,
  CurriculumMappingDto,
  FeedbackPolicy,
  ModalityMode,
  ModalityPolicy,
  OutputPolicy,
  PracticeSessionCostSummary,
  PracticeSessionDto,
  PracticeSessionEventPayload,
  PracticeSessionSummary,
  ScaffoldPolicy,
  StudentAssignmentSummary,
  StudentDrillDownAssignmentCard,
  StudentDrillDownData,
  StudentDrillDownRepeatedError,
  TeacherCurriculumPackageSummary,
} from './assignment';

export type {
  I18nText,
  CurriculumMode,
  SupportDomain,
  SourceRef,
  Unit,
  SituationSeedConstraints,
  SituationSeed,
  Situation,
  SupportTarget,
  ModuleSupportTargets,
  Capstone,
  Module,
  Objective,
  ActivityTemplateDefinition,
  CurriculumPackageV1,
} from './curriculum';

export type {
  CanvasConnectResult,
  CanvasConnectionStatus,
  CanvasCourse,
  CanvasCourseContentItem,
  CanvasSyncResult,
  CanvasSyncRosterResult,
  CanvasTeacher,
  CanvasValidateResult,
} from './canvas';
