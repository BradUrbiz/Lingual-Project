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
