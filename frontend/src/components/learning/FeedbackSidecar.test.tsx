import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeedbackSidecar } from './FeedbackSidecar';
import type { CoachChip } from '@/api/coachChips';

const chip = (over: Partial<CoachChip> = {}): CoachChip => ({
  turn_index: 4, generated_at: 'x', model: 'm', surface: 'text',
  utterance: 'Yo va al tienda', better: 'Yo voy a la tienda', why: 'ir is irregular',
  target: null, confidence_caveat: false, ...over,
});

describe('FeedbackSidecar', () => {
  it('renders an empty state with no chips', () => {
    render(<FeedbackSidecar chips={[]} />);
    expect(screen.getByText(/no live feedback yet/i)).toBeInTheDocument();
  });

  it('renders each chip corrected form + utterance', () => {
    render(<FeedbackSidecar chips={[chip(), chip({ turn_index: 6, better: 'otra' })]} />);
    expect(screen.getByText('Yo voy a la tienda')).toBeInTheDocument();
    expect(screen.getByText('otra')).toBeInTheDocument();
  });
});
