import { m } from 'framer-motion';
import { useLanguage } from '../../contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { Language } from '../../types';

interface LanguageToggleProps {
  className?: string;
}

const languages: { value: Language; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'ko', label: 'KO' },
];

export function LanguageToggle({ className = '' }: LanguageToggleProps) {
  const { lang, setLang } = useLanguage();

  return (
    <div className={cn('flex gap-1 bg-muted p-1 rounded-lg relative', className)}>
      {languages.map(({ value, label }) => (
        <button type="button"
          key={value}
          onClick={() => setLang(value)}
          className={cn(
            'px-3 py-1 rounded-md text-sm font-medium transition-colors relative z-10',
            lang === value ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {lang === value && (
            <m.div
              layoutId="language-indicator"
              className="absolute inset-0 bg-card rounded-md shadow-sm"
              style={{ zIndex: -1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          )}
          {label}
        </button>
      ))}
    </div>
  );
}
