/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
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
import { verifyToken, type AuthRoleOptions } from '../api/auth';
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updateAvatarUrl = (url: string) => setAvatarUrl(url);

  const refreshUser = async () => {
    const currentUser = auth.currentUser;

    if (!currentUser) {
      setUser(null);
      return;
    }

    const idToken = await currentUser.getIdToken();
    const result = await verifyToken(idToken);

    if (result.success && result.user) {
      setUser(result.user);
      setError(null);
      return;
    }

    setUser(null);
    setError(result.error || 'Failed to verify token');
  };

  useEffect(() => {
    // E2E test bypass: when localStorage has __e2e_uid__, fetch user from the test
    // harness verify endpoint instead of going through Firebase Auth.
    // Only works when the backend has the test harness active (FLASK_ENV=development).
    const e2eUid = localStorage.getItem('__e2e_uid__');
    if (e2eUid) {
      (async () => {
        try {
          const res = await fetch('/api/test/verify', { credentials: 'include' });
          const data = await res.json();
          if (data.success && data.user) {
            setUser(data.user as User);
          }
        } catch {
          // Fall through to normal Firebase auth
        }
        setLoading(false);
      })();
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);

      if (fbUser) {
        try {
          await refreshUser();
        } catch {
          setError('Failed to authenticate');
          setUser(null);
        }
      } else {
        setUser(null);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Periodic re-verify so role/membership/suspension changes made by an admin
  // propagate to the active session without requiring sign-out.
  // See LIMITATIONS #28.
  useEffect(() => {
    if (!user) {
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
        setUser((prev) => (hasMembershipDiff(prev, next) ? next : prev));
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
    // We intentionally key only on user?.uid; the effect body uses setUser(prev
    // => …) and reads auth.currentUser directly, so the latest `user` object
    // is not needed inside the interval callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  const signInWithEmail = async (email: string, password: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await result.user.getIdToken();
      const verifyResult = await verifyToken(idToken);

      if (verifyResult.success && verifyResult.user) {
        setUser(verifyResult.user);
      } else {
        throw new Error(verifyResult.error || 'Failed to verify token');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign in failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const signUpWithEmail = async (
    email: string,
    password: string,
    options?: AuthRoleOptions,
  ) => {
    setLoading(true);
    setError(null);

    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      const idToken = await result.user.getIdToken();
      const verifyResult = await verifyToken(idToken, options);

      if (verifyResult.success && verifyResult.user) {
        setUser(verifyResult.user);
      } else {
        throw new Error(verifyResult.error || 'Failed to verify token');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign up failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const sendPasswordReset = async (email: string) => {
    setError(null);
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
      setError(message);
      throw new Error(message);
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    setError(null);

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
      setError(message);
      throw new Error(message);
    }
  };

  const signInWithGoogle = async (options?: AuthRoleOptions) => {
    setLoading(true);
    setError(null);

    try {
      const result = await signInWithPopup(auth, googleProvider);
      const idToken = await result.user.getIdToken();
      const verifyResult = await verifyToken(idToken, options);

      if (verifyResult.success && verifyResult.user) {
        setUser(verifyResult.user);
      } else {
        throw new Error(verifyResult.error || 'Failed to verify token');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google sign in failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const refreshFirebaseUser = async () => {
    if (auth.currentUser) {
      await auth.currentUser.reload();
      setFirebaseUser(auth.currentUser);
    }
  };

  const linkWithProvider = async (provider: FirebaseAuthProvider) => {
    if (!auth.currentUser) {
      throw new Error('No authenticated user');
    }

    await linkWithPopup(auth.currentUser, provider);
    await refreshFirebaseUser();
  };

  const linkWithGoogle = () => linkWithProvider(googleProvider);
  const linkWithGithub = () => linkWithProvider(githubProvider);
  const linkWithFacebook = () => linkWithProvider(facebookProvider);

  const unlinkProvider = async (providerId: string) => {
    if (!auth.currentUser) {
      throw new Error('No authenticated user');
    }

    await unlink(auth.currentUser, providerId);
    await refreshFirebaseUser();
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setUser(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Logout failed';
      setError(message);
    }
  };

  const clearError = () => setError(null);

  return (
    <AuthContext.Provider
      value={{
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
