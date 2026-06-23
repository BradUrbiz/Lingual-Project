import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConversationSidecar } from './ConversationSidecar';

vi.mock('@/api/ask');

describe('ConversationSidecar', () => {
  it('renders only Feedback when askModeEnabled is false (no Ask toggle)', () => {
    render(<ConversationSidecar chips={[]} sessionId="s" askModeEnabled={false} />);
    expect(screen.queryByRole('button', { name: /^ask$/i })).toBeNull();
    expect(screen.getByText(/no live feedback yet/i)).toBeInTheDocument();
  });

  it('shows the Feedback|Ask toggle and switches to AskPanel when askModeEnabled', () => {
    render(<ConversationSidecar chips={[]} sessionId="s" askModeEnabled />);
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));
    expect(screen.getByRole('textbox', { name: /ask for quick help/i })).toBeInTheDocument();
  });
});
