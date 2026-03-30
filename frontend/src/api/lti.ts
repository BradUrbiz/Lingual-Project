import api from './index';

export interface LtiPlatformConfig {
  id: string;
  issuer: string;
  clientId: string;
  deploymentId: string;
  authLoginUrl: string;
  authTokenUrl: string;
  keySetUrl: string;
}

export const registerLtiPlatform = async (payload: Omit<LtiPlatformConfig, 'id'>): Promise<{ platformId: string }> => {
  const response = await api.post('/schools/lti-platform', payload);
  return response.data;
};

export const getLtiPlatform = async (): Promise<LtiPlatformConfig | null> => {
  const response = await api.get<{ success: boolean; platform: LtiPlatformConfig | null }>('/schools/lti-platform');
  return response.data.platform;
};

export const deleteLtiPlatform = async (): Promise<void> => {
  await api.delete('/schools/lti-platform');
};

export const setGradeConfig = async (assignmentId: string, payload: { metric: string | null; points: number | null }): Promise<void> => {
  await api.post(`/teacher/assignments/${assignmentId}/grade-config`, payload);
};

export const getGradeConfig = async (assignmentId: string): Promise<{ metric: string | null; points: number | null }> => {
  const response = await api.get(`/teacher/assignments/${assignmentId}/grade-config`);
  return response.data;
};

export interface DeepLinkContext {
  classId: string | null;
  canvasCourseId: string;
  canvasCourseTitle: string;
}

export const getDeepLinkContext = async (): Promise<DeepLinkContext> => {
  const response = await api.get<{ success: boolean } & DeepLinkContext>('/lti/deep-link/context');
  return response.data;
};

export interface DeepLinkAssignment {
  id: string;
  title: string;
  status: string;
  taskType?: string;
}

export const getDeepLinkAssignments = async (): Promise<DeepLinkAssignment[]> => {
  const response = await api.get<{ success: boolean; assignments: DeepLinkAssignment[] }>('/lti/deep-link/assignments');
  return response.data.assignments;
};

export const submitDeepLinkResponse = async (payload: { assignmentId: string; points?: number }): Promise<{ responseHtml: string }> => {
  const response = await api.post<{ success: boolean; responseHtml: string }>('/lti/deep-link/respond', payload);
  return response.data;
};

export const linkLtiAccount = async (): Promise<{ redirectTo: string }> => {
  const response = await api.post<{ success: boolean; redirectTo: string }>('/lti/link-account');
  return response.data;
};
