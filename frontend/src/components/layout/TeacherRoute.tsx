import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useMembership } from '@/contexts/MembershipContext';
import { TEACHER_JOIN_ORG_ROUTE } from '@/lib/homeRoutes';

const TEACHER_ALLOWED_ROLES = ['teacher', 'school_admin'] as const;

export function TeacherRoute({ children }: { children: ReactNode }) {
  const { memberships, hasAnyRole } = useMembership();

  if (memberships.length === 0) {
    return <Navigate to={TEACHER_JOIN_ORG_ROUTE} replace />;
  }

  if (!hasAnyRole([...TEACHER_ALLOWED_ROLES])) {
    return <Navigate to="/app/learn" replace />;
  }

  return <>{children}</>;
}
