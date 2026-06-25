import type { LearningLocale } from '@/types';
import type { Language } from '@/types';

export type LearningLocaleOption = {
  value: LearningLocale;
  label: string;
  shortLabel: string;
  flag: string;
};

export const LEARNING_LOCALES: LearningLocaleOption[] = [
  { value: 'en-US', label: 'English (US)', shortLabel: 'English', flag: '🇺🇸' },
  { value: 'ko-KR', label: 'Korean (Korea)', shortLabel: 'Korean', flag: '🇰🇷' },
  { value: 'es-ES', label: 'Spanish (Spain)', shortLabel: 'Spanish', flag: '🇪🇸' },
  { value: 'fr-FR', label: 'French (France)', shortLabel: 'French', flag: '🇫🇷' },
  { value: 'ru-RU', label: 'Russian (Russia)', shortLabel: 'Russian', flag: '🇷🇺' },
  { value: 'he-IL', label: 'Hebrew (Israel)', shortLabel: 'Hebrew', flag: '🇮🇱' },
  { value: 'tl-PH', label: 'Tagalog (Philippines)', shortLabel: 'Tagalog', flag: '🇵🇭' },
];

export const DEFAULT_LEARNING_LOCALE: LearningLocale = 'ko-KR';

export function defaultLearningLocaleFor(uiLanguage: Language): LearningLocale {
  return uiLanguage === 'ko' ? 'en-US' : DEFAULT_LEARNING_LOCALE;
}
