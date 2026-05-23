import api from './index';
import type { TargetLanguageIntensity } from '@/types/assignment';

export interface CanvasPracticeSuggestions {
  scenario: string;
  targetExpressions: string[];
  targetVocabulary: string[];
  focusGrammar: string[];
  successCriteria: string[];
  suggestedTitle: string;
  suggestedDescription: string;
  teacherNotes: string;
  // Optional — the backend may or may not return suggested learning objectives
  // alongside the other fields. Teachers can still author objectives manually.
  objectives?: string[];
}

export interface CanvasItemContext {
  id: string;
  title: string;
  type: string;
  moduleName: string;
  canvasItemId: string;
}

export interface GenerateResponse {
  success: boolean;
  canvasItem: CanvasItemContext;
  suggestions: CanvasPracticeSuggestions;
  error?: string;
}

export interface CreateCanvasPracticePayload {
  canvasContentId: string;
  canvasModuleItemId: string;
  title: string;
  description: string;
  scenario: string;
  targetExpressions: string[];
  targetVocabulary: string[];
  focusGrammar: string[];
  successCriteria: string[];
  objectives: string[];
  teacherNotes: string;
  targetLanguageIntensity: TargetLanguageIntensity;
  status: 'draft' | 'published';
}

export const generateCanvasPractice = async (
  classId: string,
  canvasContentId: string,
): Promise<GenerateResponse> => {
  const response = await api.post<GenerateResponse>(
    `/teacher/classes/${classId}/canvas-practice/generate`,
    { canvasContentId },
  );
  return response.data;
};

export interface CreateCanvasPracticeResult {
  success: boolean;
  assignmentId: string;
  status: string;
  error?: string;
}

export const createCanvasPractice = async (
  classId: string,
  payload: CreateCanvasPracticePayload,
): Promise<CreateCanvasPracticeResult> => {
  const response = await api.post<CreateCanvasPracticeResult>(
    `/teacher/classes/${classId}/canvas-practice/create`,
    payload,
  );
  return response.data;
};
