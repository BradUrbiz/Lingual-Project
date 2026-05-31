import { useLanguage } from '../../contexts/LanguageContext';
import { Button } from '@/components/ui/button';

interface Minigame {
  id: string;
  name: string;
  description: string;
  logo: string;
  command: string;
}

const MINIGAMES: Minigame[] = [
  {
    id: 'flashcardflip',
    name: 'Flashcard Flip',
    description: 'Test your vocabulary with flashcards from your chat!',
    logo: '/minigamelogos/flashcardfliplogo.png',
    command: '!flashcardflip',
  },
  {
    id: 'wordmatch',
    name: 'Word Match',
    description: 'Match Korean words to their English meanings!',
    logo: '/minigamelogos/wordmatchlogo.png',
    command: '!wordmatch',
  },
  {
    id: 'comingsoon2',
    name: 'Listening Quiz',
    description: 'Coming soon!',
    logo: '',
    command: '',
  },
  {
    id: 'comingsoon3',
    name: 'Sentence Builder',
    description: 'Coming soon!',
    logo: '',
    command: '',
  },
  {
    id: 'comingsoon4',
    name: 'Speed Typing',
    description: 'Coming soon!',
    logo: '',
    command: '',
  },
  {
    id: 'comingsoon5',
    name: 'Grammar Challenge',
    description: 'Coming soon!',
    logo: '',
    command: '',
  },
];

interface ProfileSidebarProps {
  level?: string;
  goals?: string | string[];
  onClearChat: () => void;
  onMinigameSelect?: (command: string) => void;
  aiState?: 'speak' | 'notalk' | 'bruh';
}

const aiImages: Record<string, string> = {
  speak: '/imgs/c-speak.png',
  notalk: '/imgs/c-notalk.png',
  bruh: '/imgs/c-bruh.png',
};

export function ProfileSidebar({
  level,
  goals,
  onClearChat,
  onMinigameSelect,
  aiState = 'notalk',
}: ProfileSidebarProps) {
  // Normalize goals to always be an array or single string display
  const goalsArray = Array.isArray(goals) ? goals : goals ? [goals] : [];
  const { t } = useLanguage();

  const handleMinigameClick = (game: Minigame) => {
    if (game.command && onMinigameSelect) {
      onMinigameSelect(game.command);
    }
  };

  return (
  <div className="flex flex-col h-full gap-3">
    <div className="bg-card rounded-2xl shadow-lg p-4 flex-shrink-0">
      <div className="text-center mb-4">
        <img
          src={aiImages[aiState]}
          alt="Lingu"
          className="size-24 mx-auto object-contain"
        />
      </div>

      {level && (
        <div className="mb-2">
          <h3 className="text-xs font-medium text-text-secondary mb-0.5">
            {t('chat.yourLevel')}
          </h3>
          <p className="text-text font-medium text-sm">{level}</p>
        </div>
      )}

      {goalsArray.length > 0 && (
        <div className="mb-2">
          <h3 className="text-xs font-medium text-text-secondary mb-0.5">
            {t('chat.yourGoals')}
          </h3>
          <div className="flex flex-wrap gap-1">
            {goalsArray.map((goal) => (
              <span
                key={goal}
                className="px-2 py-0.5 bg-gray-100 rounded text-xs text-text"
              >
                {goal}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mb-3">
        <h3 className="text-xs font-medium text-text-secondary mb-0.5">
          {t('chat.tips')}
        </h3>
        <p className="text-xs text-text">{t('chat.tipContent')}</p>
      </div>

      <Button variant="secondary" onClick={onClearChat} className="w-full text-xs py-2">
        {t('chat.clearChat')}
      </Button>
    </div>

    {/* Minigames Box - Separate Card */}
    <div className="bg-card rounded-2xl shadow-lg p-4 flex-1 min-h-0 flex flex-col">
      <h3 className="text-sm font-bold text-gray-900 mb-3 text-center">
        {t('chat.minigames') || 'Minigames'}
      </h3>
      
      {/* Vertical Slider container with visible scrollbar */}
      <div
        className="flex flex-col gap-2 overflow-y-auto flex-1 pr-1 minigame-scroll"
      >
        {MINIGAMES.map((game) => (
          <button
            key={game.id}
            onClick={() => handleMinigameClick(game)}
            disabled={!game.command}
            className={`flex items-center gap-2 p-2 rounded-xl border-2 transition-all duration-200 w-full text-left flex-shrink-0 ${
              game.command
                ? 'border-primary/30 hover:border-primary hover:shadow-lg bg-white cursor-pointer'
                : 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-50'
            }`}
            type="button"
          >
            {/* Logo */}
            <div className="flex-shrink-0 size-10 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden">
              {game.logo ? (
                <img
                  src={game.logo}
                  alt={game.name}
                  className="size-8 object-contain"
                />
              ) : (
                <div className="text-xl text-gray-300">?</div>
              )}
            </div>
            
            {/* Name and Description */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-text truncate">{game.name}</p>
              <p className="text-[10px] text-text-secondary line-clamp-1">{game.description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  </div>
  );
}
