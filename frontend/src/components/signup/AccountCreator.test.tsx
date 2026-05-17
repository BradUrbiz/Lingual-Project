import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccountCreator } from './AccountCreator';

const signUpMock = vi.fn();
const googleMock = vi.fn();
const clearErrorMock = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    signUpWithEmail: (...args: unknown[]) => signUpMock(...args),
    signInWithGoogle: (...args: unknown[]) => googleMock(...args),
    error: null,
    clearError: clearErrorMock,
  }),
}));

describe('AccountCreator', () => {
  beforeEach(() => {
    signUpMock.mockReset();
    signUpMock.mockResolvedValue(undefined);
    googleMock.mockReset();
    googleMock.mockResolvedValue(undefined);
    clearErrorMock.mockReset();
  });

  it('forwards role and credentials on email submit', async () => {
    render(<AccountCreator intendedRole="teacher" onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'hunter22' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => {
      expect(signUpMock).toHaveBeenCalledWith('a@b.test', 'hunter22', { intendedRole: 'teacher' });
    });
  });

  it('forwards role on Google signup', async () => {
    render(<AccountCreator intendedRole="admin" onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    await waitFor(() => {
      expect(googleMock).toHaveBeenCalledWith({ intendedRole: 'admin' });
    });
  });

  it('invokes onSuccess after a successful Google signup', async () => {
    const onSuccess = vi.fn();
    render(<AccountCreator intendedRole="teacher" onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it('does not call onSuccess when Google signup throws', async () => {
    googleMock.mockRejectedValueOnce(new Error('popup-closed'));
    const onSuccess = vi.fn();
    render(<AccountCreator intendedRole="teacher" onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    await waitFor(() => {
      expect(googleMock).toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
    });
  });

  it('invokes onSuccess after a successful signup', async () => {
    const onSuccess = vi.fn();
    render(<AccountCreator intendedRole="student" onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'hunter22' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it('does not call onSuccess when the auth call throws', async () => {
    signUpMock.mockRejectedValueOnce(new Error('boom'));
    const onSuccess = vi.fn();
    render(<AccountCreator intendedRole="student" onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'hunter22' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => {
      expect(signUpMock).toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
    });
  });

  it('clears prior errors before submitting an email signup', async () => {
    render(<AccountCreator intendedRole="student" onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'hunter22' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => {
      expect(clearErrorMock).toHaveBeenCalled();
      expect(signUpMock).toHaveBeenCalled();
    });
  });

  it('clears prior errors before opening the Google popup', async () => {
    render(<AccountCreator intendedRole="student" onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    await waitFor(() => {
      expect(clearErrorMock).toHaveBeenCalled();
      expect(googleMock).toHaveBeenCalled();
    });
  });

  it('disables the Google button while an email signup is in-flight', async () => {
    // Never resolve so submitting stays true.
    let resolveSignUp: () => void = () => {};
    signUpMock.mockReturnValueOnce(new Promise<void>((resolve) => { resolveSignUp = resolve; }));

    render(<AccountCreator intendedRole="student" onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'hunter22' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /continue with google/i })).toBeDisabled();
    });

    resolveSignUp();
  });

  it('disables the submit button while a Google signup is in-flight', async () => {
    let resolveGoogle: () => void = () => {};
    googleMock.mockReturnValueOnce(new Promise<void>((resolve) => { resolveGoogle = resolve; }));

    render(<AccountCreator intendedRole="student" onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));

    // When loading=true, the Button primitive swaps children for a spinner + "Loading…" text,
    // so query by type="submit" instead of accessible name.
    await waitFor(() => {
      // eslint-disable-next-line testing-library/no-node-access
      const submit = document.querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(submit).toBeDisabled();
    });

    resolveGoogle();
  });
});
