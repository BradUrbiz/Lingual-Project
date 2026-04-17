import api from './index';
import type { SchoolRequest, TeacherInvitation } from '@/types';

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

// --- Teacher invitations (teacher applies, school admin reviews) ---

export const listTeacherInvitations = async (
  status?: string,
): Promise<TeacherInvitation[]> => {
  const params = status ? { status } : undefined;
  const response = await api.get<{ success: boolean; invitations: TeacherInvitation[] }>(
    '/schools/teacher-invitations',
    { params },
  );
  return response.data.invitations;
};

export const approveTeacherInvitation = async (
  id: string,
): Promise<TeacherInvitation> => {
  const response = await api.post<{ success: boolean; invitation: TeacherInvitation }>(
    `/schools/teacher-invitations/${id}/approve`,
  );
  return response.data.invitation;
};

export const rejectTeacherInvitation = async (
  id: string,
): Promise<TeacherInvitation> => {
  const response = await api.post<{ success: boolean; invitation: TeacherInvitation }>(
    `/schools/teacher-invitations/${id}/reject`,
  );
  return response.data.invitation;
};

// --- Join school as teacher ---

export interface JoinSchoolAsTeacherResult {
  invitationId: string;
  membershipId?: string;
  orgName: string;
  status: string;
}

export const joinSchoolAsTeacher = async (
  inviteCode: string,
): Promise<JoinSchoolAsTeacherResult> => {
  const response = await api.post<{ success: boolean } & JoinSchoolAsTeacherResult>(
    '/schools/join-as-teacher',
    { inviteCode },
  );
  return {
    invitationId: response.data.invitationId,
    membershipId: response.data.membershipId,
    orgName: response.data.orgName,
    status: response.data.status,
  };
};
