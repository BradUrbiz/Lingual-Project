import api from './index';
import type {
  UserProfile,
  ProfileFormData,
  LearningLocale,
  Language,
  Gender,
  Rigor,
  FrequencyUnit,
  AssessmentPreference,
} from '../types';

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
  assessment_preference?: AssessmentPreference;
  avatar_url?: string;
  contact_email?: string;
  grade_level?: string;
  native_language?: string;
  learning_locale?: string;
  location?: string;
  school_name?: string;
  global_stage?: number;
  framework?: string;
  proficiency_level?: string;
  proficiency_description?: string;
  actfl_level?: string;
  actfl_description?: string;
  sklc_level?: string;
  sklc_description?: string;
  domain_bands?: Record<string, number>;
  selected_categories?: string[];
}

export const getUserProfile = async (): Promise<UserProfile> => {
  const response = await api.get<ProfileResponse>('/user/profile');
  const data = response.data;

  const proficiencyLevel =
    data.proficiency_level ||
    data.actfl_level ||
    data.sklc_level;

  const proficiencyDescription =
    data.proficiency_description ||
    data.actfl_description ||
    data.sklc_description;

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
    assessmentPreference: data.assessment_preference,
    avatarUrl: data.avatar_url,
    contactEmail: data.contact_email,
    gradeLevel: data.grade_level,
    nativeLanguage: data.native_language,
    learningLocale: data.learning_locale as LearningLocale | undefined,
    location: data.location,
    schoolName: data.school_name,
    framework: data.framework || 'ACTFL',
    globalStage: data.global_stage,
    proficiencyLevel,
    proficiencyDescription,
    actflLevel: data.actfl_level || proficiencyLevel,
    actflDescription: data.actfl_description || proficiencyDescription,
    sklcLevel: data.sklc_level || proficiencyLevel,
    sklcDescription: data.sklc_description || proficiencyDescription,
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
    assessmentPreference: profile.assessmentPreference,
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

export const saveInitialOnboarding = async (
  learningLocale: LearningLocale,
  assessmentPreference: AssessmentPreference
): Promise<void> => {
  try {
    await api.post('/onboarding/initial', { learningLocale, assessmentPreference });
  } catch (error: unknown) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status !== 404 && status !== 405) {
      throw error;
    }

    // Backward-compatible fallback for backend versions without /api/onboarding/initial.
    await api.post('/profile', {
      learningLocale,
      assessmentPreference,
      isEdit: false,
    });
  }
};
