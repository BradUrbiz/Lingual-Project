import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PostTaskReviewPanel } from './PostTaskReviewPanel';

vi.mock('@/api/coachReview', () => ({
  getCoachReview: vi.fn(),
}));

import { getCoachReview } from '@/api/coachReview';

describe('PostTaskReviewPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a loading state while fetching', () => {
    (getCoachReview as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(<PostTaskReviewPanel sessionId="s1" />);
    expect(screen.getByText(/generating your review/i)).toBeInTheDocument();
  });

  it('renders wins and work-on items', async () => {
    (getCoachReview as ReturnType<typeof vi.fn>).mockResolvedValue({
      generated_at: 'now', model: 'gpt-5.4-mini-2026-03-17', surface: 'voice',
      wins: [{ text: 'Great past tense.' }],
      work_on: [{ utterance: 'Yo va', better: 'Yo voy', why: 'irregular', target: 'focus_grammar:ir', confidence_caveat: false }],
      target_coverage: [{ surface: 'expression:ordering', status: 'attempted' }],
    });
    render(<PostTaskReviewPanel sessionId="s1" />);
    await waitFor(() => expect(screen.getByText('Great past tense.')).toBeInTheDocument());
    expect(screen.getByText('Yo va')).toBeInTheDocument();
    expect(screen.getByText('Yo voy')).toBeInTheDocument();
  });

  it('renders an empty state when the review is null', async () => {
    (getCoachReview as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    render(<PostTaskReviewPanel sessionId="s1" />);
    await waitFor(() => expect(screen.getByText(/no review available/i)).toBeInTheDocument());
  });
});
