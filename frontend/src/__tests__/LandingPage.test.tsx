import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LandingPage } from '@/pages/LandingPage';

let navigateMock = vi.fn();
const getUserProfileMock = vi.fn();
const authState: {
  user:
    | {
        uid: string;
        email: string;
        name: string;
        activeRoles?: Array<'teacher' | 'student' | 'school_admin'>;
        memberships?: Array<{
          id: string;
          orgId: string;
          orgName: string;
          roles: Array<'teacher' | 'student' | 'school_admin'>;
        }>;
      }
    | null;
  loading: boolean;
} = {
  user: null,
  loading: false,
};

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => authState,
}));

vi.mock('@/api/user', () => ({
  getUserProfile: (...args: unknown[]) => getUserProfileMock(...args),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) =>
      ({
        'landing.nav.features': 'Features',
        'landing.hero.ctaPrimary': 'Try Demo',
        'landing.nav.getStarted': 'Get Started',
      })[key] || key,
  }),
}));

describe('LandingPage', () => {
  beforeEach(() => {
    navigateMock = vi.fn();
    getUserProfileMock.mockReset();
    authState.user = null;
    authState.loading = false;
    window.scrollTo = vi.fn();
  });

  it('renders hero and routes unauthenticated users to auth', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Features')).toBeInTheDocument();

    const cta = screen.getByRole('button', { name: 'Try Demo' });
    fireEvent.click(cta);

    expect(navigateMock).toHaveBeenCalledWith('/auth');
  });

  it('routes assessed users to /app/learn', async () => {
    authState.user = { uid: '1', email: 'test@example.com', name: 'Test User' };
    getUserProfileMock.mockResolvedValue({
      profileCompleted: true,
      assessed: true,
    });

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try Demo' }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/app/learn');
    });
  });

  it('routes teacher users to /app/teacher from the login action', () => {
    authState.user = {
      uid: 'teacher-1',
      email: 'teacher@example.com',
      name: 'Teacher User',
      memberships: [
        {
          id: 'mem-teacher-1',
          orgId: 'org-1',
          orgName: 'Lingual Academy',
          roles: ['teacher'],
        },
      ],
    };

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'landing.nav.login' }));

    expect(navigateMock).toHaveBeenCalledWith('/app/teacher');
  });

  it('routes teacher users to /app/teacher from get started', async () => {
    authState.user = {
      uid: 'teacher-1',
      email: 'teacher@example.com',
      name: 'Teacher User',
      memberships: [
        {
          id: 'mem-teacher-1',
          orgId: 'org-1',
          orgName: 'Lingual Academy',
          roles: ['teacher'],
        },
      ],
    };

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try Demo' }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/app/teacher');
    });
  });

  it('routes unassessed users to /onboarding', async () => {
    authState.user = { uid: '1', email: 'test@example.com', name: 'Test User' };
    getUserProfileMock.mockResolvedValue({
      profileCompleted: true,
      assessed: false,
    });

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try Demo' }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/onboarding');
    });
  });

  it('routes incomplete profiles to /general', async () => {
    authState.user = { uid: '1', email: 'test@example.com', name: 'Test User' };
    getUserProfileMock.mockResolvedValue({
      profileCompleted: false,
      assessed: false,
    });

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try Demo' }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/general');
    });
  });
});
