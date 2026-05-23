import api from './index';
import type {
  TeacherJoinRequest,
  PendingTeacherRequestRow,
  OrgSearchResult,
} from '@/types/teacherJoin';

export interface SubmitArgs {
  inviteCode?: string;
  orgId?: string;
}

export interface SubmitResult {
  requestId: string;
  orgId: string;
  orgName: string;
  status: 'pending';
  source: 'invite_code' | 'search';
}

export async function submitTeacherJoinRequest(args: SubmitArgs): Promise<SubmitResult> {
  const payload: Record<string, string> = {};
  if (args.inviteCode) payload.inviteCode = args.inviteCode;
  if (args.orgId) payload.orgId = args.orgId;
  const { data } = await api.post('/teacher-join-requests', payload);
  return {
    requestId: data.requestId,
    orgId: data.orgId,
    orgName: data.orgName,
    status: 'pending',
    source: data.source,
  };
}

export async function getMyTeacherJoinRequest(): Promise<TeacherJoinRequest | null> {
  const resp = await api.get('/teacher-join-requests/me');
  if (resp.status === 204 || !resp.data) return null;
  return resp.data as TeacherJoinRequest;
}

export async function cancelMyTeacherJoinRequest(): Promise<void> {
  await api.delete('/teacher-join-requests/me');
}

export async function listPendingTeacherRequests(): Promise<PendingTeacherRequestRow[]> {
  const { data } = await api.get('/teacher-join-requests');
  return data.requests ?? [];
}

export async function approveTeacherJoinRequest(requestId: string): Promise<void> {
  await api.post(`/teacher-join-requests/${encodeURIComponent(requestId)}/approve`);
}

export async function declineTeacherJoinRequest(
  requestId: string,
  reason: string,
): Promise<void> {
  await api.post(
    `/teacher-join-requests/${encodeURIComponent(requestId)}/decline`,
    { reason },
  );
}

export async function searchOrganizations(query: string): Promise<OrgSearchResult[]> {
  const q = (query ?? '').trim();
  if (!q) return [];
  const { data } = await api.get('/organizations/search', { params: { q } });
  return data.results ?? [];
}
