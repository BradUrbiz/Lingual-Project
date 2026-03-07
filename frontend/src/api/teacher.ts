import api from './index';
import type { CreateTeacherClassPayload, TeacherClassSummary, TeacherDashboardData } from '@/types';

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
