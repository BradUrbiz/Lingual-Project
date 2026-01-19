import api from './index';
import type { UserProfile, Language } from '../types';

export interface ProfileResponse {
  assessed: boolean;
  global_stage?: number;
  sklc_level?: string;
  sklc_description?: string;
  domain_bands?: {
    grammar: number;
    vocabulary: number;
    pragmatics: number;
    pronunciation: number;
  };
  goals?: string[];
}

export const getUserProfile = async (): Promise<UserProfile> => {
  const response = await api.get<ProfileResponse>('/user/profile');
  const data = response.data;

  return {
    assessed: data.assessed,
    globalStage: data.global_stage,
    sklcLevel: data.sklc_level,
    sklcDescription: data.sklc_description,
    domainBands: data.domain_bands,
    goals: data.goals,
  };
};

export const updateProfile = async (goals: string[], duration: number): Promise<void> => {
  await api.post('/profile', { goals, duration });
};

export const setLanguage = async (language: Language): Promise<void> => {
  await api.post('/set-language', { language });
};
