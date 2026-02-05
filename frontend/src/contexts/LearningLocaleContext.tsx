/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getUserProfile } from '@/api/user';
import { useAuth } from '@/hooks/useAuth';
import { DEFAULT_LEARNING_LOCALE } from '@/lib/learningLocales';
import type { LearningLocale } from '@/types';

interface LearningLocaleContextType {
  learningLocale: LearningLocale;
  setLearningLocale: (value: LearningLocale) => void;
}

const LearningLocaleContext = createContext<LearningLocaleContextType | null>(null);

export function LearningLocaleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [learningLocale, setLearningLocale] = useState<LearningLocale>(DEFAULT_LEARNING_LOCALE);

  useEffect(() => {
    if (!user) return;
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

  return (
    <LearningLocaleContext.Provider value={{ learningLocale: effectiveLocale, setLearningLocale }}>
      {children}
    </LearningLocaleContext.Provider>
  );
}

export function useLearningLocale() {
  const context = useContext(LearningLocaleContext);
  if (!context) {
    throw new Error('useLearningLocale must be used within a LearningLocaleProvider');
  }
  return context;
}
