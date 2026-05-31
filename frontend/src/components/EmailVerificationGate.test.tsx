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

  it('surfaces a delivery failure while keeping the cooldown active', async () => {
    // Backend returns success:false / error:send_failed with the cooldown when a
    // fresh code was generated but delivery threw.
    resendMock.mockResolvedValueOnce({ success: false, error: 'send_failed', cooldownSeconds: 60 });
    render(<EmailVerificationGate email="a@b.test" onVerified={vi.fn()} onSignOut={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /resend/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/couldn't send|try again/i);
    });
    // Cooldown still ticking → resend stays disabled (not the "too many" path).
    expect(screen.getByRole('button', { name: /resend code/i })).toBeDisabled();
  });

  it('surfaces an error (not a silent re-enable) when the resend cap is hit', async () => {
    // Backend returns success:false with cooldownSeconds:0 when the cap is hit.
    resendMock.mockResolvedValueOnce({ success: false, error: 'cooldown', cooldownSeconds: 0 });
    render(<EmailVerificationGate email="a@b.test" onVerified={vi.fn()} onSignOut={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /resend/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/too many/i);
    });
    // Button is not stuck in a fake countdown.
    expect(screen.getByRole('button', { name: /^resend code$/i })).not.toBeDisabled();
  });
});
