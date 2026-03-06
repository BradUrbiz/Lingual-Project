import api from './index';
import type { AssessmentItem, AssessmentResults } from '../types';

export interface AssessmentItemsResponse {
  items: AssessmentItem[];
  totalItems: number;
  currentIndex: number;
  responses: Record<string, string>;
  title: string;
}

export interface SubmitResponse {
  success: boolean;
  nextIndex: number;
  isComplete: boolean;
}

export const getAssessmentItems = async (): Promise<AssessmentItemsResponse> => {
  const response = await api.get<AssessmentItemsResponse>('/assessment/items');
  return response.data;
};

export const submitAssessmentResponse = async (
  itemId: string,
  response: string
): Promise<SubmitResponse> => {
  const res = await api.post<SubmitResponse>('/assessment/submit', {
    itemId,
    response,
  });
  return res.data;
};

export const skipAssessmentQuestion = async (itemId: string): Promise<SubmitResponse> => {
  const response = await api.post<SubmitResponse>('/assessment/skip', { itemId });
  return response.data;
};

export const getAssessmentResults = async (): Promise<AssessmentResults> => {
  const response = await api.get<{
    success: boolean;
    framework?: string;
    results: {
      framework?: string;
      band_scale?: number;
      global_stage: number;
      domain_bands: Record<string, number>;
      proficiency_level?: string;
      proficiency_description_en?: string;
      actfl_level?: string;
      actfl_description_en?: string;
    };
    proficiencyLevel?: string;
    proficiencyDescription?: string;
    actflLevel?: string;
    actflDescription?: string;
    sklcLevel?: string;
    sklcDescription?: string;
  }>('/assessment/results');

  const proficiencyLevel =
    response.data.proficiencyLevel ||
    response.data.actflLevel ||
    response.data.results.proficiency_level ||
    response.data.results.actfl_level ||
    response.data.sklcLevel ||
    '';

  const proficiencyDescription =
    response.data.proficiencyDescription ||
    response.data.actflDescription ||
    response.data.results.proficiency_description_en ||
    response.data.results.actfl_description_en ||
    response.data.sklcDescription ||
    '';

  return {
    framework: response.data.framework || response.data.results.framework || 'ACTFL',
    bandScale: response.data.results.band_scale,
    globalStage: response.data.results.global_stage,
    domainBands: response.data.results.domain_bands,
    proficiencyLevel,
    proficiencyDescription,
    actflLevel: response.data.actflLevel || response.data.results.actfl_level || proficiencyLevel,
    actflDescription:
      response.data.actflDescription || response.data.results.actfl_description_en || proficiencyDescription,
    sklcLevel: response.data.sklcLevel || proficiencyLevel,
    sklcDescription: response.data.sklcDescription || proficiencyDescription,
  };
};

export const resetAssessment = async (): Promise<void> => {
  await api.post('/assessment/reset');
};

export const updateCategories = async (categories: string[]): Promise<void> => {
  await api.post('/categories', { categories });
};
