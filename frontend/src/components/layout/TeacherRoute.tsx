import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useMembership } from '@/contexts/MembershipContext';

const TEACHER_ALLOWED_ROLES = ['teacher', 'school_admin'] as const;

export function TeacherRoute({ children }: { children: ReactNode }) {
  const { memberships, hasAnyRole } = useMembership();

  if (memberships.length === 0) {
    return <Navigate to="/school/setup" replace />;
  }

  if (!hasAnyRole([...TEACHER_ALLOWED_ROLES])) {
    return <Navigate to="/app/learn" replace />;
  }

  return <>{children}</>;
}
