import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export function LingualAdminRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!(user as unknown as Record<string, unknown>).lingualAdmin) {
    return <Navigate to="/app/learn" replace />;
  }

  return <>{children}</>;
}
