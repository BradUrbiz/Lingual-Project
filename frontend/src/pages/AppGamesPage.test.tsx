import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { AppGamesPage } from '@/pages/AppGamesPage';

const learningLocaleState = vi.hoisted(() => ({
  value: 'ko-KR' as 'ko-KR' | 'es-ES' | 'fr-FR' | 'ru-RU' | 'he-IL',
  setLearningLocale: vi.fn(),
  t: (key: string) =>
    ({
      'app.games.listeningQuiz': 'Listening Quiz',
      'app.games.grammarChallenge': 'Grammar Challenge',
      'app.learn.minigames.flashcards': 'Flashcard Flip',
      'app.learn.minigames.wordMatch': 'Word Match',
      'app.games.conversationGames': 'Conversation Games',
    })[key] || '',
}));

const getChatSessionsMock = vi.fn();

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/minigames', () => ({
  FlashcardFlip: () => <div data-testid="flashcard-flip" />,
  GrammarChallenge: () => <div data-testid="grammar-challenge" />,
  ListeningQuiz: () => <div data-testid="listening-quiz" />,
  WordMatch: () => <div data-testid="word-match" />,
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: learningLocaleState.t,
  }),
}));

vi.mock('@/contexts/LearningLocaleContext', () => ({
  useLearningLocale: () => ({
    learningLocale: learningLocaleState.value,
    setLearningLocale: learningLocaleState.setLearningLocale,
  }),
}));

vi.mock('@/api/chat', () => ({
  getChatSessions: (...args: unknown[]) => getChatSessionsMock(...args),
}));

vi.mock('@/api/minigames', () => ({
  saveMinigameAttempt: vi.fn(),
  generateFlashcards: vi.fn(),
}));

describe('AppGamesPage', () => {
  beforeEach(() => {
    getChatSessionsMock.mockReset();
    learningLocaleState.value = 'ko-KR';
  });

  it('shows both curriculum games and chat-based games', async () => {
    getChatSessionsMock.mockResolvedValue([
      {
        id: 'chat-1',
        title: 'Cafe practice',
        created_at: '2026-02-06T00:00:00.000Z',
        updated_at: '2026-02-06T00:00:00.000Z',
        message_count: 12,
      },
    ]);

    render(<AppGamesPage />);

    await waitFor(() => {
      expect(screen.getByText('Listening Quiz')).toBeInTheDocument();
    });

    expect(screen.getByText('Grammar Challenge')).toBeInTheDocument();
    expect(screen.getByText('Flashcard Flip')).toBeInTheDocument();
    expect(screen.getByText('Word Match')).toBeInTheDocument();
  });

  it('loads objective-based games for French learners', async () => {
    learningLocaleState.value = 'fr-FR';
    getChatSessionsMock.mockResolvedValue([
      {
        id: 'chat-1',
        title: 'Cafe practice',
        created_at: '2026-02-06T00:00:00.000Z',
        updated_at: '2026-02-06T00:00:00.000Z',
        message_count: 12,
      },
    ]);

    render(<AppGamesPage />);

    await waitFor(() => {
      expect(screen.getByText('Meeting a host student')).toBeInTheDocument();
    });

    expect(screen.queryByText('No game curriculum available for this locale yet')).not.toBeInTheDocument();
    expect(screen.getByText('Listening Quiz')).toBeInTheDocument();
    expect(screen.getByText('Grammar Challenge')).toBeInTheDocument();
  });

  it('loads objective-based games for Hebrew learners', async () => {
    learningLocaleState.value = 'he-IL';
    getChatSessionsMock.mockResolvedValue([]);

    render(<AppGamesPage />);

    // Scenario unique to the Hebrew curriculum (see curriculum_example_he.json).
    // If the Hebrew JSON fails to import or parse, this waitFor will time out
    // and act as a smoke check that the new locale ships a usable curriculum.
    await waitFor(() => {
      expect(screen.getByText('Meeting a new classmate')).toBeInTheDocument();
    });

    expect(screen.queryByText('No game curriculum available for this locale yet')).not.toBeInTheDocument();
    expect(screen.getByText('Listening Quiz')).toBeInTheDocument();
    expect(screen.getByText('Grammar Challenge')).toBeInTheDocument();
  });
});
