import type { User } from '@/types';
import type { SchoolRole } from '@/types/school';

export const ADMIN_HOME_ROUTE = '/app/admin/school-requests';
export const TEACHER_HOME_ROUTE = '/app/teacher';
export const LEARNER_HOME_ROUTE = '/app/learn';
export const LEARNER_SETUP_ROUTE = '/general';

function getRoleSet(user: User | null | undefined): Set<SchoolRole> {
  const membershipRoles = (user?.memberships ?? []).flatMap((membership) => membership.roles ?? []);
  return new Set<SchoolRole>([...(user?.activeRoles ?? []), ...membershipRoles]);
}

export function getPrivilegedHomeRoute(user: User | null | undefined): string | null {
  if (user?.lingualAdmin) {
    return ADMIN_HOME_ROUTE;
  }

  const roles = getRoleSet(user);
  if (roles.has('school_admin') || roles.has('teacher')) {
    return TEACHER_HOME_ROUTE;
  }

  return null;
}
