import { describe, it, expect } from 'vitest';
import {
  getOnboardingDestination,
  LEARNER_HOME_ROUTE,
  TEACHER_HOME_ROUTE,
  LINGUAL_ADMIN_HOME_ROUTE,
  STUDENT_SETUP_ROUTE,
  TEACHER_JOIN_ORG_ROUTE,
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

  it('routes active school_admin to teacher home (admin dashboard in this plan)', () => {
    const dest = getOnboardingDestination(
      userOf({
        memberships: [
          { id: 'm1', orgId: 'o1', orgName: 'Org', roles: ['school_admin'], status: 'active' },
        ],
        activeRoles: ['school_admin'],
      }),
    );
    expect(dest).toBe(TEACHER_HOME_ROUTE);
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

  it('resumes intended teacher pending to teacher join-org page', () => {
    const dest = getOnboardingDestination(
      userOf({ intendedRole: 'teacher', onboardingState: 'teacher_pending' }),
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

  it('legacy user without role falls back to student setup until Plan 6', () => {
    const dest = getOnboardingDestination(
      userOf({ requiresLegacyRolePick: true }),
    );
    expect(dest).toBe(STUDENT_SETUP_ROUTE);
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
