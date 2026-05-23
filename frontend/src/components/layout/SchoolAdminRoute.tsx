import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useMembership } from '@/contexts/MembershipContext';
import { TEACHER_HOME_ROUTE, TEACHER_JOIN_ORG_ROUTE } from '@/lib/homeRoutes';

// Route guard for `/app/admin/*` (school-admin home).
//
// Why a separate guard from `TeacherRoute`: `TeacherRoute` allows BOTH
// `teacher` and `school_admin` (a teacher viewing the teacher dashboard
// shouldn't be locked out just because they're not also an admin). The
// school-admin home, by contrast, surfaces org-wide controls that a
// teacher-only membership must not see. Plan 5 spec §1 says `/app/admin`
// requires a `school_admin` membership; this guard pins that invariant.
//
// Non-school-admin teachers fall through to the teacher home rather than
// the learn page so the demotion is visible rather than disorienting.
export function SchoolAdminRoute({ children }: { children: ReactNode }) {
  const { memberships, hasAnyRole } = useMembership();

  if (memberships.length === 0) {
    return <Navigate to={TEACHER_JOIN_ORG_ROUTE} replace />;
  }

  if (!hasAnyRole(['school_admin'])) {
    return <Navigate to={TEACHER_HOME_ROUTE} replace />;
  }

  return <>{children}</>;
}
