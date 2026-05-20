import api from './index';
import type {
  OverviewResponse,
  RequestsListResponse,
  SchoolRequestDetail,
  ApprovePayload,
  ApproveResponse,
  DeclinePayload,
  OrgsListResponse,
  OrgDetail,
  MembersResponse,
  ClassesResponse,
  OrgAuditResponse,
  SuspendPayload,
} from '@/types/lingualAdmin';

export async function fetchOverview(): Promise<OverviewResponse> {
  const { data } = await api.get('/lingual-admin/overview');
  return data;
}

export interface RequestsFilters {
  status?: string;
  schoolType?: string;
  country?: string;
  sort?: 'requested_at_desc' | 'requested_at_asc' | 'name';
  cursor?: { id: string };
}

export async function fetchRequests(
  filters: RequestsFilters = {},
): Promise<RequestsListResponse> {
  const params: Record<string, string> = {};
  if (filters.status) params.status = filters.status;
  if (filters.schoolType) params.schoolType = filters.schoolType;
  if (filters.country) params.country = filters.country;
  if (filters.sort) params.sort = filters.sort;
  if (filters.cursor) params.cursor = JSON.stringify(filters.cursor);
  const { data } = await api.get('/lingual-admin/requests', { params });
  return data;
}

export async function fetchRequestDetail(id: string): Promise<SchoolRequestDetail> {
  const { data } = await api.get(`/lingual-admin/requests/${id}`);
  return data;
}

export async function approveRequest(
  id: string,
  payload: ApprovePayload = {},
): Promise<ApproveResponse> {
  const { data } = await api.post(
    `/lingual-admin/requests/${id}/approve`,
    payload,
  );
  return data;
}

export async function declineRequest(
  id: string,
  payload: DeclinePayload,
): Promise<{ requestId: string }> {
  const { data } = await api.post(
    `/lingual-admin/requests/${id}/decline`,
    payload,
  );
  return data;
}

export interface OrgsFilters {
  status?: 'active' | 'suspended' | 'archived';
  schoolType?: string;
  country?: string;
  publicOrPrivate?: string;
  cursor?: { nameLower: string; id: string };
}

export async function fetchOrgs(filters: OrgsFilters = {}): Promise<OrgsListResponse> {
  const params: Record<string, string> = {};
  if (filters.status) params.status = filters.status;
  if (filters.schoolType) params.schoolType = filters.schoolType;
  if (filters.country) params.country = filters.country;
  if (filters.publicOrPrivate) params.publicOrPrivate = filters.publicOrPrivate;
  if (filters.cursor) params.cursor = JSON.stringify(filters.cursor);
  const { data } = await api.get('/lingual-admin/organizations', { params });
  return data;
}

export async function fetchOrgDetail(orgId: string): Promise<OrgDetail> {
  const { data } = await api.get(`/lingual-admin/organizations/${orgId}`);
  return data;
}

export async function fetchOrgMembers(orgId: string): Promise<MembersResponse> {
  const { data } = await api.get(
    `/lingual-admin/organizations/${orgId}/members`,
  );
  return data;
}

export async function fetchOrgClasses(orgId: string): Promise<ClassesResponse> {
  const { data } = await api.get(
    `/lingual-admin/organizations/${orgId}/classes`,
  );
  return data;
}

export async function fetchOrgAudit(
  orgId: string,
  limit = 50,
): Promise<OrgAuditResponse> {
  const { data } = await api.get(
    `/lingual-admin/organizations/${orgId}/audit`,
    { params: { limit } },
  );
  return data;
}

export async function suspendOrg(
  orgId: string,
  payload: SuspendPayload,
): Promise<void> {
  await api.post(
    `/lingual-admin/organizations/${orgId}/suspend`,
    payload,
  );
}

export async function restoreOrg(orgId: string): Promise<void> {
  await api.post(`/lingual-admin/organizations/${orgId}/restore`);
}

export async function removeMember(
  orgId: string,
  membershipId: string,
  payload: { reason: string },
): Promise<void> {
  await api.delete(
    `/lingual-admin/organizations/${orgId}/members/${membershipId}`,
    { data: payload },
  );
}
