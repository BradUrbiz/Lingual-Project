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

export interface Resteer {
  turn_index: number;
  surface: 'voice' | 'text';
  resteer: true;
  resteer_prompt: string;
  kind: string;
  target: string;
  reason: string;
  generated_at: string;
}

export interface CoachChipResult {
  chip: CoachChip | null;
  resteer: Resteer | null;
}

export const postCoachChip = async (
  sessionId: string,
  turnIndex: number,
): Promise<CoachChipResult> => {
  const response = await api.post<{ success: boolean; coachChip: CoachChip | null; resteer: Resteer | null }>(
    `/practice-sessions/${sessionId}/coach-chip`,
    { turnIndex },
  );
  return { chip: response.data.coachChip ?? null, resteer: response.data.resteer ?? null };
};

export const getCoachChips = async (sessionId: string): Promise<CoachChip[]> => {
  const response = await api.get<{ success: boolean; coachChips: CoachChip[] }>(
    `/practice-sessions/${sessionId}/coach-chips`,
  );
  return response.data.coachChips ?? [];
};
