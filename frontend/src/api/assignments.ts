import api from './index';
import type {
  AssignmentAnalyticsData,
  AssignmentBootstrapData,
  AssignmentDto,
  AssignmentWorkspaceData,
  CreatePracticeSessionPayload,
  CreateAssignmentPayload,
  PracticeSessionDto,
  PracticeSessionEventPayload,
  StudentAssignmentSummary,
} from '@/types';

interface AssignmentListResponse {
  success: boolean;
  assignments: StudentAssignmentSummary[];
}

interface AssignmentCreateResponse {
  success: boolean;
  assignment: AssignmentDto;
}

interface AssignmentBootstrapResponse {
  success: boolean;
  bootstrap: AssignmentBootstrapData;
}

interface AssignmentWorkspaceResponse {
  success: boolean;
  workspace: AssignmentWorkspaceData;
}

interface PracticeSessionResponse {
  success: boolean;
  practiceSession: PracticeSessionDto;
}

interface AssignmentAnalyticsResponse {
  success: boolean;
  analytics: AssignmentAnalyticsData;
  debriefEnabled?: boolean;
  debriefRollupEnabled?: boolean;
}

interface AssignmentDraftGenerateResponse {
  success: boolean;
  suggestions: {
    scenario: string;
    targetExpressions: string[];
    targetVocabulary: string[];
    focusGrammar: string[];
    successCriteria: string[];
    suggestedTitle: string;
    suggestedDescription: string;
    teacherNotes: string;
    objectives?: string[];
  };
  error?: string;
}

export const getTeacherAssignments = async (classId: string): Promise<StudentAssignmentSummary[]> => {
  const response = await api.get<AssignmentListResponse>(`/teacher/classes/${classId}/assignments`);
  return response.data.assignments;
};

export const createAssignment = async (
  classId: string,
  payload: CreateAssignmentPayload
): Promise<AssignmentDto> => {
  const response = await api.post<AssignmentCreateResponse>(`/teacher/classes/${classId}/assignments`, payload);
  return response.data.assignment;
};

export const generateAssignmentDraft = async (
  classId: string,
  sourceText: string,
): Promise<AssignmentDraftGenerateResponse> => {
  const response = await api.post<AssignmentDraftGenerateResponse>(
    `/teacher/classes/${classId}/assignment-drafts/generate`,
    { sourceText },
  );
  return response.data;
};

export const getStudentAssignments = async (): Promise<StudentAssignmentSummary[]> => {
  const response = await api.get<AssignmentListResponse>('/student/assignments');
  return response.data.assignments;
};

export const bootstrapStudentAssignment = async (
  assignmentId: string,
  uiLanguage = 'en'
): Promise<AssignmentBootstrapData> => {
  const response = await api.post<AssignmentBootstrapResponse>(`/student/assignments/${assignmentId}/bootstrap`, {
    uiLanguage,
  });
  return response.data.bootstrap;
};

export const getStudentAssignmentWorkspace = async (
  assignmentId: string,
): Promise<AssignmentWorkspaceData> => {
  const response = await api.get<AssignmentWorkspaceResponse>(`/student/assignments/${assignmentId}/workspace`);
  return response.data.workspace;
};

export const createAssignmentPracticeSession = async (
  assignmentId: string,
  payload: CreatePracticeSessionPayload
): Promise<PracticeSessionDto> => {
  const response = await api.post<PracticeSessionResponse>(
    `/student/assignments/${assignmentId}/practice-sessions`,
    payload
  );
  return response.data.practiceSession;
};

export const reportPracticeSessionEvent = async (
  sessionId: string,
  payload: PracticeSessionEventPayload
): Promise<PracticeSessionDto> => {
  const response = await api.post<PracticeSessionResponse>(`/practice-sessions/${sessionId}/events`, payload);
  return response.data.practiceSession;
};

export const getAssignmentAnalytics = async (assignmentId: string): Promise<AssignmentAnalyticsData> => {
  const response = await api.get<AssignmentAnalyticsResponse>(`/teacher/assignments/${assignmentId}/analytics`);
  return {
    ...response.data.analytics,
    debriefEnabled: response.data.debriefEnabled,
    debriefRollupEnabled: response.data.debriefRollupEnabled,
  };
};
