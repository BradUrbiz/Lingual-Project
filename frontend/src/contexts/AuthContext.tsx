/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  linkWithPopup,
  unlink,
  AuthProvider as FirebaseAuthProvider,
  User as FirebaseUser,
} from 'firebase/auth';
import { auth, googleProvider, githubProvider, facebookProvider } from '../config/firebase';
import { verifyToken } from '../api/auth';
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
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  linkWithGoogle: () => Promise<void>;
  linkWithGithub: () => Promise<void>;
  linkWithFacebook: () => Promise<void>;
  unlinkProvider: (providerId: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

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

  const signUpWithEmail = async (email: string, password: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      const idToken = await result.user.getIdToken();
      const verifyResult = await verifyToken(idToken);

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

  const signInWithGoogle = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await signInWithPopup(auth, googleProvider);
      const idToken = await result.user.getIdToken();
      const verifyResult = await verifyToken(idToken);

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
