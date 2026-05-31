import { m } from 'framer-motion';
import { useLanguage } from '../../contexts/LanguageContext';
import { cn } from '@/lib/utils';

type Mode = 'text' | 'voice';

interface ModeToggleProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
}

const modes: { value: Mode; labelKey: string }[] = [
  { value: 'text', labelKey: 'chat.textMode' },
  { value: 'voice', labelKey: 'chat.voiceMode' },
];

export function ModeToggle({ mode, onModeChange }: ModeToggleProps) {
  const { t } = useLanguage();

  return (
    <div className="flex gap-1 bg-muted p-1 rounded-lg relative">
      {modes.map(({ value, labelKey }) => (
        <button
          key={value}
          type="button"
          onClick={() => onModeChange(value)}
          className={cn(
            'px-4 py-2 rounded-md text-sm font-medium transition-colors relative z-10',
            mode === value ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {mode === value && (
            <m.div
              layoutId="mode-indicator"
              className="absolute inset-0 bg-card rounded-md shadow-sm"
              style={{ zIndex: -1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          )}
          {t(labelKey)}
        </button>
      ))}
    </div>
  );
}
