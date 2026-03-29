import { render, screen } from '@testing-library/react';
import { MembershipProvider, useMembership } from '@/contexts/MembershipContext';

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
        activeOrganizationId?: string | null;
        activeRoles?: Array<'teacher' | 'student' | 'school_admin'>;
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

function TestConsumer() {
  const {
    memberships,
    activeMembership,
    activeOrganizationId,
    activeRoles,
    hasRole,
    hasAnyRole,
  } = useMembership();

  return (
    <div>
      <span data-testid="membership-count">{memberships.length}</span>
      <span data-testid="active-membership-id">{activeMembership?.id ?? 'none'}</span>
      <span data-testid="active-org-id">{activeOrganizationId ?? 'none'}</span>
      <span data-testid="active-roles">{activeRoles.join(',') || 'none'}</span>
      <span data-testid="has-teacher">{String(hasRole('teacher'))}</span>
      <span data-testid="has-student">{String(hasRole('student'))}</span>
      <span data-testid="has-school-admin">{String(hasRole('school_admin'))}</span>
      <span data-testid="has-any-teacher-admin">
        {String(hasAnyRole(['teacher', 'school_admin']))}
      </span>
    </div>
  );
}

describe('MembershipContext', () => {
  beforeEach(() => {
    authState.user = null;
  });

  it('detects teacher role from active membership', () => {
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
      <MembershipProvider>
        <TestConsumer />
      </MembershipProvider>,
    );

    expect(screen.getByTestId('has-teacher')).toHaveTextContent('true');
    expect(screen.getByTestId('active-roles')).toHaveTextContent('teacher');
  });

  it('returns false for hasAnyRole teacher/admin when user is student only', () => {
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
      <MembershipProvider>
        <TestConsumer />
      </MembershipProvider>,
    );

    expect(screen.getByTestId('has-any-teacher-admin')).toHaveTextContent('false');
    expect(screen.getByTestId('has-student')).toHaveTextContent('true');
  });

  it('builds role set from union of all memberships', () => {
    authState.user = {
      uid: 'multi-role-user',
      email: 'multi@example.com',
      name: 'Multi User',
      activeMembershipId: 'mem-student-b',
      memberships: [
        {
          id: 'mem-teacher-a',
          orgId: 'org-a',
          orgName: 'Org A',
          roles: ['teacher'],
          status: 'active',
        },
        {
          id: 'mem-student-b',
          orgId: 'org-b',
          orgName: 'Org B',
          roles: ['student'],
          status: 'active',
        },
      ],
    };

    render(
      <MembershipProvider>
        <TestConsumer />
      </MembershipProvider>,
    );

    // Active membership is student in org B
    expect(screen.getByTestId('active-membership-id')).toHaveTextContent('mem-student-b');
    expect(screen.getByTestId('active-roles')).toHaveTextContent('student');

    // But hasRole checks union of all memberships, so teacher is still true
    expect(screen.getByTestId('has-teacher')).toHaveTextContent('true');
    expect(screen.getByTestId('has-student')).toHaveTextContent('true');
  });

  it('exposes activeOrganizationId from active membership', () => {
    authState.user = {
      uid: 'user-1',
      email: 'user@example.com',
      name: 'User',
      activeMembershipId: 'mem-1',
      memberships: [
        {
          id: 'mem-1',
          orgId: 'org-42',
          orgName: 'Org 42',
          roles: ['teacher'],
          status: 'active',
        },
      ],
    };

    render(
      <MembershipProvider>
        <TestConsumer />
      </MembershipProvider>,
    );

    expect(screen.getByTestId('active-org-id')).toHaveTextContent('org-42');
  });

  it('returns empty/null values when memberships is empty', () => {
    authState.user = {
      uid: 'empty-user',
      email: 'empty@example.com',
      name: 'Empty User',
      memberships: [],
    };

    render(
      <MembershipProvider>
        <TestConsumer />
      </MembershipProvider>,
    );

    expect(screen.getByTestId('membership-count')).toHaveTextContent('0');
    expect(screen.getByTestId('active-membership-id')).toHaveTextContent('none');
    expect(screen.getByTestId('active-org-id')).toHaveTextContent('none');
    expect(screen.getByTestId('active-roles')).toHaveTextContent('none');
    expect(screen.getByTestId('has-teacher')).toHaveTextContent('false');
    expect(screen.getByTestId('has-student')).toHaveTextContent('false');
    expect(screen.getByTestId('has-school-admin')).toHaveTextContent('false');
  });

  it('detects school_admin role', () => {
    authState.user = {
      uid: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin User',
      activeMembershipId: 'mem-admin',
      memberships: [
        {
          id: 'mem-admin',
          orgId: 'org-1',
          orgName: 'Lingual Academy',
          roles: ['school_admin'],
          status: 'active',
        },
      ],
    };

    render(
      <MembershipProvider>
        <TestConsumer />
      </MembershipProvider>,
    );

    expect(screen.getByTestId('has-school-admin')).toHaveTextContent('true');
    expect(screen.getByTestId('has-any-teacher-admin')).toHaveTextContent('true');
  });

  it('selects active membership by activeMembershipId', () => {
    authState.user = {
      uid: 'user-2',
      email: 'user2@example.com',
      name: 'User Two',
      activeMembershipId: 'mem-second',
      memberships: [
        {
          id: 'mem-first',
          orgId: 'org-a',
          orgName: 'First Org',
          roles: ['student'],
          status: 'active',
        },
        {
          id: 'mem-second',
          orgId: 'org-b',
          orgName: 'Second Org',
          roles: ['teacher'],
          status: 'active',
        },
      ],
    };

    render(
      <MembershipProvider>
        <TestConsumer />
      </MembershipProvider>,
    );

    expect(screen.getByTestId('active-membership-id')).toHaveTextContent('mem-second');
    expect(screen.getByTestId('active-roles')).toHaveTextContent('teacher');
    expect(screen.getByTestId('membership-count')).toHaveTextContent('2');
  });
});
