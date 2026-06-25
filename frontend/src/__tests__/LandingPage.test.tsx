import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LandingPage } from '@/pages/LandingPage';

let navigateMock = vi.fn();
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

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) =>
      ({
        'landing.nav.features': 'Features',
        'landing.nav.getStarted': 'Get Started',
        'landing.nav.how': 'How it Works',
        'landing.nav.schools': 'For Schools',
        'landing.nav.login': 'Log In',
        'landing.hero.roleStudent': "I'm a Student",
        'landing.hero.roleTeacher': "I'm a Teacher",
        'landing.hero.roleAdmin': "I'm a School Admin",
      })[key] || key,
  }),
}));

describe('LandingPage', () => {
  beforeEach(() => {
    navigateMock = vi.fn();
    authState.user = null;
    authState.loading = false;
    window.scrollTo = vi.fn();
  });

  it('renders hero and routes unauthenticated users to /signup?role=student on "I\'m a Student"', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Features')).toBeInTheDocument();

    const cta = screen.getAllByRole('button', { name: "I'm a Student" })[0];
    fireEvent.click(cta);

    expect(navigateMock).toHaveBeenCalledWith('/signup?role=student');
  });

  it('routes unauthenticated users to /signup?role=teacher on "I\'m a Teacher"', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    const cta = screen.getByRole('button', { name: "I'm a Teacher" });
    fireEvent.click(cta);

    expect(navigateMock).toHaveBeenCalledWith('/signup?role=teacher');
  });

  it('routes unauthenticated users to /signup?role=admin on "I\'m a School Admin"', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    const cta = screen.getByRole('button', { name: "I'm a School Admin" });
    fireEvent.click(cta);

    expect(navigateMock).toHaveBeenCalledWith('/signup?role=admin');
  });

  it('routes unauthenticated users to /login on Login button', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Log In' }));

    expect(navigateMock).toHaveBeenCalledWith('/login');
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

    fireEvent.click(screen.getByRole('button', { name: 'Log In' }));

    expect(navigateMock).toHaveBeenCalledWith('/app/teacher');
  });

  it('routes signed-in teacher users to /app/teacher when clicking any role CTA', () => {
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

    // Membership is source of truth - clicking "I'm a Student" still routes to teacher home
    const cta = screen.getAllByRole('button', { name: "I'm a Student" })[0];
    fireEvent.click(cta);

    expect(navigateMock).toHaveBeenCalledWith('/app/teacher');
  });

  it('routes signed-in student membership users to /app/learn when clicking a role CTA', () => {
    authState.user = {
      uid: 'student-1',
      email: 'student@example.com',
      name: 'Student User',
      memberships: [
        {
          id: 'mem-student-1',
          orgId: 'org-1',
          orgName: 'Lingual Academy',
          roles: ['student'],
        },
      ],
    };

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    const cta = screen.getAllByRole('button', { name: "I'm a Student" })[0];
    fireEvent.click(cta);

    expect(navigateMock).toHaveBeenCalledWith('/app/learn');
  });
});
