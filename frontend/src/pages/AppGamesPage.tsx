import { useCallback, useEffect, useState } from 'react';
import { Gamepad2, Loader2, MessageSquare } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { clsx } from 'clsx';
import { getChatSessions } from '@/api/chat';
import { generateFlashcards, type Flashcard } from '@/api/minigames';
import { FlashcardFlip, WordMatch } from '@/components/minigames';
import { useLanguage } from '@/contexts/LanguageContext';

export function AppGamesPage() {
  const { t } = useLanguage();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [hasSessions, setHasSessions] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Game state
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [loadingFlashcards, setLoadingFlashcards] = useState(false);
  const [showWordMatch, setShowWordMatch] = useState(false);
  const [wordMatchPairs, setWordMatchPairs] = useState<Flashcard[]>([]);
  const [loadingWordMatch, setLoadingWordMatch] = useState(false);

  useEffect(() => {
    let isActive = true;
    const loadSessions = async () => {
      setLoadingSessions(true);
      try {
        const chatSessions = await getChatSessions();
        if (!isActive) return;
        const withMessages = chatSessions.filter((s) => s.message_count > 0);
        setHasSessions(withMessages.length > 0);
        if (withMessages.length > 0) {
          setSelectedSessionId(withMessages[0].id);
        }
      } catch (err) {
        if (!isActive) return;
        setError(err instanceof Error ? err.message : 'Failed to load sessions');
      } finally {
        if (isActive) setLoadingSessions(false);
      }
    };
    loadSessions();
    return () => { isActive = false; };
  }, []);

  const handleFlashcardGame = useCallback(async () => {
    if (!selectedSessionId) return;
    setLoadingFlashcards(true);
    setError(null);
    try {
      const cards = await generateFlashcards(selectedSessionId);
      setFlashcards(cards);
      setShowFlashcards(true);
    } catch (err) {
      console.error('Failed to generate flashcards:', err);
      setError('Failed to generate flashcards');
    } finally {
      setLoadingFlashcards(false);
    }
  }, [selectedSessionId]);

  const handleWordMatchGame = useCallback(async () => {
    if (!selectedSessionId) return;
    setLoadingWordMatch(true);
    setError(null);
    try {
      const cards = await generateFlashcards(selectedSessionId);
      setWordMatchPairs(cards);
      setShowWordMatch(true);
    } catch (err) {
      console.error('Failed to generate word match pairs:', err);
      setError('Failed to generate word match pairs');
    } finally {
      setLoadingWordMatch(false);
    }
  }, [selectedSessionId]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-accent text-accent-foreground border-2 border-foreground flex items-center justify-center">
          <Gamepad2 size={24} strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">
            {t('app.games.title') || 'Practice Games'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('app.games.subtitle2') || 'Review vocabulary with fun mini-games'}
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl border-2 border-destructive bg-destructive/10 text-sm text-destructive font-medium">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loadingSessions ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !hasSessions ? (
        /* No conversations yet */
        <div className="bg-card rounded-2xl border-3 border-foreground shadow-stamp p-8 text-center">
          <MessageSquare size={40} className="mx-auto text-muted-foreground mb-4" />
          <p className="text-lg font-display font-bold text-foreground">
            {t('app.games.noSessions') || 'No conversations yet'}
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            {t('app.games.noSessionsDesc') || 'Start a conversation first to unlock practice games'}
          </p>
        </div>
      ) : (
        /* Game Selector */
        <div className="bg-card rounded-2xl border-3 border-foreground shadow-stamp p-6">
          <h2 className="text-lg font-display font-bold text-foreground mb-4">
            {t('app.games.chooseGame') || 'Choose a game'}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={handleFlashcardGame}
              disabled={loadingFlashcards}
              className={clsx(
                'p-6 rounded-xl border-2 transition-all text-left',
                'border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary hover:shadow-stamp-sm'
              )}
            >
              <span className="text-3xl mb-3 block">{loadingFlashcards ? '' : '🃏'}</span>
              {loadingFlashcards ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-sm font-display font-bold text-foreground">
                    {t('app.learn.minigames.loadingFlashcards') || 'Generating...'}
                  </span>
                </div>
              ) : (
                <>
                  <span className="text-lg font-display font-bold text-foreground">
                    {t('app.learn.minigames.flashcards') || 'Flashcard Flip'}
                  </span>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t('app.learn.minigames.flashcardsDesc') || 'Review vocabulary from your conversation'}
                  </p>
                </>
              )}
            </button>

            <button
              onClick={handleWordMatchGame}
              disabled={loadingWordMatch}
              className={clsx(
                'p-6 rounded-xl border-2 transition-all text-left',
                'border-accent/30 bg-accent/5 hover:bg-accent/10 hover:border-accent hover:shadow-stamp-sm'
              )}
            >
              <span className="text-3xl mb-3 block">{loadingWordMatch ? '' : '🔗'}</span>
              {loadingWordMatch ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin text-accent" />
                  <span className="text-sm font-display font-bold text-foreground">
                    {t('app.learn.minigames.loadingWordMatch') || 'Generating...'}
                  </span>
                </div>
              ) : (
                <>
                  <span className="text-lg font-display font-bold text-foreground">
                    {t('app.learn.minigames.wordMatch') || 'Word Match'}
                  </span>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t('app.learn.minigames.wordMatchDesc') || 'Match word pairs from your conversation'}
                  </p>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Game Modals */}
      <AnimatePresence>
        {showFlashcards && flashcards.length > 0 && (
          <FlashcardFlip
            flashcards={flashcards}
            onClose={() => setShowFlashcards(false)}
          />
        )}
        {showWordMatch && wordMatchPairs.length > 0 && (
          <WordMatch
            wordPairs={wordMatchPairs}
            onClose={() => setShowWordMatch(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
