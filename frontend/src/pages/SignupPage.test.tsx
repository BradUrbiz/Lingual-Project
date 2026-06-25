import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SignupPage } from './SignupPage';
import en from '@/i18n/en.json';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    lang: 'en',
    setLang: vi.fn(),
    t: (key: string) => (en as Record<string, string>)[key] ?? key,
  }),
}));

const navigateMock = vi.fn();
const signUpMock = vi.fn();
const googleMock = vi.fn();
let mockUser: unknown = null;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: mockUser,
    loading: false,
    error: null,
    signUpWithEmail: (...args: unknown[]) => signUpMock(...args),
    signInWithGoogle: (...args: unknown[]) => googleMock(...args),
    clearError: vi.fn(),
  }),
}));

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/signup" element={<SignupPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SignupPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    signUpMock.mockReset().mockResolvedValue(undefined);
    googleMock.mockReset().mockResolvedValue(undefined);
    mockUser = null;
  });

  it('starts at Step 1 (role picker) when no role query param', () => {
    renderAt('/signup');
    expect(screen.getByRole('radio', { name: /student/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create account/i })).not.toBeInTheDocument();
  });

  it('pre-selects role from ?role= and lets user continue to Step 2', () => {
    renderAt('/signup?role=teacher');
    expect(screen.getByRole('radio', { name: /teacher/i })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  it('disables Continue until a role is picked', () => {
    renderAt('/signup');
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /student/i }));
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });

  it('navigates back to Step 1 from Step 2 via the change-role link', () => {
    renderAt('/signup?role=student');
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    fireEvent.click(screen.getByRole('button', { name: /change role/i }));
    expect(screen.getByRole('radio', { name: /student/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create account/i })).not.toBeInTheDocument();
  });

  it('triggers signup with the picked role when Create account is clicked', async () => {
    renderAt('/signup?role=student');
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'hunter22' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => {
      expect(signUpMock).toHaveBeenCalledWith(
        'a@b.test',
        'hunter22',
        { intendedRole: 'student' },
      );
    });
  });

  it('navigates to the dispatcher destination once an authenticated user is present', () => {
    mockUser = {
      uid: 'u1',
      email: 'a@b.test',
      name: 'A',
      intendedRole: 'teacher',
      onboardingState: 'role_selected',
    };
    renderAt('/signup?role=teacher');
    expect(navigateMock).toHaveBeenCalledWith('/signup/teacher/join-org', { replace: true });
  });

  it('navigates to student setup after a successful signup updates the auth state', async () => {
    // Start with no user (pre-signup).
    mockUser = null;
    const { rerender } = renderAt('/signup?role=student');

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'hunter22' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(signUpMock).toHaveBeenCalled();
    });

    // Simulate AuthContext finishing /api/auth/verify and exposing the new user.
    mockUser = {
      uid: 'u1',
      email: 'a@b.test',
      name: 'A',
      intendedRole: 'student',
    };

    rerender(
      <MemoryRouter initialEntries={['/signup?role=student']}>
        <Routes>
          <Route path="/signup" element={<SignupPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/signup/student/setup', { replace: true });
    });
  });
});
