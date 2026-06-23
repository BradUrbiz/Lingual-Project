import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AskPanel } from './AskPanel';
import { postAsk } from '@/api/ask';

vi.mock('@/api/ask');

const postAskMock = postAsk as ReturnType<typeof vi.fn>;

beforeEach(() => {
  postAskMock.mockReset();
});

describe('AskPanel', () => {
  it('submits a question and renders the scaffolded answer + the not-graded note', async () => {
    postAskMock.mockResolvedValue({ answer: "Try 'hola'.", kind: 'hint' });
    render(<AskPanel sessionId="sess-1" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'how do I say hi?' } });
    fireEvent.click(screen.getByRole('button', { name: /ask/i }));
    expect(await screen.findByText("Try 'hola'.")).toBeInTheDocument();
    expect(screen.getByText('how do I say hi?')).toBeInTheDocument();
    expect(screen.getByText(/scaffold/i)).toBeInTheDocument();
  });

  it('shows a soft message when the answer is null (fail-open)', async () => {
    postAskMock.mockResolvedValue(null);
    render(<AskPanel sessionId="sess-1" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /ask/i }));
    expect(await screen.findByText(/couldn't help/i)).toBeInTheDocument();
  });
});
