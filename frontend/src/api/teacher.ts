import axios from 'axios';
import api from './index';
import type {
  BulkUpdateClassCompliancePayload,
  BulkUpdateClassComplianceResult,
  ClassComplianceRosterData,
  ClassAnalyticsData,
  CreateTeacherClassPayload,
  GuardianConsentIssueResult,
  GuardianConsentPacket,
  IssueGuardianConsentPacketPayload,
  StudentDrillDownData,
  StudentComplianceRecord,
  TeacherClassSummary,
  TeacherDashboardData,
  UpdateStudentCompliancePayload,
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

interface StudentComplianceResponse {
  success: boolean;
  compliance: StudentComplianceRecord;
  guardianPacket?: GuardianConsentPacket | null;
}

interface ClassComplianceRosterResponse {
  success: boolean;
  roster: ClassComplianceRosterData;
}

interface BulkUpdateClassComplianceResponse {
  success: boolean;
  batchId: string;
  updatedCount: number;
  studentUids: string[];
}

interface GuardianPacketResponse {
  success: boolean;
  error?: string;
  guardianPacket: GuardianConsentPacket | null;
  deliveryToken?: string;
}

function extractTeacherApiError(error: unknown, fallbackMessage: string) {
  if (axios.isAxiosError<GuardianPacketResponse>(error)) {
    return error.response?.data?.error || fallbackMessage;
  }
  return error instanceof Error ? error.message : fallbackMessage;
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

export const getStudentCompliance = async (
  classId: string,
  studentUid: string,
): Promise<StudentComplianceRecord> => {
  const response = await api.get<StudentComplianceResponse>(
    `/teacher/classes/${classId}/students/${studentUid}/compliance`,
  );
  return response.data.compliance;
};

export const updateStudentCompliance = async (
  classId: string,
  studentUid: string,
  payload: UpdateStudentCompliancePayload,
): Promise<StudentComplianceRecord> => {
  const response = await api.put<StudentComplianceResponse>(
    `/teacher/classes/${classId}/students/${studentUid}/compliance`,
    payload,
  );
  return response.data.compliance;
};

export const getClassComplianceRoster = async (classId: string): Promise<ClassComplianceRosterData> => {
  const response = await api.get<ClassComplianceRosterResponse>(`/teacher/classes/${classId}/compliance`);
  return response.data.roster;
};

export const bulkUpdateClassCompliance = async (
  classId: string,
  payload: BulkUpdateClassCompliancePayload,
): Promise<BulkUpdateClassComplianceResult> => {
  const response = await api.put<BulkUpdateClassComplianceResponse>(
    `/teacher/classes/${classId}/compliance/bulk`,
    payload,
  );
  return {
    batchId: response.data.batchId,
    updatedCount: response.data.updatedCount,
    studentUids: response.data.studentUids,
  };
};

export const downloadClassComplianceAuditExport = async (classId: string): Promise<void> => {
  const response = await api.get<Blob>(`/teacher/classes/${classId}/compliance/audit-export`, {
    responseType: 'blob',
  });
  const downloadUrl = window.URL.createObjectURL(response.data);
  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = `${classId}-consent-audit-export.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(downloadUrl);
};

export const getStudentGuardianConsentPacket = async (
  classId: string,
  studentUid: string,
): Promise<GuardianConsentPacket | null> => {
  try {
    const response = await api.get<GuardianPacketResponse>(
      `/teacher/classes/${classId}/students/${studentUid}/guardian-consent-packet`,
    );
    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to load guardian packet.');
    }
    return response.data.guardianPacket;
  } catch (error) {
    throw new Error(extractTeacherApiError(error, 'Failed to load guardian packet.'));
  }
};

export const issueStudentGuardianConsentPacket = async (
  classId: string,
  studentUid: string,
  payload: IssueGuardianConsentPacketPayload,
): Promise<GuardianConsentIssueResult> => {
  try {
    const response = await api.post<GuardianPacketResponse>(
      `/teacher/classes/${classId}/students/${studentUid}/guardian-consent-packets`,
      payload,
    );
    if (!response.data.success || !response.data.guardianPacket) {
      throw new Error(response.data.error || 'Failed to issue guardian packet.');
    }
    return {
      guardianPacket: response.data.guardianPacket,
      deliveryToken: response.data.deliveryToken,
    };
  } catch (error) {
    throw new Error(extractTeacherApiError(error, 'Failed to issue guardian packet.'));
  }
};

export const resendStudentGuardianConsentPacket = async (
  classId: string,
  studentUid: string,
  packetId: string,
): Promise<GuardianConsentIssueResult> => {
  try {
    const response = await api.post<GuardianPacketResponse>(
      `/teacher/classes/${classId}/students/${studentUid}/guardian-consent-packets/${packetId}/resend`,
    );
    if (!response.data.success || !response.data.guardianPacket) {
      throw new Error(response.data.error || 'Failed to resend guardian packet.');
    }
    return {
      guardianPacket: response.data.guardianPacket,
      deliveryToken: response.data.deliveryToken,
    };
  } catch (error) {
    throw new Error(extractTeacherApiError(error, 'Failed to resend guardian packet.'));
  }
};

export const cancelStudentGuardianConsentPacket = async (
  classId: string,
  studentUid: string,
  packetId: string,
): Promise<GuardianConsentPacket> => {
  try {
    const response = await api.post<GuardianPacketResponse>(
      `/teacher/classes/${classId}/students/${studentUid}/guardian-consent-packets/${packetId}/cancel`,
    );
    if (!response.data.success || !response.data.guardianPacket) {
      throw new Error(response.data.error || 'Failed to cancel guardian packet.');
    }
    return response.data.guardianPacket;
  } catch (error) {
    throw new Error(extractTeacherApiError(error, 'Failed to cancel guardian packet.'));
  }
};
