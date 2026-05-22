import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LegacyRoleMigrationModal } from './LegacyRoleMigrationModal';

describe('LegacyRoleMigrationModal', () => {
  it('renders the welcome copy from spec §628', () => {
    render(<LegacyRoleMigrationModal onPicked={vi.fn()} />);
    expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
    expect(screen.getByText(/lingual now supports classrooms/i)).toBeInTheDocument();
    expect(screen.getByText(/how are you using lingual/i)).toBeInTheDocument();
    expect(screen.getByText(/your existing progress stays with you/i)).toBeInTheDocument();
  });

  it('renders three role buttons', () => {
    render(<LegacyRoleMigrationModal onPicked={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^student$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^teacher$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /school administrator/i })).toBeInTheDocument();
  });

  it('calls onPicked with the chosen role', async () => {
    const onPicked = vi.fn().mockResolvedValue(undefined);
    render(<LegacyRoleMigrationModal onPicked={onPicked} />);
    fireEvent.click(screen.getByRole('button', { name: /^student$/i }));
    await waitFor(() => expect(onPicked).toHaveBeenCalledWith('student'));
  });

  it('disables all role buttons while a pick is pending', async () => {
    let resolve!: () => void;
    const onPicked = vi.fn(() => new Promise<void>(r => { resolve = r; }));
    render(<LegacyRoleMigrationModal onPicked={onPicked} />);
    fireEvent.click(screen.getByRole('button', { name: /^teacher$/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^student$/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /^teacher$/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /school administrator/i })).toBeDisabled();
    });
    resolve();
  });

  it('shows error message when the pick fails and re-enables buttons', async () => {
    const onPicked = vi.fn().mockRejectedValue(new Error('network down'));
    render(<LegacyRoleMigrationModal onPicked={onPicked} />);
    fireEvent.click(screen.getByRole('button', { name: /^student$/i }));
    await waitFor(() => screen.getByText(/network down/i));
    // After error, buttons should be re-enabled so the user can retry.
    expect(screen.getByRole('button', { name: /^student$/i })).not.toBeDisabled();
  });

  it('has no close button, X icon, or "cancel"/"close" labeled controls', () => {
    render(<LegacyRoleMigrationModal onPicked={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/close/i)).not.toBeInTheDocument();
  });
});
