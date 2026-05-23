import type { User } from '@/types';
import type { SchoolRole } from '@/types/school';

// ── Routes the dispatcher can return ───────────────────────────────────────
export const LEARNER_HOME_ROUTE = '/app/learn';
export const TEACHER_HOME_ROUTE = '/app/teacher';
// Plan 5 (Task 27) splits the post-login dispatcher:
//   - school_admin users land on the new admin dashboard at /app/admin
//   - Lingual-side superadmins land on /lingual-admin/requests
// The Lingual admin panel is mounted at the top level (outside /app) so its
// own shell chrome does not double-nest inside AppLayout. The legacy
// /app/admin/school-requests surface is retired by Plan 5.
export const SCHOOL_ADMIN_HOME_ROUTE = '/app/admin';
export const LINGUAL_ADMIN_HOME_ROUTE = '/lingual-admin/requests';

export const STUDENT_SETUP_ROUTE = '/signup/student/setup';
export const TEACHER_JOIN_ORG_ROUTE = '/signup/teacher/join-org';
export const TEACHER_JOIN_PENDING_ROUTE = '/signup/teacher/pending';
export const ADMIN_ORG_WIZARD_ROUTE = '/signup/admin/org-wizard';
export const ADMIN_PENDING_ROUTE = '/signup/admin/pending';
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
 *
 * Plan 5 (Task 27) splits school_admin off from teacher so that school admins
 * land on the new `/app/admin` dashboard instead of the teacher home. Legacy
 * callers therefore also pick up the new behavior.
 */
export function getPrivilegedHomeRoute(user: User | null | undefined): string | null {
  if (!user) return null;
  // Plan 6: same legacy gate as `getOnboardingDestination`. Callers (e.g.,
  // AppLayout's home-link destination) must accept null and skip linking.
  if (user.requiresLegacyRolePick) return null;
  if (user.lingualAdmin) return LINGUAL_ADMIN_HOME_ROUTE;

  const roles = activeRoles(user);
  if (roles.has('school_admin')) return SCHOOL_ADMIN_HOME_ROUTE;
  if (roles.has('teacher')) return TEACHER_HOME_ROUTE;
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
 * Plan 5 (Task 27) splits school_admin from teacher: school admins land on
 * `/app/admin`, teachers (who are not also school admins) keep going to
 * `/app/teacher`. Lingual admins still win over both branches.
 *
 * Plan 6 (Task 6) gates legacy users to `null` so AuthProvider's
 * `LegacyRoleMigrationModal` can take over. Callers MUST treat null as
 * 'stay on current page'.
 */
export function getOnboardingDestination(user: User | null | undefined): string | null {
  if (!user) return null;

  // 0) Legacy user awaiting modal — do NOT navigate; AuthProvider mounts
  //    `LegacyRoleMigrationModal` (Plan 6 Task 5). Callers MUST treat null
  //    as "stay on current page" so the modal can take over.
  if (user.requiresLegacyRolePick) return null;

  // 1) Lingual admin
  if (user.lingualAdmin) return LINGUAL_ADMIN_HOME_ROUTE;

  // 2) Active memberships
  const roles = activeRoles(user);
  if (roles.has('school_admin')) {
    return SCHOOL_ADMIN_HOME_ROUTE;
  }
  if (roles.has('teacher')) {
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
  if (user.intendedRole === 'student') return STUDENT_SETUP_ROUTE;
  if (user.intendedRole === 'teacher' && user.onboardingState === 'teacher_pending') {
    return TEACHER_JOIN_PENDING_ROUTE;
  }
  if (user.intendedRole === 'teacher') return TEACHER_JOIN_ORG_ROUTE;
  if (user.intendedRole === 'admin' && user.onboardingState === 'awaiting_lingual') {
    return ADMIN_PENDING_ROUTE;
  }
  if (user.intendedRole === 'admin') return ADMIN_ORG_WIZARD_ROUTE;

  // 5) Brand-new signup that somehow has no signals — force role pick.
  return ROLE_PICKER_ROUTE;
}
