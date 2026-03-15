import api from './index';
import type {
  CreateDeletionRequestPayload,
  DeletionExecutionRun,
  DeletionRequest,
  GuardianConsentPacket,
  OrgComplianceRosterData,
  OrgComplianceSummary,
  OrgGuardianPacketsData,
  UpdateStudentCompliancePayload,
} from '@/types';

interface DeletionRequestsResponse {
  success: boolean;
  requests: DeletionRequest[];
}

interface DeletionRequestResponse {
  success: boolean;
  request: DeletionRequest;
  runs?: DeletionExecutionRun[];
}

interface DeletionExecuteResponse {
  success: boolean;
  request: DeletionRequest;
  run: DeletionExecutionRun;
}

export const listDeletionRequests = async (
  statusFilter?: string,
): Promise<DeletionRequest[]> => {
  const params = statusFilter ? { status: statusFilter } : {};
  const { data } = await api.get<DeletionRequestsResponse>(
    '/admin/deletion-requests',
    { params },
  );
  return data.requests;
};

export const createDeletionRequest = async (
  payload: CreateDeletionRequestPayload,
): Promise<DeletionRequest> => {
  const { data } = await api.post<DeletionRequestResponse>(
    '/admin/deletion-requests',
    payload,
  );
  return data.request;
};

export const getDeletionRequest = async (
  requestId: string,
): Promise<{ request: DeletionRequest; runs: DeletionExecutionRun[] }> => {
  const { data } = await api.get<DeletionRequestResponse>(
    `/admin/deletion-requests/${requestId}`,
  );
  return { request: data.request, runs: data.runs ?? [] };
};

export const approveDeletionRequest = async (
  requestId: string,
  reviewNotes?: string,
): Promise<DeletionRequest> => {
  const { data } = await api.post<DeletionRequestResponse>(
    `/admin/deletion-requests/${requestId}/approve`,
    { reviewNotes },
  );
  return data.request;
};

export const rejectDeletionRequest = async (
  requestId: string,
  reviewNotes?: string,
): Promise<DeletionRequest> => {
  const { data } = await api.post<DeletionRequestResponse>(
    `/admin/deletion-requests/${requestId}/reject`,
    { reviewNotes },
  );
  return data.request;
};

export const executeDeletionRequest = async (
  requestId: string,
): Promise<{ request: DeletionRequest; run: DeletionExecutionRun }> => {
  const { data } = await api.post<DeletionExecuteResponse>(
    `/admin/deletion-requests/${requestId}/execute`,
  );
  return { request: data.request, run: data.run };
};

export const retryDeletionRequest = async (
  requestId: string,
): Promise<{ request: DeletionRequest; run: DeletionExecutionRun }> => {
  const { data } = await api.post<DeletionExecuteResponse>(
    `/admin/deletion-requests/${requestId}/retry`,
  );
  return { request: data.request, run: data.run };
};

// ── Org-wide compliance ────────────────────────────────

interface OrgComplianceSummaryResponse {
  success: boolean;
  summary: OrgComplianceSummary;
}

interface OrgComplianceRosterResponse {
  success: boolean;
  summary: OrgComplianceSummary;
  students: OrgComplianceRosterData['students'];
}

interface OrgGuardianPacketsResponse {
  success: boolean;
  packets: GuardianConsentPacket[];
  statusCounts: Record<string, number>;
  totalCount: number;
}

export const getOrgComplianceSummary = async (): Promise<OrgComplianceSummary> => {
  const { data } = await api.get<OrgComplianceSummaryResponse>(
    '/admin/compliance/summary',
  );
  return data.summary;
};

export const getOrgComplianceRoster = async (params?: {
  consentStatus?: string;
  classId?: string;
  search?: string;
}): Promise<OrgComplianceRosterData> => {
  const { data } = await api.get<OrgComplianceRosterResponse>(
    '/admin/compliance/roster',
    { params },
  );
  return { summary: data.summary, students: data.students };
};

export const getOrgGuardianPackets = async (
  statusFilter?: string,
): Promise<OrgGuardianPacketsData> => {
  const params = statusFilter ? { status: statusFilter } : {};
  const { data } = await api.get<OrgGuardianPacketsResponse>(
    '/admin/compliance/guardian-packets',
    { params },
  );
  return {
    packets: data.packets,
    statusCounts: data.statusCounts,
    totalCount: data.totalCount,
  };
};

export const exportOrgComplianceAudit = async (): Promise<Blob> => {
  const response = await api.get('/admin/compliance/audit-export', {
    responseType: 'blob',
  });
  return response.data as Blob;
};

interface BulkUpdateOrgCompliancePayload {
  studentUids: string[];
  updates: UpdateStudentCompliancePayload;
  reason?: string;
}

interface BulkUpdateOrgComplianceResponse {
  success: boolean;
  batchId: string;
  updatedCount: number;
  studentUids: string[];
}

export const bulkUpdateOrgCompliance = async (
  payload: BulkUpdateOrgCompliancePayload,
): Promise<BulkUpdateOrgComplianceResponse> => {
  const { data } = await api.put<BulkUpdateOrgComplianceResponse>(
    '/admin/compliance/bulk-update',
    payload,
  );
  return data;
};
