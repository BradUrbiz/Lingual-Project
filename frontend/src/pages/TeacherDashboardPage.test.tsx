import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MembershipProvider } from '@/contexts/MembershipContext';
import { TeacherDashboardPage } from '@/pages/TeacherDashboardPage';
import type { TeacherDashboardData } from '@/types';

const navigateMock = vi.fn();
const getTeacherDashboardMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@/api/teacher', () => ({
  getTeacherDashboard: (...args: unknown[]) => getTeacherDashboardMock(...args),
  createTeacherClass: vi.fn(),
  generateClassJoinCode: vi.fn(),
  getClassJoinCode: vi.fn(),
  deactivateClassJoinCode: vi.fn(),
  getClassRoster: vi.fn(),
  removeStudentFromClass: vi.fn(),
}));

vi.mock('@/api/schools', () => ({}));

const authState: {
  user: {
    uid: string;
    email: string;
    name: string;
    memberships?: Array<{
      id: string;
      orgId: string;
      orgName: string;
      roles: Array<'teacher' | 'student' | 'school_admin'>;
      status: string;
    }>;
    activeMembershipId?: string | null;
    activeOrganizationId?: string | null;
    activeRoles?: Array<'teacher' | 'student' | 'school_admin'>;
  } | null;
} = {
  user: null,
};

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: authState.user,
  }),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    lang: 'en',
    t: (key: string) => key,
  }),
}));

function renderWithProviders() {
  return render(
    <MemoryRouter initialEntries={['/app/teacher']}>
      <MembershipProvider>
        <TeacherDashboardPage />
      </MembershipProvider>
    </MemoryRouter>
  );
}

const DASHBOARD: TeacherDashboardData = {
  organizationName: 'Lingual Academy',
  summary: {
    classCount: 2,
    studentCount: 15,
    speakingMinutes: 42,
    assignmentCount: 5,
  },
  classes: [
    {
      id: 'class-1',
      name: 'French 2 - Period 3',
      subject: 'French',
      term: 'Spring 2026',
      learningLocale: 'fr-FR',
      gradeBand: '10-11',
      status: 'active',
      studentCount: 10,
      assignmentCount: 3,
    },
    {
      id: 'class-2',
      name: 'Korean 1 - Period 5',
      subject: 'Korean',
      term: 'Spring 2026',
      learningLocale: 'ko-KR',
      gradeBand: '9-10',
      status: 'active',
      studentCount: 5,
      assignmentCount: 2,
    },
  ],
  setupChecklist: [
    {
      id: 'create-school',
      title: 'Create school workspace',
      description: 'Bootstrap an organization record.',
      completed: true,
    },
    {
      id: 'create-class',
      title: 'Create first class',
      description: 'Attach a class to the organization.',
      completed: true,
    },
    {
      id: 'enroll-student',
      title: 'Enroll first student',
      description: 'A student joins via join code.',
      completed: false,
    },
  ],
  alerts: [],
};

describe('TeacherDashboardPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    getTeacherDashboardMock.mockReset();

    authState.user = {
      uid: 'teacher-1',
      email: 'teacher@example.com',
      name: 'Teacher User',
      activeMembershipId: 'mem-teacher',
      memberships: [
        {
          id: 'mem-teacher',
          orgId: 'org-1',
          orgName: 'Lingual Academy',
          roles: ['teacher'],
          status: 'active',
        },
      ],
    };

    getTeacherDashboardMock.mockResolvedValue(DASHBOARD);
  });

  it('renders the dashboard with org name and summary stats', async () => {
    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText('Lingual Academy')).toBeInTheDocument();
    });

    // The stat cards each render a large number (text-3xl) and a label (text-sm).
    // Some labels like "Classes" and "Assignments" also appear as section headings
    // elsewhere, so we use getAllByText and verify via the stat card DOM structure.
    const allStatCards = document.querySelectorAll('.text-3xl.font-display.font-bold');
    const statValues = Array.from(allStatCards).map((el) => el.textContent);
    expect(statValues).toContain('2');   // classCount
    expect(statValues).toContain('15');  // studentCount
    expect(statValues).toContain('42');  // speakingMinutes
    expect(statValues).toContain('5');   // assignmentCount

    // Stat labels also appear in class cards, so use getAllByText for all.
    expect(screen.getAllByText('Students').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Speaking minutes')).toBeInTheDocument();
    expect(screen.getAllByText('Classes').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Assignments').length).toBeGreaterThanOrEqual(1);
  });

  it('shows both classes in the class list', async () => {
    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText('Lingual Academy')).toBeInTheDocument();
    });

    // Class names appear both in the class cards and in the filter dropdown
    // when there are 2+ classes, so we use getAllByText.
    expect(screen.getAllByText('French 2 - Period 3').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Korean 1 - Period 5').length).toBeGreaterThanOrEqual(1);
  });

  it('shows onboarding hint when there are classes but no students', async () => {
    getTeacherDashboardMock.mockResolvedValue({
      ...DASHBOARD,
      summary: {
        ...DASHBOARD.summary,
        studentCount: 0,
      },
      classes: [
        {
          ...DASHBOARD.classes[0],
          studentCount: 0,
        },
      ],
    });

    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText('Lingual Academy')).toBeInTheDocument();
    });

    expect(
      screen.getByText('Invite students to your class using a join code.')
    ).toBeInTheDocument();
  });

  it('shows setup checklist items', async () => {
    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText('Lingual Academy')).toBeInTheDocument();
    });

    expect(screen.getByText('Setup checklist')).toBeInTheDocument();
    expect(screen.getByText('Create school workspace')).toBeInTheDocument();
    expect(screen.getByText('Bootstrap an organization record.')).toBeInTheDocument();
    expect(screen.getByText('Create first class')).toBeInTheDocument();
    expect(screen.getByText('Enroll first student')).toBeInTheDocument();
    expect(screen.getByText('A student joins via join code.')).toBeInTheDocument();
  });
});
