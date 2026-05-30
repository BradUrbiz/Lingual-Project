import { describe, it, expect } from 'vitest';
import {
  getOnboardingDestination,
  getPrivilegedHomeRoute,
  LEARNER_HOME_ROUTE,
  TEACHER_HOME_ROUTE,
  SCHOOL_ADMIN_HOME_ROUTE,
  LINGUAL_ADMIN_HOME_ROUTE,
  STUDENT_SETUP_ROUTE,
  TEACHER_JOIN_ORG_ROUTE,
  TEACHER_JOIN_PENDING_ROUTE,
  ADMIN_ORG_WIZARD_ROUTE,
  ADMIN_PENDING_ROUTE,
  ROLE_PICKER_ROUTE,
} from './homeRoutes';
import type { User } from '@/types';

function userOf(overrides: Partial<User> = {}): User {
  return {
    uid: 'u1',
    email: 'u@example.test',
    name: 'U',
    memberships: [],
    activeRoles: [],
    ...overrides,
  };
}

describe('getOnboardingDestination', () => {
  it('routes lingual admins to the lingual admin home', () => {
    const dest = getOnboardingDestination(userOf({ lingualAdmin: true }));
    expect(dest).toBe(LINGUAL_ADMIN_HOME_ROUTE);
  });

  it('routes active school_admin to the school admin home (/app/admin)', () => {
    const dest = getOnboardingDestination(
      userOf({
        memberships: [
          { id: 'm1', orgId: 'o1', orgName: 'Org', roles: ['school_admin'], status: 'active' },
        ],
        activeRoles: ['school_admin'],
      }),
    );
    expect(dest).toBe(SCHOOL_ADMIN_HOME_ROUTE);
  });

  it('routes active teacher to teacher home', () => {
    const dest = getOnboardingDestination(
      userOf({
        memberships: [
          { id: 'm1', orgId: 'o1', orgName: 'Org', roles: ['teacher'], status: 'active' },
        ],
        activeRoles: ['teacher'],
      }),
    );
    expect(dest).toBe(TEACHER_HOME_ROUTE);
  });

  it('routes active student membership to learner home', () => {
    const dest = getOnboardingDestination(
      userOf({
        memberships: [
          { id: 'm1', orgId: 'o1', orgName: 'Org', roles: ['student'], status: 'active' },
        ],
        activeRoles: ['student'],
      }),
    );
    expect(dest).toBe(LEARNER_HOME_ROUTE);
  });

  it('routes completed students to learner home', () => {
    const dest = getOnboardingDestination(
      userOf({ intendedRole: 'student', onboardingState: 'complete' }),
    );
    expect(dest).toBe(LEARNER_HOME_ROUTE);
  });

  it('routes intended student without state to student setup', () => {
    const dest = getOnboardingDestination(userOf({ intendedRole: 'student' }));
    expect(dest).toBe(STUDENT_SETUP_ROUTE);
  });

  it('resumes intended teacher to teacher join-org page', () => {
    const dest = getOnboardingDestination(
      userOf({ intendedRole: 'teacher', onboardingState: 'role_selected' }),
    );
    expect(dest).toBe(TEACHER_JOIN_ORG_ROUTE);
  });

  it('routes teacher_pending state to the pending page', () => {
    const dest = getOnboardingDestination(
      userOf({ intendedRole: 'teacher', onboardingState: 'teacher_pending' }),
    );
    expect(dest).toBe(TEACHER_JOIN_PENDING_ROUTE);
  });

  it('still routes intendedRole=teacher without pending state to join-org', () => {
    const dest = getOnboardingDestination(
      userOf({ intendedRole: 'teacher', onboardingState: 'role_selected' }),
    );
    expect(dest).toBe(TEACHER_JOIN_ORG_ROUTE);
  });

  it('resumes intended admin to wizard', () => {
    const dest = getOnboardingDestination(
      userOf({ intendedRole: 'admin', onboardingState: 'role_selected' }),
    );
    expect(dest).toBe(ADMIN_ORG_WIZARD_ROUTE);
  });

  it('resumes intended admin awaiting Lingual to the wizard pending page', () => {
    const dest = getOnboardingDestination(
      userOf({ intendedRole: 'admin', onboardingState: 'awaiting_lingual' }),
    );
    expect(dest).toBe(ADMIN_PENDING_ROUTE);
  });

  it('returns null for requiresLegacyRolePick=true (Plan 6 - modal handles routing)', () => {
    const user: User = {
      uid: 'u',
      email: 'a@x.com',
      name: 'A',
      requiresLegacyRolePick: true,
    };
    expect(getOnboardingDestination(user)).toBeNull();
  });

  it('user with no signals lands on role picker', () => {
    const dest = getOnboardingDestination(userOf());
    expect(dest).toBe(ROLE_PICKER_ROUTE);
  });

  it('returns null for unauthenticated', () => {
    expect(getOnboardingDestination(null)).toBeNull();
    expect(getOnboardingDestination(undefined)).toBeNull();
  });
});

describe('Plan 5 routing additions', () => {
  it('exposes SCHOOL_ADMIN_HOME_ROUTE as /app/admin', () => {
    expect(SCHOOL_ADMIN_HOME_ROUTE).toBe('/app/admin');
  });

  it('LINGUAL_ADMIN_HOME_ROUTE points at /lingual-admin/requests', () => {
    expect(LINGUAL_ADMIN_HOME_ROUTE).toBe('/lingual-admin/requests');
  });

  it('school_admin with no teacher role goes to /app/admin', () => {
    const user: User = {
      uid: 'u',
      email: 'a@x.com',
      memberships: [{ orgId: 'o', roles: ['school_admin'], status: 'active' }],
    } as User;
    expect(getOnboardingDestination(user)).toBe(SCHOOL_ADMIN_HOME_ROUTE);
  });

  it('school_admin who is also a teacher still goes to /app/admin', () => {
    const user: User = {
      uid: 'u',
      email: 'a@x.com',
      memberships: [{ orgId: 'o', roles: ['school_admin', 'teacher'], status: 'active' }],
    } as User;
    expect(getOnboardingDestination(user)).toBe(SCHOOL_ADMIN_HOME_ROUTE);
  });

  it('teacher (no school_admin) still goes to /app/teacher', () => {
    const user: User = {
      uid: 'u',
      email: 'a@x.com',
      memberships: [{ orgId: 'o', roles: ['teacher'], status: 'active' }],
    } as User;
    expect(getOnboardingDestination(user)).toBe(TEACHER_HOME_ROUTE);
  });

  it('lingual_admin still wins over both', () => {
    const user: User = {
      uid: 'u',
      email: 'a@x.com',
      lingualAdmin: true,
      memberships: [{ orgId: 'o', roles: ['school_admin'], status: 'active' }],
    } as User;
    expect(getOnboardingDestination(user)).toBe(LINGUAL_ADMIN_HOME_ROUTE);
  });
});

describe('Plan 6 - legacy modal gating', () => {
  it('returns null for requiresLegacyRolePick=true even when active memberships exist (defense-in-depth)', () => {
    // This should never happen in practice (the backend will not flag a user
    // with active memberships as legacy), but if the flag is somehow true,
    // the dispatcher MUST yield to the modal - better a brief blank screen
    // than a broken modal experience.
    const user: User = {
      uid: 'u',
      email: 'a@x.com',
      name: 'A',
      requiresLegacyRolePick: true,
      memberships: [{ id: 'm1', orgId: 'o', orgName: 'O', roles: ['teacher'], status: 'active' }],
    };
    expect(getOnboardingDestination(user)).toBeNull();
  });

  it('still routes legacy users WITHOUT the flag based on memberships (after backfill)', () => {
    // After the backfill script (Task 7) runs, a previously-legacy user
    // with active memberships gets `intended_role` set and the flag
    // becomes false. They should route normally to their dashboard.
    const user: User = {
      uid: 'u',
      email: 'a@x.com',
      name: 'A',
      requiresLegacyRolePick: false,
      intendedRole: 'teacher',
      onboardingState: 'complete',
      memberships: [{ id: 'm1', orgId: 'o', orgName: 'O', roles: ['teacher'], status: 'active' }],
    };
    expect(getOnboardingDestination(user)).toBe('/app/teacher');
  });

  it('getPrivilegedHomeRoute also returns null for requiresLegacyRolePick=true', () => {
    const user: User = {
      uid: 'u',
      email: 'a@x.com',
      name: 'A',
      requiresLegacyRolePick: true,
    };
    expect(getPrivilegedHomeRoute(user)).toBeNull();
  });
});
