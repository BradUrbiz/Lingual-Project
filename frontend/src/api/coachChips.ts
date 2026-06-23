import api from './index';

export interface CoachChip {
  turn_index: number;
  generated_at: string;
  model: string;
  surface: 'voice' | 'text';
  utterance: string;
  better: string;
  why: string;
  target: string | null;
  confidence_caveat: boolean;
}

export const postCoachChip = async (sessionId: string, turnIndex: number): Promise<CoachChip | null> => {
  const response = await api.post<{ success: boolean; coachChip: CoachChip | null }>(
    `/practice-sessions/${sessionId}/coach-chip`,
    { turnIndex },
  );
  return response.data.coachChip;
};
