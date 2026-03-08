import api from './index';
import type {
  ClassAnalyticsData,
  CreateTeacherClassPayload,
  StudentDrillDownData,
  TeacherClassSummary,
  TeacherDashboardData,
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

export const getClassAnalytics = async (classId: string): Promise<ClassAnalyticsData> => {
  const response = await api.get<ClassAnalyticsResponse>(`/teacher/classes/${classId}/analytics`);
  return response.data.analytics;
};

export const getStudentDrillDown = async (
  classId: string,
  studentUid: string,
): Promise<StudentDrillDownData> => {
  const response = await api.get<StudentDrillDownResponse>(
    `/teacher/classes/${classId}/students/${studentUid}/analytics`,
  );
  return response.data.analytics;
};
