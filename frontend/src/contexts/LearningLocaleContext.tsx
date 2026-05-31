/* eslint-disable react-refresh/only-export-components */
import { createContext, use, useEffect, useMemo, useState, ReactNode } from 'react';
import { getUserProfile } from '@/api/user';
import { useAuth } from '@/hooks/useAuth';
import { DEFAULT_LEARNING_LOCALE } from '@/lib/learningLocales';
import type { LearningLocale } from '@/types';

interface LearningLocaleContextType {
  learningLocale: LearningLocale;
  setLearningLocale: (value: LearningLocale) => void;
  isRTL: boolean;
}

const LearningLocaleContext = createContext<LearningLocaleContextType | null>(null);

const RTL_LEARNING_LOCALES: ReadonlySet<LearningLocale> = new Set<LearningLocale>(['he-IL']);

export function getLearningLocaleDirection(locale: LearningLocale): 'ltr' | 'rtl' {
  return RTL_LEARNING_LOCALES.has(locale) ? 'rtl' : 'ltr';
}

export function LearningLocaleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [learningLocale, setLearningLocale] = useState<LearningLocale>(DEFAULT_LEARNING_LOCALE);

  useEffect(() => {
    // While the email-verification gate is up, /api/user/profile is blocked
    // (403) by design — skip the fetch so the gated window stays quiet. The
    // effect re-runs once the user verifies (the `user` object changes and
    // emailVerificationRequired flips false), loading the real locale then.
    if (!user || user.emailVerificationRequired) return;
    let isActive = true;
    getUserProfile()
      .then((profile) => {
        if (isActive && profile.learningLocale) {
          setLearningLocale(profile.learningLocale);
        }
      })
      .catch((error) => {
        console.error('Failed to load learning locale:', error);
      });
    return () => {
      isActive = false;
    };
  }, [user]);

  const effectiveLocale = user ? learningLocale : DEFAULT_LEARNING_LOCALE;
  const isRTL = RTL_LEARNING_LOCALES.has(effectiveLocale);
  const value = useMemo(
    () => ({
      learningLocale: effectiveLocale,
      setLearningLocale,
      isRTL,
    }),
    [effectiveLocale, isRTL]
  );

  // Keep global browser chrome and public routes LTR. Learning-locale direction
  // is scoped to authenticated app layouts so it cannot leak onto the landing
  // page when a signed-in learner has Hebrew selected. Re-run on locale changes
  // so the root is corrected if any stale session state set it to RTL.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.setAttribute('dir', 'ltr');
  }, [effectiveLocale]);

  return (
    <LearningLocaleContext.Provider value={value}>
      {children}
    </LearningLocaleContext.Provider>
  );
}

export function useLearningLocale() {
  const context = use(LearningLocaleContext);
  if (!context) {
    throw new Error('useLearningLocale must be used within a LearningLocaleProvider');
  }
  return context;
}
