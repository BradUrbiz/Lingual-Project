import { useLanguage } from '../../contexts/LanguageContext';
import type { Language } from '../../types';

interface LanguageToggleProps {
  className?: string;
}

export function LanguageToggle({ className = '' }: LanguageToggleProps) {
  const { lang, setLang } = useLanguage();

  const languages: { value: Language; label: string }[] = [
    { value: 'en', label: 'EN' },
    { value: 'ko', label: 'KO' },
  ];

  return (
    <div className={`flex gap-1 ${className}`}>
      {languages.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => setLang(value)}
          className={`px-3 py-1 rounded-md text-sm font-medium transition-all ${
            lang === value
              ? 'bg-primary text-white'
              : 'bg-gray-100 text-text-secondary hover:bg-gray-200'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
