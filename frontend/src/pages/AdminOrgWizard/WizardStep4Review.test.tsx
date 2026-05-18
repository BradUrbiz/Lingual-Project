import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WizardStep4Review } from './WizardStep4Review';

const baseState = {
  schoolName: 'SF Friends',
  websiteUrl: 'https://ssfs.org',
  schoolType: 'k12' as const,
  publicPrivate: 'private' as const,
  gradeSize: '50-100' as const,
  location: { country: 'US', state: 'CA' },
  adminIdentity: {
    fullName: 'Ada', schoolEmail: 'ada@ssfs.org',
    roleTitle: 'Principal', authorizationAttested: true,
  },
};

describe('WizardStep4Review', () => {
  it('summarizes Step 1 and Step 2 values', () => {
    render(
      <WizardStep4Review
        state={baseState}
        dispatch={vi.fn()}
        onSubmit={vi.fn()}
        submitting={false}
        submitError={null}
      />,
    );
    expect(screen.getByText('SF Friends')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Principal')).toBeInTheDocument();
  });

  it('clicking Edit dispatches GOTO_STEP', () => {
    const dispatch = vi.fn();
    render(
      <WizardStep4Review state={baseState} dispatch={dispatch}
                          onSubmit={vi.fn()} submitting={false} submitError={null} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /edit organization/i }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'GOTO_STEP', step: 1 });
  });

  it('adds pre-invite email when user presses Enter', () => {
    const dispatch = vi.fn();
    render(
      <WizardStep4Review state={baseState} dispatch={dispatch}
                          onSubmit={vi.fn()} submitting={false} submitError={null} />,
    );
    const input = screen.getByLabelText(/teacher email/i);
    fireEvent.change(input, { target: { value: 'newteacher@ssfs.org' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_PRE_INVITE_TEACHERS',
      emails: ['newteacher@ssfs.org'],
    });
  });

  it('calls onSubmit when the submit button is clicked', () => {
    const onSubmit = vi.fn();
    render(
      <WizardStep4Review state={baseState} dispatch={vi.fn()}
                          onSubmit={onSubmit} submitting={false} submitError={null} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /submit for lingual approval/i }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('disables submit while submitting', () => {
    render(
      <WizardStep4Review state={baseState} dispatch={vi.fn()}
                          onSubmit={vi.fn()} submitting submitError={null} />,
    );
    expect(screen.getByRole('button', { name: /submitting/i })).toBeDisabled();
  });

  it('shows submit error when provided', () => {
    render(
      <WizardStep4Review state={baseState} dispatch={vi.fn()}
                          onSubmit={vi.fn()} submitting={false}
                          submitError="Server is down" />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Server is down');
  });
});
