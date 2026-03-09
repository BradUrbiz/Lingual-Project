import api from './index';
import type { CreateSchoolPayload, JoinClassResult, SchoolContextSummary } from '@/types';

interface SchoolContextResponse {
  success: boolean;
  school: SchoolContextSummary;
}

export const getCurrentSchool = async (): Promise<SchoolContextSummary> => {
  const response = await api.get<SchoolContextResponse>('/schools/current');
  return response.data.school;
};

export const createSchool = async (payload: CreateSchoolPayload): Promise<SchoolContextSummary> => {
  const response = await api.post<SchoolContextResponse>('/schools', payload);
  return response.data.school;
};

export const setActiveMembership = async (membershipId: string): Promise<SchoolContextSummary> => {
  const response = await api.post<SchoolContextResponse>('/schools/current/active-membership', {
    membershipId,
  });
  return response.data.school;
};

interface JoinClassResponse {
  success: boolean;
  alreadyEnrolled: boolean;
  class: { id: string; name: string; subject?: string; learningLocale?: string };
  membershipId?: string;
  enrollmentId?: string;
}

export const joinClassByCode = async (joinCode: string): Promise<JoinClassResult> => {
  const response = await api.post<JoinClassResponse>('/schools/join', { joinCode });
  return {
    alreadyEnrolled: response.data.alreadyEnrolled,
    class: response.data.class,
    membershipId: response.data.membershipId,
    enrollmentId: response.data.enrollmentId,
  };
};
