import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingSpinner } from '@/components/common';

// Plan 5 Important #1 fix moved this route OUTSIDE /app, so it no longer
// inherits AppProtectedRoute's loading gate. On a browser refresh or a
// direct visit to /lingual-admin/*, AuthContext's `user` is null until the
// Firebase ID token is verified; without checking `loading` here we'd
// redirect a signed-in admin to /login during that window. (LIMITATIONS #38.)
export function LingualAdminRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!user.lingualAdmin) {
    return <Navigate to="/app/learn" replace />;
  }

  return <>{children}</>;
}
