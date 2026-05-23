import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MembershipProvider } from '@/contexts/MembershipContext';
import { SchoolAdminRoute } from './SchoolAdminRoute';

/**
 * P2 #5 regression: /app/admin used to be wrapped in TeacherRoute, which
 * allows BOTH teacher and school_admin. A teacher-only user could
 * manually navigate to /app/admin and see the school-admin home. The
 * spec requires a school_admin membership specifically.
 */

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
} = { user: null };

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authState.user }),
}));

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/app/admin']}>
      <MembershipProvider>
        <Routes>
          <Route path="/app/learn" element={<div>Learn Page</div>} />
          <Route path="/app/teacher" element={<div>Teacher Home</div>} />
          <Route path="/signup/teacher/join-org" element={<div>Join Org</div>} />
          <Route
            path="/app/admin"
            element={
              <SchoolAdminRoute>
                <div>School Admin Home</div>
              </SchoolAdminRoute>
            }
          />
        </Routes>
      </MembershipProvider>
    </MemoryRouter>
  );
}

describe('SchoolAdminRoute', () => {
  beforeEach(() => {
    authState.user = null;
  });

  it('renders for school_admin membership', () => {
    authState.user = {
      uid: 'admin-1',
      email: 'a@x.com',
      name: 'Admin',
      activeMembershipId: 'm-admin',
      memberships: [{
        id: 'm-admin', orgId: 'o1', orgName: 'Sunset', roles: ['school_admin'], status: 'active',
      }],
    };
    renderRoute();
    expect(screen.getByText('School Admin Home')).toBeInTheDocument();
  });

  // The key regression: teacher-only must NOT see school-admin home.
  it('redirects teacher-only membership to teacher home (P2 #5)', () => {
    authState.user = {
      uid: 'teacher-1',
      email: 't@x.com',
      name: 'Teacher',
      activeMembershipId: 'm-teacher',
      memberships: [{
        id: 'm-teacher', orgId: 'o1', orgName: 'Sunset', roles: ['teacher'], status: 'active',
      }],
    };
    renderRoute();
    expect(screen.queryByText('School Admin Home')).not.toBeInTheDocument();
    expect(screen.getByText('Teacher Home')).toBeInTheDocument();
  });

  it('allows users with combined school_admin + teacher roles', () => {
    // School admins routinely also hold a teacher role for their own classes.
    authState.user = {
      uid: 'dual-1',
      email: 'd@x.com',
      name: 'Dual',
      activeMembershipId: 'm-dual',
      memberships: [{
        id: 'm-dual', orgId: 'o1', orgName: 'Sunset',
        roles: ['teacher', 'school_admin'], status: 'active',
      }],
    };
    renderRoute();
    expect(screen.getByText('School Admin Home')).toBeInTheDocument();
  });

  it('sends users without memberships to join-org', () => {
    authState.user = {
      uid: 'new-1', email: 'n@x.com', name: 'New', memberships: [],
    };
    renderRoute();
    expect(screen.getByText('Join Org')).toBeInTheDocument();
  });
});
