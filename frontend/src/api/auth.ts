import api from './index';
import type { User } from '../types';

export type IntendedRole = 'student' | 'teacher' | 'admin';

export type AuthRoleOptions = { intendedRole?: IntendedRole };

export interface VerifyTokenResponse {
  success: boolean;
  user?: User;
  error?: string;
}

export const verifyToken = async (
  idToken: string,
  options: AuthRoleOptions = {},
): Promise<VerifyTokenResponse> => {
  const body: Record<string, unknown> = { idToken };
  if (options.intendedRole) {
    body.intended_role = options.intendedRole;
  }
  const response = await api.post<VerifyTokenResponse>('/auth/verify', body);
  return response.data;
};

export const logout = async (): Promise<void> => {
  await api.get('/logout');
};

export interface MigrateRoleResponse {
  intendedRole: IntendedRole | null;
  onboardingState: string | null;
}

export const migrateRole = async (role: IntendedRole): Promise<MigrateRoleResponse> => {
  const response = await api.post<MigrateRoleResponse>('/auth/migrate-role', { role });
  return response.data;
};

export interface EmailVerificationResponse {
  success: boolean;
  error?: string;
  cooldownSeconds?: number;
}

// validateStatus: () => true so 400/429 resolve (with the body) instead of
// throwing — the gate component reads `success`/`error` uniformly.
export const confirmEmailVerification = async (
  code: string,
): Promise<EmailVerificationResponse> => {
  const response = await api.post<EmailVerificationResponse>(
    '/auth/email-verification/confirm',
    { code },
    { validateStatus: () => true },
  );
  return response.data;
};

export const resendEmailVerification = async (): Promise<EmailVerificationResponse> => {
  const response = await api.post<EmailVerificationResponse>(
    '/auth/email-verification/resend',
    {},
    { validateStatus: () => true },
  );
  return response.data;
};
