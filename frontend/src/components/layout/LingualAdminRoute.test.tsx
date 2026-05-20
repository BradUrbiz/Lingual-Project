import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { LingualAdminRoute } from './LingualAdminRoute';
import * as AuthCtx from '@/contexts/AuthContext';

/**
 * Plan 5 Important #1 fix moved the Lingual admin panel to top-level
 * /lingual-admin/*, dropping the AppProtectedRoute loading gate. These
 * tests pin the regression: a signed-in admin who refreshes
 * /lingual-admin/requests must NOT be flashed to /login while
 * Firebase verification is still pending.
 */

function setupAuth(value: Partial<ReturnType<typeof AuthCtx.useAuth>>) {
  vi.spyOn(AuthCtx, 'useAuth').mockReturnValue({
    user: null,
    loading: false,
    error: null,
    avatarUrl: null,
    firebaseUser: null,
    updateAvatarUrl: vi.fn(),
    refreshUser: vi.fn(),
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
    resetPassword: vi.fn(),
    ...value,
  } as ReturnType<typeof AuthCtx.useAuth>);
}

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/lingual-admin']}>
      <Routes>
        <Route
          path="/lingual-admin"
          element={
            <LingualAdminRoute>
              <div data-testid="admin-content">ADMIN</div>
            </LingualAdminRoute>
          }
        />
        <Route path="/login" element={<div data-testid="login">LOGIN</div>} />
        <Route path="/app/learn" element={<div data-testid="learn">LEARN</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('LingualAdminRoute', () => {
  it('shows a spinner while auth is loading (P2 #4 regression)', () => {
    // Pre-fix: loading was ignored, so `user === null && loading` redirected
    // to /login, kicking signed-in admins on every page refresh.
    setupAuth({ user: null, loading: true });
    renderRoute();
    expect(screen.queryByTestId('login')).toBeNull();
    expect(screen.queryByTestId('admin-content')).toBeNull();
    // Spinner has role="status" via LoadingSpinner.
    expect(document.querySelector('.min-h-screen')).toBeInTheDocument();
  });

  it('redirects to /login when loading completes with no user', () => {
    setupAuth({ user: null, loading: false });
    renderRoute();
    expect(screen.getByTestId('login')).toBeInTheDocument();
  });

  it('redirects non-admin signed-in users to /app/learn', () => {
    setupAuth({
      user: {
        uid: 'u1',
        email: 'u@x.com',
        displayName: 'U',
        lingualAdmin: false,
        memberships: [],
        activeRoles: [],
      } as never,
      loading: false,
    });
    renderRoute();
    expect(screen.getByTestId('learn')).toBeInTheDocument();
  });

  it('renders children for signed-in Lingual admins', () => {
    setupAuth({
      user: {
        uid: 'admin-1',
        email: 'a@x.com',
        displayName: 'A',
        lingualAdmin: true,
        memberships: [],
        activeRoles: [],
      } as never,
      loading: false,
    });
    renderRoute();
    expect(screen.getByTestId('admin-content')).toBeInTheDocument();
  });
});
