import { act, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, hasMembershipDiff } from './AuthContext';
import { useAuth } from '@/hooks/useAuth';
import { useEffect, useRef, type ReactNode } from 'react';
import type { IntendedRole } from '../api/auth';
import type { User } from '../types';

const { firebaseAuthState, firebaseSignOutMock, verifyTokenMock, migrateRoleMock } = vi.hoisted(() => ({
  firebaseAuthState: {
    currentUser: null as { getIdToken: () => Promise<string> } | null,
  },
  firebaseSignOutMock: vi.fn().mockResolvedValue(undefined),
  verifyTokenMock: vi.fn(),
  migrateRoleMock: vi.fn(),
}));

vi.mock('../api/auth', () => ({
  verifyToken: (...args: unknown[]) => verifyTokenMock(...args),
  logout: vi.fn(),
  migrateRole: (...args: unknown[]) => migrateRoleMock(...args),
}));

vi.mock('firebase/auth', async () => {
  const actual = await vi.importActual<typeof import('firebase/auth')>('firebase/auth');
  return {
    ...actual,
    onAuthStateChanged: (_auth: unknown, cb: (u: null) => void) => {
      cb(null);
      return () => {};
    },
    createUserWithEmailAndPassword: vi.fn().mockResolvedValue({
      user: { getIdToken: vi.fn().mockResolvedValue('id-token-signup') },
    }),
    signInWithPopup: vi.fn().mockResolvedValue({
      user: { getIdToken: vi.fn().mockResolvedValue('id-token-google') },
    }),
    signInWithEmailAndPassword: vi.fn().mockResolvedValue({
      user: { getIdToken: vi.fn().mockResolvedValue('id-token-signin') },
    }),
    signOut: (...args: unknown[]) => firebaseSignOutMock(...args),
  };
});

// firebaseAuthState is mutable so tests that exercise the polling effect can
// swap in a Firebase user that produces an id token; default is signed-out to
// match earlier tests.
vi.mock('../config/firebase', () => ({
  auth: firebaseAuthState,
  googleProvider: {},
  githubProvider: {},
  facebookProvider: {},
}));

function CallSignUp({ role }: { role?: IntendedRole }) {
  const { signUpWithEmail } = useAuth();
  useEffect(() => {
    signUpWithEmail('a@b.test', 'password123', role ? { intendedRole: role } : undefined);
  }, [signUpWithEmail, role]);
  return <div>ready</div>;
}

function CallGoogle({ role }: { role?: IntendedRole }) {
  const { signInWithGoogle } = useAuth();
  useEffect(() => {
    signInWithGoogle(role ? { intendedRole: role } : undefined);
  }, [signInWithGoogle, role]);
  return <div>ready</div>;
}

function CallSignIn() {
  const { signInWithEmail } = useAuth();
  useEffect(() => {
    signInWithEmail('a@b.test', 'password123');
  }, [signInWithEmail]);
  return <div>ready</div>;
}

describe('AuthContext intendedRole forwarding', () => {
  beforeEach(() => {
    verifyTokenMock.mockReset();
    verifyTokenMock.mockResolvedValue({ success: true, user: { uid: 'u1' } });
    localStorage.clear();
  });

  it('forwards intendedRole on email signup', async () => {
    render(
      <AuthProvider>
        <CallSignUp role="teacher" />
      </AuthProvider>,
    );
    await screen.findByText('ready');
    await waitFor(() => {
      expect(verifyTokenMock).toHaveBeenCalledWith('id-token-signup', { intendedRole: 'teacher' });
    });
  });

  it('forwards intendedRole on Google sign-in', async () => {
    render(
      <AuthProvider>
        <CallGoogle role="admin" />
      </AuthProvider>,
    );
    await screen.findByText('ready');
    await waitFor(() => {
      expect(verifyTokenMock).toHaveBeenCalledWith('id-token-google', { intendedRole: 'admin' });
    });
  });

  it('omits intendedRole when not provided', async () => {
    render(
      <AuthProvider>
        <CallSignUp />
      </AuthProvider>,
    );
    await screen.findByText('ready');
    await waitFor(() => {
      expect(verifyTokenMock).toHaveBeenCalledWith('id-token-signup', undefined);
    });
  });

  it('signInWithEmail never forwards intendedRole (role-blind contract)', async () => {
    render(
      <AuthProvider>
        <CallSignIn />
      </AuthProvider>,
    );
    await screen.findByText('ready');
    await waitFor(() => {
      expect(verifyTokenMock).toHaveBeenCalledWith('id-token-signin');
    });
    // The second argument must be omitted entirely — login is for returning
    // users whose role comes from their memberships, not from a UI selection.
    const calls = verifyTokenMock.mock.calls;
    const signInCall = calls.find((c) => c[0] === 'id-token-signin');
    expect(signInCall).toBeDefined();
    expect(signInCall).toHaveLength(1);
  });
});

const buildUser = (over: Partial<User> = {}): User => ({
  uid: 'u1',
  email: 'a@b.test',
  name: 'A',
  ...over,
});

describe('hasMembershipDiff', () => {
  it('returns false for two equivalent users (no diff)', () => {
    const a = buildUser({
      lingualAdmin: false,
      activeRoles: ['teacher'],
      memberships: [{ id: 'm1', orgId: 'org-1', orgName: 'Org 1', roles: ['teacher'], status: 'active' }],
    });
    const b: User = JSON.parse(JSON.stringify(a));
    expect(hasMembershipDiff(a, b)).toBe(false);
  });

  it('detects lingualAdmin flip', () => {
    const a = buildUser({ lingualAdmin: false });
    const b = buildUser({ lingualAdmin: true });
    expect(hasMembershipDiff(a, b)).toBe(true);
  });

  it('detects activeRoles changes (order-insensitive)', () => {
    const a = buildUser({ activeRoles: ['teacher', 'admin'] });
    const sameReordered = buildUser({ activeRoles: ['admin', 'teacher'] });
    const different = buildUser({ activeRoles: ['teacher'] });
    expect(hasMembershipDiff(a, sameReordered)).toBe(false);
    expect(hasMembershipDiff(a, different)).toBe(true);
  });

  it('detects membership status changes (e.g., suspend)', () => {
    const a = buildUser({
      memberships: [{ id: 'm1', orgId: 'org-1', orgName: 'Org 1', roles: ['teacher'], status: 'active' }],
    });
    const b = buildUser({
      memberships: [{ id: 'm1', orgId: 'org-1', orgName: 'Org 1', roles: ['teacher'], status: 'suspended' }],
    });
    expect(hasMembershipDiff(a, b)).toBe(true);
  });

  it('returns true when one side is null', () => {
    const u = buildUser();
    expect(hasMembershipDiff(null, u)).toBe(true);
    expect(hasMembershipDiff(u, null)).toBe(true);
    expect(hasMembershipDiff(null, null)).toBe(false);
  });
});

function CallSignInThenChildren({ children }: { children: ReactNode }) {
  const { signInWithEmail, user } = useAuth();
  const signedInRef = useRef(false);
  useEffect(() => {
    if (signedInRef.current) return;
    signedInRef.current = true;
    void signInWithEmail('a@b.test', 'password123');
  }, [signInWithEmail]);
  return <div>{user ? <>signed-in{children}</> : 'signed-out'}</div>;
}

describe('AuthContext 5-minute polling (LIMITATIONS #28)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    verifyTokenMock.mockReset();
    firebaseSignOutMock.mockClear();
    firebaseAuthState.currentUser = null;
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-calls verifyToken every 5 minutes while signed in', async () => {
    // Bootstrap signed-in user via signInWithEmail.
    verifyTokenMock.mockResolvedValue({
      success: true,
      user: { uid: 'u1', email: 'a@b.test', name: 'A', activeRoles: ['teacher'] },
    });
    firebaseAuthState.currentUser = {
      getIdToken: vi.fn().mockResolvedValue('id-token-polled'),
    };

    render(
      <AuthProvider>
        <CallSignInThenChildren>{null}</CallSignInThenChildren>
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText(/signed-in/)).toBeInTheDocument());

    const callsAfterSignIn = verifyTokenMock.mock.calls.length;

    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
    await waitFor(() => {
      expect(verifyTokenMock.mock.calls.length).toBe(callsAfterSignIn + 1);
    });
    expect(verifyTokenMock).toHaveBeenLastCalledWith('id-token-polled');

    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
    await waitFor(() => {
      expect(verifyTokenMock.mock.calls.length).toBe(callsAfterSignIn + 2);
    });
  });

  it('does not poll when there is no signed-in user', async () => {
    verifyTokenMock.mockResolvedValue({ success: true, user: null });

    render(
      <AuthProvider>
        <div>signed-out-tree</div>
      </AuthProvider>,
    );
    await screen.findByText('signed-out-tree');

    const beforeAdvance = verifyTokenMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60 * 1000); });
    expect(verifyTokenMock.mock.calls.length).toBe(beforeAdvance);
  });

  it('cancels polling after logout', async () => {
    verifyTokenMock.mockResolvedValue({
      success: true,
      user: { uid: 'u1', email: 'a@b.test', name: 'A', activeRoles: ['teacher'] },
    });
    firebaseAuthState.currentUser = {
      getIdToken: vi.fn().mockResolvedValue('id-token-polled'),
    };

    function LogoutHarness() {
      const { signInWithEmail, logout, user } = useAuth();
      const signedInRef = useRef(false);
      useEffect(() => {
        if (signedInRef.current) return;
        signedInRef.current = true;
        void signInWithEmail('a@b.test', 'password123');
      }, [signInWithEmail]);
      return (
        <div>
          <span>{user ? 'in' : 'out'}</span>
          <button onClick={() => void logout()}>logout</button>
        </div>
      );
    }

    render(
      <AuthProvider>
        <LogoutHarness />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('in')).toBeInTheDocument());

    // First poll fires after 5 min — confirm timer is wired up.
    const beforeFirstPoll = verifyTokenMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
    await waitFor(() => {
      expect(verifyTokenMock.mock.calls.length).toBe(beforeFirstPoll + 1);
    });

    // Logout clears user → polling effect cleanup must clear the interval.
    await act(async () => {
      screen.getByText('logout').click();
    });
    await waitFor(() => expect(screen.getByText('out')).toBeInTheDocument());

    const afterLogout = verifyTokenMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60 * 1000); });
    expect(verifyTokenMock.mock.calls.length).toBe(afterLogout);
  });
});

describe('AuthContext — LegacyRoleMigrationModal mount', () => {
  beforeEach(() => {
    verifyTokenMock.mockReset();
    migrateRoleMock.mockReset();
    firebaseAuthState.currentUser = null;
    localStorage.clear();
  });

  function CallSignInOnly() {
    const { signInWithEmail } = useAuth();
    const signedInRef = useRef(false);
    useEffect(() => {
      if (signedInRef.current) return;
      signedInRef.current = true;
      void signInWithEmail('a@b.test', 'password123');
    }, [signInWithEmail]);
    return <div>ready</div>;
  }

  it('mounts the modal when requiresLegacyRolePick is true', async () => {
    verifyTokenMock.mockResolvedValue({
      success: true,
      user: {
        uid: 'u-legacy', email: 'l@x.com', name: 'L',
        requiresLegacyRolePick: true,
        intendedRole: null, onboardingState: null,
      },
    });
    firebaseAuthState.currentUser = {
      getIdToken: vi.fn().mockResolvedValue('id-token-legacy'),
    };
    render(
      <AuthProvider>
        <CallSignInOnly />
      </AuthProvider>,
    );
    await waitFor(() => screen.getByText(/welcome back/i));
  });

  it('does NOT mount the modal when requiresLegacyRolePick is false', async () => {
    verifyTokenMock.mockResolvedValue({
      success: true,
      user: {
        uid: 'u', email: 'x@x.com', name: 'X',
        requiresLegacyRolePick: false,
        intendedRole: 'student',
      },
    });
    firebaseAuthState.currentUser = {
      getIdToken: vi.fn().mockResolvedValue('id-token-normal'),
    };
    render(
      <AuthProvider>
        <CallSignInOnly />
      </AuthProvider>,
    );
    await screen.findByText('ready');
    expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
  });

  it('calls migrateRole then refreshUser when a role is picked, modal unmounts on next verify', async () => {
    // First verify (during signInWithEmail): returns a legacy user.
    // Second verify (refreshUser after migrateRole): returns a non-legacy user.
    verifyTokenMock
      .mockResolvedValueOnce({
        success: true,
        user: {
          uid: 'u-legacy', email: 'l@x.com', name: 'L',
          requiresLegacyRolePick: true,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        user: {
          uid: 'u-legacy', email: 'l@x.com', name: 'L',
          requiresLegacyRolePick: false,
          intendedRole: 'student',
          onboardingState: 'complete',
        },
      });
    migrateRoleMock.mockResolvedValue({
      intendedRole: 'student',
      onboardingState: 'complete',
    });
    firebaseAuthState.currentUser = {
      getIdToken: vi.fn().mockResolvedValue('id-token-legacy'),
    };

    render(
      <AuthProvider>
        <CallSignInOnly />
      </AuthProvider>,
    );

    // Modal is up after sign-in.
    await waitFor(() => screen.getByText(/welcome back/i));

    // Click "Student".
    await act(async () => {
      screen.getByRole('button', { name: /^student$/i }).click();
    });

    await waitFor(() => {
      expect(migrateRoleMock).toHaveBeenCalledWith('student');
    });
    await waitFor(() => {
      expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
    });
  });
});
