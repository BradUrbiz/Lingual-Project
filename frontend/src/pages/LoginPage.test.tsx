import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LoginPage } from './LoginPage';
import type { User } from '@/types';

const navigateMock = vi.fn();
const signInWithEmailMock = vi.fn();
const signInWithGoogleMock = vi.fn();
const sendPasswordResetMock = vi.fn();
const clearErrorMock = vi.fn();
const authState: { user: User | null; loading: boolean; error: string | null } = {
  user: null,
  loading: false,
  error: null,
};
const locationState: { state: { from?: { pathname?: string } } | null } = {
  state: null,
};

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useLocation: () => locationState,
    Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
      <a href={typeof to === 'string' ? to : '#'} {...rest}>{children}</a>
    ),
  };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: authState.user,
    loading: authState.loading,
    error: authState.error,
    signInWithEmail: (...args: unknown[]) => signInWithEmailMock(...args),
    signInWithGoogle: (...args: unknown[]) => signInWithGoogleMock(...args),
    sendPasswordReset: (...args: unknown[]) => sendPasswordResetMock(...args),
    clearError: clearErrorMock,
  }),
}));

describe('LoginPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    signInWithEmailMock.mockReset().mockResolvedValue(undefined);
    signInWithGoogleMock.mockReset().mockResolvedValue(undefined);
    sendPasswordResetMock.mockReset().mockResolvedValue(undefined);
    clearErrorMock.mockReset();
    authState.user = null;
    authState.loading = false;
    authState.error = null;
    locationState.state = null;
  });

  it('signs in with email and password', async () => {
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'hunter22' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => {
      expect(signInWithEmailMock).toHaveBeenCalledWith('a@b.test', 'hunter22');
    });
  });

  it('opens the password reset view and sends a reset link', async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.test' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() => {
      expect(sendPasswordResetMock).toHaveBeenCalledWith('a@b.test');
    });
    expect(await screen.findByText(/password reset link has been sent/i)).toBeInTheDocument();
  });

  it('renders a link to /signup for users without an account', () => {
    render(<LoginPage />);
    const link = screen.getByRole('link', { name: /sign up/i });
    expect(link).toHaveAttribute('href', '/signup');
  });

  it('signs in with Google when the Google button is clicked', async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    await waitFor(() => {
      expect(signInWithGoogleMock).toHaveBeenCalledTimes(1);
    });
  });

  it('shows an error when the reset email fails to send', async () => {
    sendPasswordResetMock.mockRejectedValueOnce(new Error('Network error'));
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.test' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    expect(await screen.findByText(/network error/i)).toBeInTheDocument();
    expect(screen.queryByText(/reset link has been sent/i)).not.toBeInTheDocument();
  });

  it('keeps protected-route deep links paused while the legacy role modal is pending', () => {
    authState.user = {
      uid: 'legacy-1',
      email: 'legacy@example.test',
      name: 'Legacy User',
      requiresLegacyRolePick: true,
    };
    locationState.state = { from: { pathname: '/app/learn' } };

    render(<LoginPage />);

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('routes through onboarding dispatcher after a legacy role pick resolves', async () => {
    authState.user = {
      uid: 'legacy-1',
      email: 'legacy@example.test',
      name: 'Legacy User',
      requiresLegacyRolePick: true,
    };
    locationState.state = { from: { pathname: '/app/learn' } };

    const { rerender } = render(<LoginPage />);
    expect(navigateMock).not.toHaveBeenCalled();

    authState.user = {
      uid: 'legacy-1',
      email: 'legacy@example.test',
      name: 'Legacy User',
      requiresLegacyRolePick: false,
      intendedRole: 'teacher',
      onboardingState: 'role_selected',
    };
    rerender(<LoginPage />);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/signup/teacher/join-org', { replace: true });
    });
  });
});
