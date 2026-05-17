import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MembershipProvider } from '@/contexts/MembershipContext';
import { TeacherRoute } from '@/components/layout/TeacherRoute';

const authState: {
  user:
    | {
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
      }
    | null;
} = {
  user: null,
};

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: authState.user,
  }),
}));

describe('TeacherRoute', () => {
  beforeEach(() => {
    authState.user = null;
  });

  it('renders teacher-only content for teacher memberships', () => {
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

    render(
      <MemoryRouter initialEntries={['/app/teacher']}>
        <MembershipProvider>
          <Routes>
            <Route path="/app/learn" element={<div>Learn Page</div>} />
            <Route
              path="/app/teacher"
              element={
                <TeacherRoute>
                  <div>Teacher Dashboard</div>
                </TeacherRoute>
              }
            />
          </Routes>
        </MembershipProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('Teacher Dashboard')).toBeInTheDocument();
  });

  it('redirects non-teacher memberships to learn', () => {
    authState.user = {
      uid: 'student-1',
      email: 'student@example.com',
      name: 'Student User',
      activeMembershipId: 'mem-student',
      memberships: [
        {
          id: 'mem-student',
          orgId: 'org-1',
          orgName: 'Lingual Academy',
          roles: ['student'],
          status: 'active',
        },
      ],
    };

    render(
      <MemoryRouter initialEntries={['/app/teacher']}>
        <MembershipProvider>
          <Routes>
            <Route path="/app/learn" element={<div>Learn Page</div>} />
            <Route
              path="/app/teacher"
              element={
                <TeacherRoute>
                  <div>Teacher Dashboard</div>
                </TeacherRoute>
              }
            />
          </Routes>
        </MembershipProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('Learn Page')).toBeInTheDocument();
    expect(screen.queryByText('Teacher Dashboard')).not.toBeInTheDocument();
  });

  it('redirects users without memberships to teacher join-org', () => {
    authState.user = {
      uid: 'new-user',
      email: 'new@example.com',
      name: 'New User',
      memberships: [],
    };

    render(
      <MemoryRouter initialEntries={['/app/teacher']}>
        <MembershipProvider>
          <Routes>
            <Route path="/app/learn" element={<div>Learn Page</div>} />
            <Route path="/signup/teacher/join-org" element={<div>Teacher Join Org</div>} />
            <Route
              path="/app/teacher"
              element={
                <TeacherRoute>
                  <div>Teacher Dashboard</div>
                </TeacherRoute>
              }
            />
          </Routes>
        </MembershipProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('Teacher Join Org')).toBeInTheDocument();
    expect(screen.queryByText('Teacher Dashboard')).not.toBeInTheDocument();
  });
});
