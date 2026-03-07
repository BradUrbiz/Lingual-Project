import api from './index';
import type { CreateSchoolPayload, SchoolContextSummary } from '@/types';

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
