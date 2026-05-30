import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EmailVerificationGate } from './EmailVerificationGate';

const confirmMock = vi.fn();
const resendMock = vi.fn();

vi.mock('@/api/auth', () => ({
  confirmEmailVerification: (...a: unknown[]) => confirmMock(...a),
  resendEmailVerification: (...a: unknown[]) => resendMock(...a),
}));

describe('EmailVerificationGate', () => {
  beforeEach(() => {
    confirmMock.mockReset();
    resendMock.mockReset();
  });

  it('shows the target email', () => {
    render(<EmailVerificationGate email="a@b.test" onVerified={vi.fn()} onSignOut={vi.fn()} />);
    expect(screen.getByText(/a@b\.test/)).toBeInTheDocument();
  });

  it('calls onVerified after a correct code', async () => {
    confirmMock.mockResolvedValueOnce({ success: true });
    const onVerified = vi.fn();
    render(<EmailVerificationGate email="a@b.test" onVerified={onVerified} onSignOut={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));
    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith('123456');
      expect(onVerified).toHaveBeenCalledTimes(1);
    });
  });

  it('shows an error message on an invalid code', async () => {
    confirmMock.mockResolvedValueOnce({ success: false, error: 'invalid_code' });
    render(<EmailVerificationGate email="a@b.test" onVerified={vi.fn()} onSignOut={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/isn't right|not right/i);
    });
  });

  it('calls onSignOut from the escape link', () => {
    const onSignOut = vi.fn();
    render(<EmailVerificationGate email="a@b.test" onVerified={vi.fn()} onSignOut={onSignOut} />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('disables resend with a countdown after resending', async () => {
    resendMock.mockResolvedValueOnce({ success: true, cooldownSeconds: 60 });
    render(<EmailVerificationGate email="a@b.test" onVerified={vi.fn()} onSignOut={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /resend/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /resend/i })).toBeDisabled();
    });
  });
});
