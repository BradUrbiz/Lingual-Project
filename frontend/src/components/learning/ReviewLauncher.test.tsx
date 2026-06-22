import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ReviewLauncher } from './ReviewLauncher';

vi.mock('@/api/coachReview', () => ({ getCoachReview: vi.fn().mockReturnValue(new Promise(() => {})) }));

describe('ReviewLauncher', () => {
  it('renders nothing without a session', () => {
    const { container } = render(<ReviewLauncher sessionId={null} canReview label="See your review" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while not reviewable (mid-save / not ended)', () => {
    const { container } = render(<ReviewLauncher sessionId="s1" canReview={false} label="See your review" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens the panel on click', () => {
    render(<ReviewLauncher sessionId="s1" canReview label="See your review" />);
    fireEvent.click(screen.getByText('See your review'));
    expect(screen.getByText(/generating your review/i)).toBeInTheDocument();
  });
});
