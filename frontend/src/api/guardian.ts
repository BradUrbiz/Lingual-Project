import axios from 'axios';
import api from './index';
import type { GuardianConsentDecisionResult, GuardianConsentPublicView } from '@/types';

interface GuardianConsentPublicResponse {
  success: boolean;
  error?: string;
  guardianConsent: GuardianConsentPublicView;
}

interface GuardianConsentDecisionResponse {
  success: boolean;
  error?: string;
  guardianConsent: GuardianConsentPublicView;
  guardianPacket: GuardianConsentDecisionResult['guardianPacket'];
  compliance: GuardianConsentDecisionResult['compliance'];
}

function extractGuardianError(
  error: unknown,
  fallbackMessage: string,
) {
  if (axios.isAxiosError<GuardianConsentPublicResponse | GuardianConsentDecisionResponse>(error)) {
    return error.response?.data?.error || fallbackMessage;
  }
  return error instanceof Error ? error.message : fallbackMessage;
}

export const getGuardianConsentPacket = async (token: string): Promise<GuardianConsentPublicView> => {
  try {
    const response = await api.get<GuardianConsentPublicResponse>(`/guardian/consent/${token}`);
    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to load guardian consent notice.');
    }
    return response.data.guardianConsent;
  } catch (error) {
    throw new Error(extractGuardianError(error, 'Failed to load guardian consent notice.'));
  }
};

export const submitGuardianConsentDecision = async (
  token: string,
  payload: { decision: 'granted' | 'revoked'; acknowledged: boolean },
): Promise<GuardianConsentDecisionResult> => {
  try {
    const response = await api.post<GuardianConsentDecisionResponse>(
      `/guardian/consent/${token}/decision`,
      payload,
    );
    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to record guardian decision.');
    }
    return {
      guardianConsent: response.data.guardianConsent,
      guardianPacket: response.data.guardianPacket,
      compliance: response.data.compliance,
    };
  } catch (error) {
    throw new Error(extractGuardianError(error, 'Failed to record guardian decision.'));
  }
};
