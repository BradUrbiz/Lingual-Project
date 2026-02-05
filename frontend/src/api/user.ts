import api from './index';
import type { UserProfile, ProfileFormData, LearningLocale, Language, Gender, Rigor, FrequencyUnit } from '../types';

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
  avatar_url?: string;
  contact_email?: string;
  grade_level?: string;
  native_language?: string;
  learning_locale?: string;
  location?: string;
  school_name?: string;
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
    avatarUrl: data.avatar_url,
    contactEmail: data.contact_email,
    gradeLevel: data.grade_level,
    nativeLanguage: data.native_language,
    learningLocale: data.learning_locale as LearningLocale | undefined,
    location: data.location,
    schoolName: data.school_name,
    globalStage: data.global_stage,
    sklcLevel: data.sklc_level,
    sklcDescription: data.sklc_description,
    domainBands: data.domain_bands,
    selectedCategories: data.selected_categories,
  };
};

export const updateProfile = async (profile: ProfileFormData, isEdit = false): Promise<void> => {
  const payload: Record<string, unknown> = {
    displayName: profile.displayName,
    age: profile.age,
    gender: profile.gender,
    rigor: profile.rigor,
    frequency: profile.frequency,
    frequencyUnit: profile.frequencyUnit,
    levelObjective: profile.levelObjective,
    isEdit,
  };

  if (profile.avatarUrl !== undefined) payload.avatarUrl = profile.avatarUrl;
  if (profile.contactEmail !== undefined) payload.contactEmail = profile.contactEmail;
  if (profile.gradeLevel !== undefined) payload.gradeLevel = profile.gradeLevel;
  if (profile.nativeLanguage !== undefined) payload.nativeLanguage = profile.nativeLanguage;
  if (profile.location !== undefined) payload.location = profile.location;
  if (profile.schoolName !== undefined) payload.schoolName = profile.schoolName;
  if (profile.learningLocale !== undefined) payload.learningLocale = profile.learningLocale;

  await api.post('/profile', payload);
};

export const setLanguage = async (language: Language): Promise<void> => {
  await api.post('/set-language', { language });
};
