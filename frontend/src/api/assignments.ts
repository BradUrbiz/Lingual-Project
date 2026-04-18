import api from './index';
import type {
  AssignmentAnalyticsData,
  AssignmentBootstrapData,
  AssignmentDto,
  CreatePracticeSessionPayload,
  CreateAssignmentPayload,
  CreateCurriculumMappingPayload,
  CurriculumMappingDto,
  PracticeSessionDto,
  PracticeSessionEventPayload,
  StudentAssignmentSummary,
  TeacherCurriculumPackageSummary,
} from '@/types';

interface PackageListResponse {
  success: boolean;
  packages: TeacherCurriculumPackageSummary[];
  limitations?: string[];
}

interface MappingListResponse {
  success: boolean;
  mappings: CurriculumMappingDto[];
}

interface MappingCreateResponse {
  success: boolean;
  mapping: CurriculumMappingDto;
}

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

interface PracticeSessionResponse {
  success: boolean;
  practiceSession: PracticeSessionDto;
}

interface AssignmentAnalyticsResponse {
  success: boolean;
  analytics: AssignmentAnalyticsData;
}

interface AssignmentDraftGenerateResponse {
  success: boolean;
  suggestions: {
    scenario: string;
    targetExpressions: string[];
    focusGrammar: string[];
    successCriteria: string[];
    taskType: string;
    suggestedTitle: string;
    suggestedDescription: string;
    teacherNotes: string;
    objectives?: string[];
  };
  error?: string;
}

export const getTeacherCurriculumPackages = async (
  classId: string
): Promise<{ packages: TeacherCurriculumPackageSummary[]; limitations: string[] }> => {
  const response = await api.get<PackageListResponse>(`/teacher/classes/${classId}/curriculum/packages`);
  return {
    packages: response.data.packages,
    limitations: response.data.limitations ?? [],
  };
};

export const getCurriculumMappings = async (classId: string): Promise<CurriculumMappingDto[]> => {
  const response = await api.get<MappingListResponse>(`/teacher/classes/${classId}/curriculum/mappings`);
  return response.data.mappings;
};

export const createCurriculumMapping = async (
  classId: string,
  payload: CreateCurriculumMappingPayload
): Promise<CurriculumMappingDto> => {
  const response = await api.post<MappingCreateResponse>(`/teacher/classes/${classId}/curriculum/mappings`, payload);
  return response.data.mapping;
};

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
  return response.data.analytics;
};
