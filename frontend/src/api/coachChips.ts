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
  promote?: boolean;
  promote_prompt?: string;
  promote_reason?: 'repeat' | 'hard_target';
}

export const postCoachChip = async (sessionId: string, turnIndex: number): Promise<CoachChip | null> => {
  const response = await api.post<{ success: boolean; coachChip: CoachChip | null }>(
    `/practice-sessions/${sessionId}/coach-chip`,
    { turnIndex },
  );
  return response.data.coachChip;
};

export const getCoachChips = async (sessionId: string): Promise<CoachChip[]> => {
  const response = await api.get<{ success: boolean; coachChips: CoachChip[] }>(
    `/practice-sessions/${sessionId}/coach-chips`,
  );
  return response.data.coachChips ?? [];
};
