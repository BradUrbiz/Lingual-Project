import { useLanguage } from '../../contexts/LanguageContext';
import { Button } from '../common';

interface ProfileSidebarProps {
  level?: string;
  goals?: string[];
  onClearChat: () => void;
  aiState?: 'speak' | 'notalk' | 'bruh';
}

export function ProfileSidebar({
  level,
  goals = [],
  onClearChat,
  aiState = 'notalk',
}: ProfileSidebarProps) {
  const { t } = useLanguage();

  const aiImages: Record<string, string> = {
    speak: '/imgs/c-speak.png',
    notalk: '/imgs/c-notalk.png',
    bruh: '/imgs/c-bruh.png',
  };

  return (
    <div className="bg-card rounded-2xl shadow-lg p-6 h-fit">
      <div className="text-center mb-6">
        <img
          src={aiImages[aiState]}
          alt="Lingu"
          className="w-32 h-32 mx-auto object-contain"
        />
      </div>

      {level && (
        <div className="mb-4">
          <h3 className="text-sm font-medium text-text-secondary mb-1">
            {t('chat.yourLevel')}
          </h3>
          <p className="text-text font-medium">{level}</p>
        </div>
      )}

      {goals.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium text-text-secondary mb-1">
            {t('chat.yourGoals')}
          </h3>
          <div className="flex flex-wrap gap-1">
            {goals.map((goal, index) => (
              <span
                key={index}
                className="px-2 py-1 bg-gray-100 rounded text-sm text-text"
              >
                {goal}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-sm font-medium text-text-secondary mb-1">
          {t('chat.tips')}
        </h3>
        <p className="text-sm text-text">{t('chat.tipContent')}</p>
      </div>

      <Button variant="secondary" onClick={onClearChat} className="w-full text-sm">
        {t('chat.clearChat')}
      </Button>
    </div>
  );
}
