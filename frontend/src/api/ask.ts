import api from './index';

export interface AskAnswer {
  answer: string;
  kind: 'hint' | 'translation' | 'definition' | 'clarification' | 'phrase' | 'refusal';
}

export const postAsk = async (
  sessionId: string,
  question: string,
  turnIndex?: number | null,
): Promise<AskAnswer | null> => {
  const response = await api.post<{ success: boolean; ask: AskAnswer | null }>(
    `/practice-sessions/${sessionId}/ask`,
    { question, ...(turnIndex != null ? { turnIndex } : {}) },
  );
  return response.data.ask ?? null;
};
