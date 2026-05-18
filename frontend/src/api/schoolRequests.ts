import api from './index';
import type { SchoolRequest } from '@/types';

// --- School request (teacher submits, Lingual admin reviews) ---

export interface SubmitSchoolRequestPayload {
  schoolName: string;
  orgType: string;
  websiteUrl?: string;
  canvasInstanceUrl?: string;
}

export const submitSchoolRequest = async (
  payload: SubmitSchoolRequestPayload,
): Promise<SchoolRequest> => {
  const response = await api.post<{ success: boolean; request: SchoolRequest }>(
    '/school-requests',
    payload,
  );
  return response.data.request;
};

export const getMySchoolRequest = async (): Promise<SchoolRequest | null> => {
  const response = await api.get<{ success: boolean; request: SchoolRequest | null }>(
    '/school-requests/mine',
  );
  return response.data.request;
};

// --- Admin review ---

export const listSchoolRequests = async (
  status?: string,
): Promise<SchoolRequest[]> => {
  const params = status ? { status } : undefined;
  const response = await api.get<{ success: boolean; requests: SchoolRequest[] }>(
    '/admin/school-requests',
    { params },
  );
  return response.data.requests;
};

export const approveSchoolRequest = async (
  id: string,
): Promise<SchoolRequest> => {
  const response = await api.post<{ success: boolean; request: SchoolRequest }>(
    `/admin/school-requests/${id}/approve`,
  );
  return response.data.request;
};

export const rejectSchoolRequest = async (
  id: string,
  reason?: string,
): Promise<SchoolRequest> => {
  const response = await api.post<{ success: boolean; request: SchoolRequest }>(
    `/admin/school-requests/${id}/reject`,
    { reason },
  );
  return response.data.request;
};

// --- Teacher invite codes (school admin generates, teacher uses to join) ---

export interface TeacherInviteCodeData {
  inviteCode: string;
  active: boolean;
  generatedAt: string | null;
}

export const generateTeacherInviteCode = async (): Promise<TeacherInviteCodeData> => {
  const response = await api.post<{ success: boolean; inviteCode: TeacherInviteCodeData }>(
    '/schools/teacher-invite-code',
  );
  return response.data.inviteCode;
};

export const getTeacherInviteCode = async (): Promise<TeacherInviteCodeData | null> => {
  const response = await api.get<{ success: boolean; inviteCode: TeacherInviteCodeData | null }>(
    '/schools/teacher-invite-code',
  );
  return response.data.inviteCode;
};

export const deactivateTeacherInviteCode = async (): Promise<void> => {
  await api.delete('/schools/teacher-invite-code');
};

