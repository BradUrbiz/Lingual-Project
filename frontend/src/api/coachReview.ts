import api from '@/api';

export interface CoachReviewWin {
  text: string;
}

export interface CoachReviewItem {
  utterance: string;
  better: string;
  why: string;
  target: string | null;
  confidence_caveat: boolean;
}

export interface CoachReviewTargetCoverage {
  surface: string;
  status: 'used' | 'attempted' | 'not_attempted';
}

export interface CoachReview {
  generated_at: string;
  model: string;
  surface: 'voice' | 'text';
  wins: CoachReviewWin[];
  work_on: CoachReviewItem[];
  target_coverage: CoachReviewTargetCoverage[];
}

export const getCoachReview = async (sessionId: string): Promise<CoachReview | null> => {
  const response = await api.get<{ success: boolean; coachReview: CoachReview | null }>(
    `/practice-sessions/${sessionId}/coach-review`,
  );
  return response.data.coachReview;
};
