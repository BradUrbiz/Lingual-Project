import api from './index';
import type { UserProfile, ProfileFormData, Language, Gender, Rigor, FrequencyUnit } from '../types';

export interface ProfileResponse {
  profile_completed: boolean;
  assessed: boolean;
  display_name?: string;
  age?: number;
  gender?: string;
  rigor?: string;
  frequency?: number;
  frequency_unit?: string;
  level_objective?: string;
  global_stage?: number;
  sklc_level?: string;
  sklc_description?: string;
  domain_bands?: {
    grammar: number;
    vocabulary: number;
    pragmatics: number;
    pronunciation: number;
  };
  selected_categories?: string[];
}

export const getUserProfile = async (): Promise<UserProfile> => {
  const response = await api.get<ProfileResponse>('/user/profile');
  const data = response.data;

  return {
    profileCompleted: data.profile_completed,
    assessed: data.assessed,
    displayName: data.display_name,
    age: data.age,
    gender: data.gender as Gender | undefined,
    rigor: data.rigor as Rigor | undefined,
    frequency: data.frequency,
    frequencyUnit: data.frequency_unit as FrequencyUnit | undefined,
    levelObjective: data.level_objective,
    globalStage: data.global_stage,
    sklcLevel: data.sklc_level,
    sklcDescription: data.sklc_description,
    domainBands: data.domain_bands,
    selectedCategories: data.selected_categories,
  };
};

export const updateProfile = async (profile: ProfileFormData, isEdit = false): Promise<void> => {
  await api.post('/profile', {
    displayName: profile.displayName,
    age: profile.age,
    gender: profile.gender,
    rigor: profile.rigor,
    frequency: profile.frequency,
    frequencyUnit: profile.frequencyUnit,
    levelObjective: profile.levelObjective,
    isEdit,
  });
};

export const setLanguage = async (language: Language): Promise<void> => {
  await api.post('/set-language', { language });
};
