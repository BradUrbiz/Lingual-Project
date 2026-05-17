import type { User } from '@/types';
import type { SchoolRole } from '@/types/school';

// ── Routes the dispatcher can return ───────────────────────────────────────
export const LEARNER_HOME_ROUTE = '/app/learn';
export const TEACHER_HOME_ROUTE = '/app/teacher';
// Lingual admins land at the existing school-requests page until Plan 5
// moves this surface to /app/lingual-admin/requests. Plan 3 will add a
// distinct SCHOOL_ADMIN_HOME_ROUTE ('/app/admin') for school_admin users.
export const LINGUAL_ADMIN_HOME_ROUTE = '/app/admin/school-requests';

export const STUDENT_SETUP_ROUTE = '/signup/student/setup';
export const TEACHER_JOIN_ORG_ROUTE = '/signup/teacher/join-org';
export const ADMIN_ORG_WIZARD_ROUTE = '/signup/admin/org-wizard';
export const ROLE_PICKER_ROUTE = '/signup';

// Legacy alias retained while pages still import it. New code should
// prefer `STUDENT_SETUP_ROUTE`.
export const LEARNER_SETUP_ROUTE = STUDENT_SETUP_ROUTE;

function activeRoles(user: User): Set<SchoolRole> {
  const fromMemberships = (user.memberships ?? [])
    .filter((m) => (m.status ?? 'active') === 'active')
    .flatMap((m) => m.roles ?? []);
  return new Set<SchoolRole>([...(user.activeRoles ?? []), ...fromMemberships]);
}

/**
 * Returns the route a privileged user should land on after sign-in.
 * Kept for callers that have not yet migrated to `getOnboardingDestination`.
 *
 * Note: relies on `user.lingualAdmin` being set by the backend. Task 1 closed
 * the gap where this field was declared but never populated.
 */
export function getPrivilegedHomeRoute(user: User | null | undefined): string | null {
  if (!user) return null;
  if (user.lingualAdmin) return LINGUAL_ADMIN_HOME_ROUTE;

  const roles = activeRoles(user);
  if (roles.has('school_admin') || roles.has('teacher')) {
    return TEACHER_HOME_ROUTE;
  }
  return null;
}

/**
 * Authoritative dispatcher for "where should this user land after auth?".
 * Returns null when the user is not authenticated.
 *
 * Plan 2 migrates callers to this function incrementally (Tasks 6, 7, 9, 11,
 * 12). Until that migration completes, `getPrivilegedHomeRoute` still serves
 * legacy callers; do not delete it.
 *
 * Order matters. Membership-derived destinations win over `intendedRole`
 * because a returning user with a real membership should never be sent
 * back through the signup wizard.
 *
 * Until Plan 6 ships the legacy modal, `requiresLegacyRolePick` users
 * fall back to the existing student setup flow so legacy learners stay
 * functional.
 */
export function getOnboardingDestination(user: User | null | undefined): string | null {
  if (!user) return null;

  // 1) Lingual admin
  if (user.lingualAdmin) return LINGUAL_ADMIN_HOME_ROUTE;

  // 2) Active memberships
  const roles = activeRoles(user);
  // TEMP: school_admin shares teacher home until Plan 3 ships /app/admin.
  // When SCHOOL_ADMIN_HOME_ROUTE lands, split this into two branches.
  if (roles.has('school_admin') || roles.has('teacher')) {
    return TEACHER_HOME_ROUTE;
  }
  if (roles.has('student')) {
    return LEARNER_HOME_ROUTE;
  }

  // 3) Completed onboarding (legacy learners marked `complete` by Plan 1
  //    backfill or by finishing student setup).
  if (user.onboardingState === 'complete') {
    return LEARNER_HOME_ROUTE;
  }

  // 4) Resume in-flight signup based on intendedRole + onboardingState.
  // TODO(Plan 3/4): when /signup/teacher/pending and /signup/admin/pending
  // ship, branch on `onboardingState === 'teacher_pending'` /
  // 'awaiting_lingual' to land on those pages instead of the form pages.
  if (user.intendedRole === 'student') return STUDENT_SETUP_ROUTE;
  if (user.intendedRole === 'teacher') return TEACHER_JOIN_ORG_ROUTE;
  if (user.intendedRole === 'admin') return ADMIN_ORG_WIZARD_ROUTE;

  // 5) Legacy users without intendedRole. Plan 6 will replace this with
  //    a blocking modal; until then, fall back to the existing student
  //    setup so learners keep working.
  if (user.requiresLegacyRolePick) return STUDENT_SETUP_ROUTE;

  // 6) Brand-new signup that somehow has no signals — force role pick.
  return ROLE_PICKER_ROUTE;
}
