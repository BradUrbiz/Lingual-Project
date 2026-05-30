/* eslint-disable react-refresh/only-export-components */
import { createContext, use, useCallback, useEffect, useMemo, useReducer, useRef, ReactNode } from 'react';
import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  linkWithPopup,
  unlink,
  AuthProvider as FirebaseAuthProvider,
  User as FirebaseUser,
} from 'firebase/auth';
import { auth, googleProvider, githubProvider, facebookProvider } from '../config/firebase';
import { verifyToken, migrateRole, type AuthRoleOptions, type IntendedRole } from '../api/auth';
import { LegacyRoleMigrationModal } from '@/components/LegacyRoleMigrationModal';
import type { User } from '../types';

interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  loading: boolean;
  error: string | null;
  avatarUrl: string | null;
  updateAvatarUrl: (url: string) => void;
  refreshUser: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (
    email: string,
    password: string,
    options?: AuthRoleOptions,
  ) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  signInWithGoogle: (options?: AuthRoleOptions) => Promise<void>;
  linkWithGoogle: () => Promise<void>;
  linkWithGithub: () => Promise<void>;
  linkWithFacebook: () => Promise<void>;
  unlinkProvider: (providerId: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const getAuthErrorCode = (err: unknown) => {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
};

const getAuthErrorMessage = (err: unknown, fallback: string) => {
  const code = getAuthErrorCode(err);

  switch (code) {
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/missing-email':
      return 'Enter your email address.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'The current password is incorrect.';
    case 'auth/weak-password':
      return 'Use a password with at least 6 characters.';
    case 'auth/requires-recent-login':
      return 'Please sign out and sign back in, then try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    default:
      return err instanceof Error ? err.message : fallback;
  }
};

const POLL_INTERVAL_MS = 5 * 60 * 1000;

type AuthState = {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  loading: boolean;
  error: string | null;
  avatarUrl: string | null;
};

type AuthAction =
  | { type: 'set-user'; user: User | null }
  | { type: 'set-firebase-user'; firebaseUser: FirebaseUser | null }
  | { type: 'set-loading'; loading: boolean }
  | { type: 'set-error'; error: string | null }
  | { type: 'set-avatar-url'; avatarUrl: string | null }
  | { type: 'verify-success'; user: User }
  | { type: 'verify-failed'; error: string }
  | { type: 'maybe-update-membership'; user: User };

const initialAuthState: AuthState = {
  user: null,
  firebaseUser: null,
  loading: true,
  error: null,
  avatarUrl: null,
};

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'set-user':
      return { ...state, user: action.user };
    case 'set-firebase-user':
      return { ...state, firebaseUser: action.firebaseUser };
    case 'set-loading':
      return { ...state, loading: action.loading };
    case 'set-error':
      return { ...state, error: action.error };
    case 'set-avatar-url':
      return { ...state, avatarUrl: action.avatarUrl };
    case 'verify-success':
      return { ...state, user: action.user, error: null };
    case 'verify-failed':
      return { ...state, user: null, error: action.error };
    case 'maybe-update-membership':
      return hasMembershipDiff(state.user, action.user) ? { ...state, user: action.user } : state;
    default:
      return state;
  }
}

export function hasMembershipDiff(prev: User | null, next: User | null): boolean {
  if (!prev || !next) return prev !== next;
  if (prev.lingualAdmin !== next.lingualAdmin) return true;
  const prevRoles = JSON.stringify((prev.activeRoles || []).slice().sort());
  const nextRoles = JSON.stringify((next.activeRoles || []).slice().sort());
  if (prevRoles !== nextRoles) return true;
  const prevMems = JSON.stringify(
    (prev.memberships || [])
      .map((m) => `${m.orgId ?? ''}:${(m.roles || []).slice().sort().join(',')}:${m.status}`)
      .sort(),
  );
  const nextMems = JSON.stringify(
    (next.memberships || [])
      .map((m) => `${m.orgId ?? ''}:${(m.roles || []).slice().sort().join(',')}:${m.status}`)
      .sort(),
  );
  return prevMems !== nextMems;
}

async function verifyE2eUser(): Promise<User | null> {
  const res = await fetch('/api/test/verify', { credentials: 'include' });
  const data = await res.json();
  return data.success && data.user ? data.user as User : null;
}

function useAuthProviderController() {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);
  const { user, firebaseUser, loading, error, avatarUrl } = state;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updateAvatarUrl = useCallback((url: string) => {
    dispatch({ type: 'set-avatar-url', avatarUrl: url });
  }, []);

  const refreshUser = useCallback(async () => {
    const currentUser = auth.currentUser;

    if (!currentUser) {
      dispatch({ type: 'set-user', user: null });
      return;
    }

    const idToken = await currentUser.getIdToken();
    const result = await verifyToken(idToken);

    if (result.success && result.user) {
      dispatch({ type: 'verify-success', user: result.user });
      return;
    }

    dispatch({ type: 'verify-failed', error: result.error || 'Failed to verify token' });
  }, []);

  const handleLegacyRolePick = useCallback(async (role: IntendedRole) => {
    await migrateRole(role);
    // Refresh the user state so `requiresLegacyRolePick` flips to false
    // and the modal unmounts. Errors propagate to the modal's catch.
    await refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    // E2E test bypass: when localStorage has __e2e_uid__, fetch user from the test
    // harness verify endpoint instead of going through Firebase Auth.
    // Only works when the backend has the test harness active (FLASK_ENV=development).
    const e2eUid = localStorage.getItem('__e2e_uid__');
    if (e2eUid) {
      (async () => {
        try {
          const testUser = await verifyE2eUser();
          if (testUser) dispatch({ type: 'set-user', user: testUser });
        } catch {
          // Fall through to normal Firebase auth
        }
        dispatch({ type: 'set-loading', loading: false });
      })();
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      dispatch({ type: 'set-firebase-user', firebaseUser: fbUser });

      if (fbUser) {
        try {
          await refreshUser();
        } catch {
          dispatch({ type: 'verify-failed', error: 'Failed to authenticate' });
        }
      } else {
        dispatch({ type: 'set-user', user: null });
      }

      dispatch({ type: 'set-loading', loading: false });
    });

    return () => unsubscribe();
  }, [refreshUser]);

  // Periodic re-verify so role/membership/suspension changes made by an admin
  // propagate to the active session without requiring sign-out.
  // See LIMITATIONS #28.
  const userId = user?.uid;

  useEffect(() => {
    if (!userId) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const fbUser = auth.currentUser;
        if (!fbUser) return;
        const idToken = await fbUser.getIdToken();
        const result = await verifyToken(idToken);
        if (!result.success || !result.user) return;
        const next = result.user as User;
        dispatch({ type: 'maybe-update-membership', user: next });
      } catch (err) {
        console.warn('[auth] periodic verify failed', err);
      }
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    // We intentionally key only on userId; the effect body uses setUser(prev
    // => …) and reads auth.currentUser directly, so the latest `user` object
    // is not needed inside the interval callback.
  }, [userId]);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    dispatch({ type: 'set-loading', loading: true });
    dispatch({ type: 'set-error', error: null });

    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await result.user.getIdToken();
      const verifyResult = await verifyToken(idToken);

      if (verifyResult.success && verifyResult.user) {
        dispatch({ type: 'set-user', user: verifyResult.user });
      } else {
        throw new Error(verifyResult.error || 'Failed to verify token');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign in failed';
      dispatch({ type: 'set-error', error: message });
      throw err;
    } finally {
      dispatch({ type: 'set-loading', loading: false });
    }
  }, []);

  const signUpWithEmail = useCallback(async (
    email: string,
    password: string,
    options?: AuthRoleOptions,
  ) => {
    dispatch({ type: 'set-loading', loading: true });
    dispatch({ type: 'set-error', error: null });

    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      const idToken = await result.user.getIdToken();
      const verifyResult = await verifyToken(idToken, options);

      if (verifyResult.success && verifyResult.user) {
        dispatch({ type: 'set-user', user: verifyResult.user });
      } else {
        throw new Error(verifyResult.error || 'Failed to verify token');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign up failed';
      dispatch({ type: 'set-error', error: message });
      throw err;
    } finally {
      dispatch({ type: 'set-loading', loading: false });
    }
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    dispatch({ type: 'set-error', error: null });
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      throw new Error('Enter your email address.');
    }

    try {
      await sendPasswordResetEmail(auth, trimmedEmail);
    } catch (err) {
      if (getAuthErrorCode(err) === 'auth/user-not-found') {
        return;
      }

      const message = getAuthErrorMessage(err, 'Failed to send password reset email');
      dispatch({ type: 'set-error', error: message });
      throw new Error(message);
    }
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    dispatch({ type: 'set-error', error: null });

    if (!auth.currentUser) {
      throw new Error('No authenticated user');
    }

    if (!auth.currentUser.email) {
      throw new Error('This account does not have an email address.');
    }

    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
      await updatePassword(auth.currentUser, newPassword);
    } catch (err) {
      const message = getAuthErrorMessage(err, 'Failed to change password');
      dispatch({ type: 'set-error', error: message });
      throw new Error(message);
    }
  }, []);

  const signInWithGoogle = useCallback(async (options?: AuthRoleOptions) => {
    dispatch({ type: 'set-loading', loading: true });
    dispatch({ type: 'set-error', error: null });

    try {
      const result = await signInWithPopup(auth, googleProvider);
      const idToken = await result.user.getIdToken();
      const verifyResult = await verifyToken(idToken, options);

      if (verifyResult.success && verifyResult.user) {
        dispatch({ type: 'set-user', user: verifyResult.user });
      } else {
        throw new Error(verifyResult.error || 'Failed to verify token');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google sign in failed';
      dispatch({ type: 'set-error', error: message });
      throw err;
    } finally {
      dispatch({ type: 'set-loading', loading: false });
    }
  }, []);

  const refreshFirebaseUser = useCallback(async () => {
    if (auth.currentUser) {
      await auth.currentUser.reload();
      dispatch({ type: 'set-firebase-user', firebaseUser: auth.currentUser });
    }
  }, []);

  const linkWithProvider = useCallback(async (provider: FirebaseAuthProvider) => {
    if (!auth.currentUser) {
      throw new Error('No authenticated user');
    }

    await linkWithPopup(auth.currentUser, provider);
    await refreshFirebaseUser();
  }, [refreshFirebaseUser]);

  const linkWithGoogle = useCallback(() => linkWithProvider(googleProvider), [linkWithProvider]);
  const linkWithGithub = useCallback(() => linkWithProvider(githubProvider), [linkWithProvider]);
  const linkWithFacebook = useCallback(() => linkWithProvider(facebookProvider), [linkWithProvider]);

  const unlinkProvider = useCallback(async (providerId: string) => {
    if (!auth.currentUser) {
      throw new Error('No authenticated user');
    }

    await unlink(auth.currentUser, providerId);
    await refreshFirebaseUser();
  }, [refreshFirebaseUser]);

  const logout = useCallback(async () => {
    try {
      await signOut(auth);
      dispatch({ type: 'set-user', user: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Logout failed';
      dispatch({ type: 'set-error', error: message });
    }
  }, []);

  const clearError = useCallback(() => dispatch({ type: 'set-error', error: null }), []);

  const value = useMemo(
    () => ({
      user,
      firebaseUser,
      loading,
      error,
      avatarUrl,
      updateAvatarUrl,
      refreshUser,
      signInWithEmail,
      signUpWithEmail,
      sendPasswordReset,
      changePassword,
      signInWithGoogle,
      linkWithGoogle,
      linkWithGithub,
      linkWithFacebook,
      unlinkProvider,
      logout,
      clearError,
    }),
    [
      user,
      firebaseUser,
      loading,
      error,
      avatarUrl,
      updateAvatarUrl,
      refreshUser,
      signInWithEmail,
      signUpWithEmail,
      sendPasswordReset,
      changePassword,
      signInWithGoogle,
      linkWithGoogle,
      linkWithGithub,
      linkWithFacebook,
      unlinkProvider,
      logout,
      clearError,
    ]
  );

  return {
    value,
    user,
    handleLegacyRolePick,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { value, user, handleLegacyRolePick } = useAuthProviderController();

  return (
    <AuthContext.Provider value={value}>
      {children}
      {user?.requiresLegacyRolePick && (
        <LegacyRoleMigrationModal onPicked={handleLegacyRolePick} />
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = use(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
