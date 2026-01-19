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
    results: {
      global_stage: number;
      domain_bands: {
        grammar: number;
        vocabulary: number;
        pragmatics: number;
        pronunciation: number;
      };
    };
    sklcLevel: string;
    sklcDescription: string;
  }>('/assessment/results');

  return {
    globalStage: response.data.results.global_stage,
    domainBands: response.data.results.domain_bands,
    sklcLevel: response.data.sklcLevel,
    sklcDescription: response.data.sklcDescription,
  };
};

export const resetAssessment = async (): Promise<void> => {
  await api.post('/assessment/reset');
};

export const updateCategories = async (categories: string[]): Promise<void> => {
  await api.post('/categories', { categories });
};
