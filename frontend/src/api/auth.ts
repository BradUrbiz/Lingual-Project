import api from './index';
import type { User } from '../types';

export interface VerifyTokenResponse {
  success: boolean;
  user?: User;
  error?: string;
}

export const verifyToken = async (idToken: string): Promise<VerifyTokenResponse> => {
  const response = await api.post<VerifyTokenResponse>('/auth/verify', { idToken });
  return response.data;
};

export const logout = async (): Promise<void> => {
  await api.get('/logout');
};
