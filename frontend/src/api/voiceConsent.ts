import api from './index';
import type { StudentComplianceRecord } from '@/types/school';

export type VoiceConsentDecision = 'granted' | 'revoked';

interface VoiceConsentResponse {
  success: boolean;
  compliance: StudentComplianceRecord;
  error?: string;
}

export async function submitVoiceConsent(
  status: VoiceConsentDecision,
): Promise<StudentComplianceRecord> {
  const response = await api.post<VoiceConsentResponse>('/student/voice-consent', { status });
  if (!response.data.success || !response.data.compliance) {
    throw new Error(response.data.error || 'Failed to update voice consent.');
  }
  return response.data.compliance;
}
