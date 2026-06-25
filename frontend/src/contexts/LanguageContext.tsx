/* eslint-disable react-refresh/only-export-components */
import { createContext, use, useCallback, useEffect, useMemo, useState, ReactNode } from 'react';
import type { Language } from '../types';
import en from '../i18n/en.json';
import ko from '../i18n/ko.json';

type Translations = Record<string, string>;

const translations: Record<Language, Translations> = { en, ko };

const UI_LANG_STORAGE_KEY = 'lingual.uiLanguage';

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | null>(null);

export function LanguageProvider({
  children,
  initialLang,
}: {
  children: ReactNode;
  initialLang?: Language;
}) {
  const [lang, setLangState] = useState<Language>(initialLang ?? 'en');

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    try {
      localStorage.setItem(UI_LANG_STORAGE_KEY, next);
    } catch {
      /* storage unavailable (private mode) — non-fatal */
    }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
    }
  }, [lang]);

  const t = useCallback((key: string): string => {
    return translations[lang][key] || translations.en[key] || key;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = use(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
