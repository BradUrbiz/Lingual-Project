import axios from 'axios';
import api from './index';
import type {
  BulkUpdateClassCompliancePayload,
  BulkUpdateClassComplianceResult,
  ClassComplianceRosterData,
  ClassAnalyticsData,
  ClassJoinCodeData,
  ClassRosterStudent,
  CanvasRosterGapEntry,
  CanvasRosterGapResponse,
  CanvasRosterGapSummary,
  CreateTeacherClassPayload,
  GuardianConsentIssueResult,
  GuardianConsentPacket,
  IssueGuardianConsentPacketPayload,
  StudentDrillDownData,
  StudentComplianceRecord,
  TeacherClassSummary,
  TeacherDashboardData,
  UpdateStudentCompliancePayload,
} from '@/types';

interface TeacherDashboardResponse {
  success: boolean;
  dashboard: TeacherDashboardData;
}

interface TeacherClassesResponse {
  success: boolean;
  classes: TeacherClassSummary[];
}

interface TeacherClassCreateResponse {
  success: boolean;
  class: TeacherClassSummary;
}

interface ClassAnalyticsResponse {
  success: boolean;
  analytics: ClassAnalyticsData;
}

interface StudentDrillDownResponse {
  success: boolean;
  analytics: StudentDrillDownData;
  debriefEnabled?: boolean;
}

interface StudentComplianceResponse {
  success: boolean;
  compliance: StudentComplianceRecord;
  guardianPacket?: GuardianConsentPacket | null;
}

interface ClassComplianceRosterResponse {
  success: boolean;
  roster: ClassComplianceRosterData;
}

interface BulkUpdateClassComplianceResponse {
  success: boolean;
  batchId: string;
  updatedCount: number;
  studentUids: string[];
}

interface GuardianPacketResponse {
  success: boolean;
  error?: string;
  guardianPacket: GuardianConsentPacket | null;
  deliveryToken?: string;
}

function extractTeacherApiError(error: unknown, fallbackMessage: string) {
  if (axios.isAxiosError<GuardianPacketResponse>(error)) {
    return error.response?.data?.error || fallbackMessage;
  }
  return error instanceof Error ? error.message : fallbackMessage;
}

export const getTeacherDashboard = async (): Promise<TeacherDashboardData> => {
  const response = await api.get<TeacherDashboardResponse>('/teacher/dashboard');
  return response.data.dashboard;
};

export const getTeacherClasses = async (): Promise<TeacherClassSummary[]> => {
  const response = await api.get<TeacherClassesResponse>('/teacher/classes');
  return response.data.classes;
};

export const createTeacherClass = async (
  payload: CreateTeacherClassPayload
): Promise<TeacherClassSummary> => {
  const response = await api.post<TeacherClassCreateResponse>('/teacher/classes', payload);
  return response.data.class;
};

export const getClassAnalytics = async (
  classId: string,
  filters?: { dateFrom?: string; dateTo?: string },
): Promise<ClassAnalyticsData> => {
  const params: Record<string, string> = {};
  if (filters?.dateFrom) params.dateFrom = filters.dateFrom;
  if (filters?.dateTo) params.dateTo = filters.dateTo;
  const response = await api.get<ClassAnalyticsResponse>(`/teacher/classes/${classId}/analytics`, {
    params: Object.keys(params).length > 0 ? params : undefined,
  });
  return response.data.analytics;
};

export const getStudentDrillDown = async (
  classId: string,
  studentUid: string,
): Promise<StudentDrillDownData> => {
  const response = await api.get<StudentDrillDownResponse>(
    `/teacher/classes/${classId}/students/${studentUid}/analytics`,
  );
  return { ...response.data.analytics, debriefEnabled: response.data.debriefEnabled ?? false };
};

export const getStudentCompliance = async (
  classId: string,
  studentUid: string,
): Promise<StudentComplianceRecord> => {
  const response = await api.get<StudentComplianceResponse>(
    `/teacher/classes/${classId}/students/${studentUid}/compliance`,
  );
  return response.data.compliance;
};

export const updateStudentCompliance = async (
  classId: string,
  studentUid: string,
  payload: UpdateStudentCompliancePayload,
): Promise<StudentComplianceRecord> => {
  const response = await api.put<StudentComplianceResponse>(
    `/teacher/classes/${classId}/students/${studentUid}/compliance`,
    payload,
  );
  return response.data.compliance;
};

export const getClassComplianceRoster = async (classId: string): Promise<ClassComplianceRosterData> => {
  const response = await api.get<ClassComplianceRosterResponse>(`/teacher/classes/${classId}/compliance`);
  return response.data.roster;
};

export const bulkUpdateClassCompliance = async (
  classId: string,
  payload: BulkUpdateClassCompliancePayload,
): Promise<BulkUpdateClassComplianceResult> => {
  const response = await api.put<BulkUpdateClassComplianceResponse>(
    `/teacher/classes/${classId}/compliance/bulk`,
    payload,
  );
  return {
    batchId: response.data.batchId,
    updatedCount: response.data.updatedCount,
    studentUids: response.data.studentUids,
  };
};

export const downloadClassComplianceAuditExport = async (classId: string): Promise<void> => {
  const response = await api.get<Blob>(`/teacher/classes/${classId}/compliance/audit-export`, {
    responseType: 'blob',
  });
  const downloadUrl = window.URL.createObjectURL(response.data);
  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = `${classId}-consent-audit-export.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(downloadUrl);
};

export const getStudentGuardianConsentPacket = async (
  classId: string,
  studentUid: string,
): Promise<GuardianConsentPacket | null> => {
  try {
    const response = await api.get<GuardianPacketResponse>(
      `/teacher/classes/${classId}/students/${studentUid}/guardian-consent-packet`,
    );
    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to load guardian packet.');
    }
    return response.data.guardianPacket;
  } catch (error) {
    throw new Error(extractTeacherApiError(error, 'Failed to load guardian packet.'));
  }
};

export const issueStudentGuardianConsentPacket = async (
  classId: string,
  studentUid: string,
  payload: IssueGuardianConsentPacketPayload,
): Promise<GuardianConsentIssueResult> => {
  try {
    const response = await api.post<GuardianPacketResponse>(
      `/teacher/classes/${classId}/students/${studentUid}/guardian-consent-packets`,
      payload,
    );
    if (!response.data.success || !response.data.guardianPacket) {
      throw new Error(response.data.error || 'Failed to issue guardian packet.');
    }
    return {
      guardianPacket: response.data.guardianPacket,
      deliveryToken: response.data.deliveryToken,
    };
  } catch (error) {
    throw new Error(extractTeacherApiError(error, 'Failed to issue guardian packet.'));
  }
};

export const resendStudentGuardianConsentPacket = async (
  classId: string,
  studentUid: string,
  packetId: string,
): Promise<GuardianConsentIssueResult> => {
  try {
    const response = await api.post<GuardianPacketResponse>(
      `/teacher/classes/${classId}/students/${studentUid}/guardian-consent-packets/${packetId}/resend`,
    );
    if (!response.data.success || !response.data.guardianPacket) {
      throw new Error(response.data.error || 'Failed to resend guardian packet.');
    }
    return {
      guardianPacket: response.data.guardianPacket,
      deliveryToken: response.data.deliveryToken,
    };
  } catch (error) {
    throw new Error(extractTeacherApiError(error, 'Failed to resend guardian packet.'));
  }
};

// ── Join code management ──────────────────────────────────────────────

interface JoinCodeResponse {
  success: boolean;
  joinCode: string;
  active: boolean;
  generatedAt: string | null;
}

interface RosterResponse {
  success: boolean;
  roster: ClassRosterStudent[];
}

export const generateClassJoinCode = async (classId: string): Promise<ClassJoinCodeData> => {
  const response = await api.post<JoinCodeResponse>(`/teacher/classes/${classId}/join-code`);
  return {
    joinCode: response.data.joinCode,
    active: response.data.active,
    generatedAt: response.data.generatedAt,
  };
};

export const getClassJoinCode = async (classId: string): Promise<ClassJoinCodeData> => {
  const response = await api.get<JoinCodeResponse>(`/teacher/classes/${classId}/join-code`);
  return {
    joinCode: response.data.joinCode,
    active: response.data.active,
    generatedAt: response.data.generatedAt,
  };
};

export const deactivateClassJoinCode = async (classId: string): Promise<void> => {
  await api.delete(`/teacher/classes/${classId}/join-code`);
};

// ── Roster management ─────────────────────────────────────────────────

export const getClassRoster = async (classId: string): Promise<ClassRosterStudent[]> => {
  const response = await api.get<RosterResponse>(`/teacher/classes/${classId}/roster`);
  return response.data.roster;
};

export const removeStudentFromClass = async (classId: string, studentUid: string): Promise<void> => {
  await api.delete(`/teacher/classes/${classId}/students/${studentUid}`);
};

// ── Session debrief ───────────────────────────────────────────────────

export interface SessionDebrief {
  sessionId: string | null;
  status: string | null;
  startedAt: string | null;
  endedAt: string | null;
  coverage: {
    expressionHits: Record<string, number>;
    vocabularyHits: Record<string, number>;
    uncovered: string[];
    recycle: string[];
  };
  uptake: {
    selfCorrectionCount: number;
    feedbackCounts: { recast: number; elicitation: number; reviewItem: number };
    taskCompletionCount: number;
  };
  repeatedErrors: { label: string; count: number }[];
  coachReview: Record<string, unknown> | null;
  promotions?: {
    count: number;
    items: { turnIndex: number | null; reason: string; target: string }[];
  };
  directorReSteers?: {
    count: number;
    items: { turnIndex: number | null; kind: string; target: string; reason: string }[];
  };
  helpUsage: { askCount: number; byKind: Record<string, number> };
  affect: { readiness: string | null; reason: string | null } | null;
  suggestedNext: string[];
  caveats: string[];
}

export const getSessionDebrief = async (sessionId: string): Promise<SessionDebrief | null> => {
  const response = await api.get<{ success: boolean; debrief?: SessionDebrief }>(
    `/teacher/practice-sessions/${sessionId}/debrief`,
  );
  return response.data.success && response.data.debrief ? response.data.debrief : null;
};

// ── Assignment debrief (pedagogy S4.2b) ──────────────────────────────

export interface AssignmentDebrief {
  assignmentId: string | null;
  participation: {
    sessionCount: number;
    completedSessionCount: number;
    studentCount: number;
    firstStartedAt: string | null;
    lastStartedAt: string | null;
  };
  uptake: {
    selfCorrectionCount: number;
    feedbackCounts: { recast: number; elicitation: number; reviewItem: number };
    taskCompletionCount: number;
  };
  promotions: { count: number; byTarget: { target: string; count: number; sessionCount: number }[] };
  directorReSteers: { count: number; byKind: Record<string, number>; byTarget: { target: string; count: number }[] };
  helpUsage: { askCount: number; byKind: Record<string, number>; sessionsWithHelp: number };
  affect: { byReadiness: Record<string, number>; sessionsWithSignal: number };
  coachReview: { sessionCount: number };
  suggestedNext: string[];
  caveats: string[];
}

export const getAssignmentDebrief = async (assignmentId: string): Promise<AssignmentDebrief | null> => {
  const response = await api.get<{ success: boolean; debrief?: AssignmentDebrief }>(
    `/teacher/assignments/${assignmentId}/debrief`,
  );
  return response.data.success && response.data.debrief ? response.data.debrief : null;
};

// ── Assignment plan preview (pedagogy L8) ─────────────────────────────

export interface PlanPreviewTarget {
  surface: string;
  kind: string;
  feedbackRoute: string;
}

export interface PlanPreviewRealizedTarget {
  surface: string;
  kind: string;
  measurable: boolean;
  hits: number | null;
  tier: string | null;
  studentsElicited: number | null;
}

export interface PlanPreviewUptakeTarget {
  surface: string;
  afterPrompt: number;
  afterRecast: number;
  unprompted: number;
}

export interface PlanPreviewUptake {
  window: number;
  totals: { afterPrompt: number; afterRecast: number; unprompted: number; measured: number };
  perTarget: PlanPreviewUptakeTarget[];
}

export interface PlanPreviewRealized {
  studentCount: number;
  sessionCount: number;
  perTarget: PlanPreviewRealizedTarget[];
  neverElicited: string[];
  alignmentRate: { measurableTargetCount: number; elicitedCount: number; solidCount: number };
  uptake?: PlanPreviewUptake | null;
}

export interface PlanPreview {
  engineEnabled: boolean;
  rawTutorMode: boolean;
  taskType?: string;
  correctionPosture?: { mode: string; recastDefault: boolean; elicitationRepeatThreshold: number };
  targets?: PlanPreviewTarget[];
  recycling?: unknown;
  guaranteesDisabled?: string[];
  realized?: PlanPreviewRealized | null;
}

export const getAssignmentPlanPreview = async (
  assignmentId: string,
  opts?: { realized?: boolean },
): Promise<PlanPreview | null> => {
  const response = await api.get<{ success: boolean; teacherPreviewEnabled: boolean; planPreview?: PlanPreview | null }>(
    `/teacher/assignments/${assignmentId}/plan-preview${opts?.realized ? '?realized=1' : ''}`,
  );
  return response.data.success && response.data.teacherPreviewEnabled ? (response.data.planPreview ?? null) : null;
};

// ── Canvas roster gap (advisory; does not drive enrollment) ───────────

interface CanvasRosterGapApiResponse {
  success: boolean;
  gap: CanvasRosterGapEntry[];
  summary: CanvasRosterGapSummary | null;
}

export const getClassCanvasRosterGap = async (
  classId: string,
): Promise<CanvasRosterGapResponse> => {
  const response = await api.get<CanvasRosterGapApiResponse>(
    `/teacher/classes/${classId}/canvas-roster-gap`,
  );
  return { gap: response.data.gap, summary: response.data.summary };
};

// ── Guardian consent ──────────────────────────────────────────────────

export const cancelStudentGuardianConsentPacket = async (
  classId: string,
  studentUid: string,
  packetId: string,
): Promise<GuardianConsentPacket> => {
  try {
    const response = await api.post<GuardianPacketResponse>(
      `/teacher/classes/${classId}/students/${studentUid}/guardian-consent-packets/${packetId}/cancel`,
    );
    if (!response.data.success || !response.data.guardianPacket) {
      throw new Error(response.data.error || 'Failed to cancel guardian packet.');
    }
    return response.data.guardianPacket;
  } catch (error) {
    throw new Error(extractTeacherApiError(error, 'Failed to cancel guardian packet.'));
  }
};
