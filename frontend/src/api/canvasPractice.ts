import api from './index';

export interface CanvasPracticeSuggestions {
  scenario: string;
  targetExpressions: string[];
  focusGrammar: string[];
  successCriteria: string[];
  taskType: string;
  suggestedTitle: string;
  suggestedDescription: string;
  teacherNotes: string;
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
  focusGrammar: string[];
  successCriteria: string[];
  taskType: string;
  teacherNotes: string;
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

export const createCanvasPractice = async (
  classId: string,
  payload: CreateCanvasPracticePayload,
): Promise<{ success: boolean; assignmentId: string; mappingId: string; status: string }> => {
  const response = await api.post(
    `/teacher/classes/${classId}/canvas-practice/create`,
    payload,
  );
  return response.data;
};
