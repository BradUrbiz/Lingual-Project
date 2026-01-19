import { useLanguage } from '../../contexts/LanguageContext';

type Mode = 'text' | 'voice';

interface ModeToggleProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
}

export function ModeToggle({ mode, onModeChange }: ModeToggleProps) {
  const { t } = useLanguage();

  return (
    <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
      <button
        onClick={() => onModeChange('text')}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
          mode === 'text'
            ? 'bg-white text-primary shadow-sm'
            : 'text-text-secondary hover:text-text'
        }`}
      >
        {t('chat.textMode')}
      </button>
      <button
        onClick={() => onModeChange('voice')}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
          mode === 'voice'
            ? 'bg-white text-primary shadow-sm'
            : 'text-text-secondary hover:text-text'
        }`}
      >
        {t('chat.voiceMode')}
      </button>
    </div>
  );
}
