import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingHint } from './OnboardingHint';

describe('OnboardingHint', () => {
  const wrap = (ui: React.ReactNode) =>
    render(<MemoryRouter>{ui}</MemoryRouter>);

  it('renders nothing when show is false', () => {
    const { container } = wrap(
      <OnboardingHint show={false} message="Test" ctaLabel="Go" ctaTo="/test" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders banner with message and CTA when show is true', () => {
    wrap(
      <OnboardingHint show={true} message="Create your first class" ctaLabel="Create Class" ctaTo="/create" />
    );
    expect(screen.getByText('Create your first class')).toBeTruthy();
    expect(screen.getByText('Create Class')).toBeTruthy();
  });

  it('renders CTA as a link to ctaTo', () => {
    wrap(
      <OnboardingHint show={true} message="Test" ctaLabel="Go" ctaTo="/target" />
    );
    const link = screen.getByRole('link', { name: 'Go' });
    expect(link.getAttribute('href')).toBe('/target');
  });

  it('renders without CTA when ctaLabel is omitted', () => {
    wrap(
      <OnboardingHint show={true} message="Just info" />
    );
    expect(screen.getByText('Just info')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
