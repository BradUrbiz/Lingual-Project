import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gamepad2, Headphones, Loader2, Puzzle, MessageSquare } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { clsx } from 'clsx';
import curriculumExampleEs from '@/data/curriculum_example_es.json';
import curriculumExampleFr from '@/data/curriculum_example_fr.json';
import curriculumExampleHe from '@/data/curriculum_example_he.json';
import curriculumExampleKo from '@/data/curriculum_example_ko.json';
import curriculumExampleRu from '@/data/curriculum_example_ru.json';
import curriculumExampleTl from '@/data/curriculum_example_tl.json';
import { useLanguage } from '@/contexts/LanguageContext';
import { useLearningLocale } from '@/contexts/LearningLocaleContext';
import { getChatSessions } from '@/api/chat';
import {
  buildGrammarChallengeQuestions,
  buildListeningQuizQuestions,
  type CurriculumScenarioForMinigames,
  type GrammarChallengeQuestion,
  type ListeningQuizQuestion,
} from '@/lib/minigameContent';
import { FlashcardFlip, GrammarChallenge, ListeningQuiz, WordMatch } from '@/components/minigames';
import type { MinigameCompletionResult } from '@/components/minigames/ListeningQuiz';
import { generateFlashcards, saveMinigameAttempt, type Flashcard } from '@/api/minigames';
import type { ChatSession, LearningLocale, MinigameType } from '@/types';

type CurriculumObjective = {
  id: string;
  title: string;
  skills: string[];
};

type CurriculumScenario = CurriculumScenarioForMinigames & {
  objective_id: string;
  setting: string;
  difficulty: string;
  success_criteria: string[];
};

type Curriculum = {
  curriculum_id: string;
  locale: string;
  title: string;
  objectives: CurriculumObjective[];
  practice_scenarios: CurriculumScenario[];
};

type ActiveGameContext = {
  objectiveId: string;
  scenarioId: string;
  scenarioTitle: string;
};

const curriculaByLocale: Partial<Record<LearningLocale, Curriculum>> = {
  'ko-KR': curriculumExampleKo as Curriculum,
  'es-ES': curriculumExampleEs as Curriculum,
  'fr-FR': curriculumExampleFr as Curriculum,
  'ru-RU': curriculumExampleRu as Curriculum,
  'he-IL': curriculumExampleHe as Curriculum,
  'tl-PH': curriculumExampleTl as Curriculum,
};

export function AppGamesPage() {
  const { t } = useLanguage();
  const { learningLocale } = useLearningLocale();

  const [selectedObjectiveId, setSelectedObjectiveId] = useState<string | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [activeGameContext, setActiveGameContext] = useState<ActiveGameContext | null>(null);

  const [showListeningQuiz, setShowListeningQuiz] = useState(false);
  const [listeningQuestions, setListeningQuestions] = useState<ListeningQuizQuestion[]>([]);
  const [showGrammarChallenge, setShowGrammarChallenge] = useState(false);
  const [grammarQuestions, setGrammarQuestions] = useState<GrammarChallengeQuestion[]>([]);
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [showWordMatch, setShowWordMatch] = useState(false);
  const [wordMatchPairs, setWordMatchPairs] = useState<Flashcard[]>([]);

  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [selectedChatSessionId, setSelectedChatSessionId] = useState<string | null>(null);
  const [loadingChatSessions, setLoadingChatSessions] = useState(true);
  const [loadingFlashcards, setLoadingFlashcards] = useState(false);
  const [loadingWordMatch, setLoadingWordMatch] = useState(false);

  const [savingResult, setSavingResult] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const curriculum = useMemo(() => curriculaByLocale[learningLocale] ?? null, [learningLocale]);
  const objectives = useMemo(
    () => curriculum?.objectives ?? [],
    [curriculum]
  );
  const scenarios = useMemo(
    () => curriculum?.practice_scenarios ?? [],
    [curriculum]
  );

  useEffect(() => {
    if (!objectives.length) {
      setSelectedObjectiveId(null);
      setSelectedScenarioId(null);
      return;
    }
    setSelectedObjectiveId((prev) => {
      const stillValid = prev && objectives.some((objective) => objective.id === prev);
      return stillValid ? prev : objectives[0].id;
    });
  }, [objectives]);

  const filteredScenarios = useMemo(() => {
    if (!selectedObjectiveId) return scenarios;
    return scenarios.filter((scenario) => scenario.objective_id === selectedObjectiveId);
  }, [scenarios, selectedObjectiveId]);

  useEffect(() => {
    if (!filteredScenarios.length) {
      setSelectedScenarioId(null);
      return;
    }
    setSelectedScenarioId((prev) => {
      const stillValid = prev && filteredScenarios.some((scenario) => scenario.id === prev);
      return stillValid ? prev : filteredScenarios[0].id;
    });
  }, [filteredScenarios]);

  useEffect(() => {
    let isActive = true;
    const loadChatSessions = async () => {
      setLoadingChatSessions(true);
      try {
        const sessions = await getChatSessions();
        if (!isActive) return;
        const withMessages = sessions.filter((session) => session.message_count > 0);
        setChatSessions(withMessages);
        setSelectedChatSessionId((prev) => {
          if (prev && withMessages.some((session) => session.id === prev)) {
            return prev;
          }
          return withMessages[0]?.id ?? null;
        });
      } catch (loadError) {
        if (!isActive) return;
        console.error('Failed to load chat sessions:', loadError);
        setError(t('app.games.chatLoadFailed') || 'Failed to load chat sessions');
      } finally {
        if (isActive) setLoadingChatSessions(false);
      }
    };

    void loadChatSessions();
    return () => {
      isActive = false;
    };
  }, [t]);

  const selectedScenario = useMemo(
    () => filteredScenarios.find((scenario) => scenario.id === selectedScenarioId) || null,
    [filteredScenarios, selectedScenarioId]
  );

  const persistAttempt = useCallback(
    async (gameType: MinigameType, result: MinigameCompletionResult) => {
      if (!activeGameContext) return;
      setSavingResult(true);
      setStatusMessage(t('app.games.savingResult') || 'Saving result...');
      try {
        await saveMinigameAttempt({
          gameType,
          locale: learningLocale,
          objectiveId: activeGameContext.objectiveId,
          scenarioId: activeGameContext.scenarioId,
          score: result.score,
          correctAnswers: result.correctAnswers,
          totalQuestions: result.totalQuestions,
          accuracy: Number(((result.correctAnswers / Math.max(result.totalQuestions, 1)) * 100).toFixed(2)),
          durationSeconds: result.durationSeconds,
          metadata: result.metadata,
        });
        setStatusMessage(t('app.games.savedResult') || 'Result saved to progress');
      } catch (saveError) {
        console.error('Failed to save minigame attempt:', saveError);
        setStatusMessage(t('app.games.saveResultFailed') || 'Could not save result');
      } finally {
        setSavingResult(false);
      }
    },
    [activeGameContext, learningLocale, t]
  );

  const launchListeningQuiz = useCallback(() => {
    if (!selectedScenario) return;
    const questions = buildListeningQuizQuestions(selectedScenario, scenarios, 5);
    if (!questions.length) {
      setError(t('app.games.noQuestions') || 'No questions available for this scenario');
      return;
    }
    setError(null);
    setStatusMessage(null);
    setActiveGameContext({
      objectiveId: selectedScenario.objective_id,
      scenarioId: selectedScenario.id,
      scenarioTitle: selectedScenario.title,
    });
    setListeningQuestions(questions);
    setShowListeningQuiz(true);
  }, [scenarios, selectedScenario, t]);

  const launchGrammarChallenge = useCallback(() => {
    if (!selectedScenario) return;
    const questions = buildGrammarChallengeQuestions(selectedScenario, scenarios, 5);
    if (!questions.length) {
      setError(t('app.games.noQuestions') || 'No questions available for this scenario');
      return;
    }
    setError(null);
    setStatusMessage(null);
    setActiveGameContext({
      objectiveId: selectedScenario.objective_id,
      scenarioId: selectedScenario.id,
      scenarioTitle: selectedScenario.title,
    });
    setGrammarQuestions(questions);
    setShowGrammarChallenge(true);
  }, [scenarios, selectedScenario, t]);

  const closeListeningQuiz = () => {
    setShowListeningQuiz(false);
    setActiveGameContext(null);
  };

  const closeGrammarChallenge = () => {
    setShowGrammarChallenge(false);
    setActiveGameContext(null);
  };

  const onListeningComplete = (result: MinigameCompletionResult) => {
    void persistAttempt('listening_quiz', result);
  };

  const onGrammarComplete = (result: MinigameCompletionResult) => {
    void persistAttempt('grammar_challenge', result);
  };

  const launchFlashcardFlip = useCallback(async () => {
    if (!selectedChatSessionId) return;
    setLoadingFlashcards(true);
    setError(null);
    try {
      const cards = await generateFlashcards(selectedChatSessionId);
      setFlashcards(cards);
      setShowFlashcards(true);
    } catch (loadError) {
      console.error('Failed to generate flashcards:', loadError);
      setError(t('app.games.flashcardsFailed') || 'Failed to generate flashcards');
    } finally {
      setLoadingFlashcards(false);
    }
  }, [selectedChatSessionId, t]);

  const launchWordMatch = useCallback(async () => {
    if (!selectedChatSessionId) return;
    setLoadingWordMatch(true);
    setError(null);
    try {
      const cards = await generateFlashcards(selectedChatSessionId);
      setWordMatchPairs(cards.slice(0,6));
      setShowWordMatch(true);
    } catch (loadError) {
      console.error('Failed to generate word match pairs:', loadError);
      setError(t('app.games.wordMatchFailed') || 'Failed to generate word match pairs');
    } finally {
      setLoadingWordMatch(false);
    }
  }, [selectedChatSessionId, t]);

  const surfaceClass = 'rounded-2xl border-3 border-foreground bg-card shadow-stamp';
  const selectClass =
    'h-11 w-full rounded-xl border-2 border-border bg-card px-4 text-sm font-medium text-foreground focus:border-primary focus:outline-none md:w-[420px]';
  const disabledCardClass = 'opacity-55 cursor-not-allowed';

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border-3 border-foreground bg-accent text-accent-foreground shadow-stamp-sm">
          <Gamepad2 size={24} strokeWidth={2.5} />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
            {t('app.dashboard.services') || 'Continue Learning'}
          </p>
          <h1 className="text-2xl font-display font-bold text-foreground">
            {t('app.games.title') || 'Practice Games'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('app.games.subtitle') || 'Select an objective and scenario, then practice through games'}
          </p>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-xl border-2 border-destructive bg-destructive/10 p-4 text-sm font-medium text-destructive"
        >
          {error}
        </div>
      )}

      {statusMessage && (
        <div
          role="status"
          className={clsx(
            'flex items-center gap-2 rounded-xl border-2 p-4 text-sm font-medium',
            savingResult
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-success bg-success/10 text-success'
          )}
        >
          {savingResult ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Gamepad2 className="h-4 w-4" />
          )}
          <span>{statusMessage}</span>
        </div>
      )}

      {!curriculum ? (
        <section className={`${surfaceClass} p-8 text-center`}>
          <p className="text-lg font-display font-bold text-foreground">
            {t('app.games.noCurriculum') || 'No game curriculum available for this locale yet'}
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            {t('app.games.noCurriculumDesc') || 'Try another learning language or continue with conversation games for now'}
          </p>
        </section>
      ) : (
        <>
          <section className={`${surfaceClass} space-y-6 p-6`}>
            <div>
              <label
                htmlFor="games-objective-select"
                className="mb-2 block text-sm font-semibold text-foreground"
              >
                {t('app.games.objectiveLabel') || 'Learning objective'}
              </label>
              <select
                id="games-objective-select"
                value={selectedObjectiveId || ''}
                onChange={(event) => setSelectedObjectiveId(event.target.value)}
                className={selectClass}
              >
                {objectives.map((objective) => (
                  <option key={objective.id} value={objective.id}>
                    {objective.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <h2 className="mb-3 text-sm font-semibold text-foreground">
                {t('app.games.scenarioLabel') || 'Choose a scenario'}
              </h2>
              {filteredScenarios.length ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {filteredScenarios.map((scenario) => (
                    <button
                      type="button"
                      key={scenario.id}
                      onClick={() => setSelectedScenarioId(scenario.id)}
                      className={clsx(
                        'rounded-xl border-2 p-4 text-left transition-all',
                        selectedScenarioId === scenario.id
                          ? 'border-primary bg-primary/10 shadow-stamp-sm'
                          : 'border-border bg-card hover:border-foreground hover:shadow-stamp-sm'
                      )}
                    >
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <p className="font-display font-bold text-foreground">{scenario.title}</p>
                        <span className="rounded-lg border border-border bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground capitalize">
                          {scenario.difficulty}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{scenario.setting}</p>
                      <div className="mt-3 inline-flex rounded-lg border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                        {t('app.games.targetPhrases') || 'Target phrases'}: {scenario.target_phrases.length}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t('app.games.noScenario') || 'No scenarios for this objective yet'}
                </p>
              )}
            </div>

            <div className="border-t-2 border-border pt-6">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-display font-bold text-foreground">
                    {t('app.games.chooseGame') || 'Choose a game'}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {selectedScenario
                      ? `For ${selectedScenario.title}`
                      : (t('app.games.noScenario') || 'No scenarios for this objective yet')}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <button
                type="button"
                onClick={launchListeningQuiz}
                disabled={!selectedScenario}
                className={clsx(
                  'rounded-xl border-2 p-5 text-left transition-all',
                  'border-accent/30 bg-accent/5 hover:bg-accent/10 hover:border-accent hover:shadow-stamp-sm',
                  !selectedScenario && disabledCardClass
                )}
              >
                <div className="mb-3 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent/30 bg-accent/20 text-accent-foreground">
                    <Headphones size={18} strokeWidth={2.5} />
                  </span>
                  <span className="text-lg font-display font-bold text-foreground">
                    {t('app.games.listeningQuiz') || 'Listening Quiz'}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('app.games.listeningQuizDesc') || 'Listen and identify target phrases from the scenario'}
                </p>
              </button>

              <button
                type="button"
                onClick={launchGrammarChallenge}
                disabled={!selectedScenario}
                className={clsx(
                  'rounded-xl border-2 p-5 text-left transition-all',
                  'border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary hover:shadow-stamp-sm',
                  !selectedScenario && disabledCardClass
                )}
              >
                <div className="mb-3 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/20 text-primary">
                    <Puzzle size={18} strokeWidth={2.5} />
                  </span>
                  <span className="text-lg font-display font-bold text-foreground">
                    {t('app.games.grammarChallenge') || 'Grammar Challenge'}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('app.games.grammarChallengeDesc') || 'Fill in missing words and strengthen core language patterns'}
                </p>
              </button>
            </div>
            </div>
          </section>
        </>
      )}

      <section className={`${surfaceClass} p-6`}>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-foreground bg-secondary text-foreground">
            <MessageSquare size={18} strokeWidth={2.5} />
          </div>
          <div>
            <h2 className="text-lg font-display font-bold text-foreground">
              {t('app.games.conversationGames') || 'Conversation Games'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('app.games.conversationGamesDesc') || 'Play chat-based review games from your previous conversations'}
            </p>
          </div>
        </div>

        {loadingChatSessions ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : chatSessions.length === 0 ? (
          <div className="rounded-xl border-2 border-border bg-secondary p-4">
            <p className="text-sm font-semibold text-foreground">
              {t('app.games.noSessions') || 'No conversations yet'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {t('app.games.noSessionsDesc') || 'Start a conversation in chat to unlock these games'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label
                htmlFor="games-chat-session-select"
                className="mb-2 block text-sm font-semibold text-foreground"
              >
                {t('app.games.selectSession') || 'Select a conversation'}
              </label>
              <select
                id="games-chat-session-select"
                value={selectedChatSessionId || ''}
                onChange={(event) => setSelectedChatSessionId(event.target.value)}
                className={selectClass}
              >
                {chatSessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.title} · {session.message_count} {t('app.games.messages') || 'msgs'}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <button
                type="button"
                onClick={launchFlashcardFlip}
                disabled={!selectedChatSessionId || loadingFlashcards}
                className={clsx(
                  'rounded-xl border-2 p-5 text-left transition-all',
                  'border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary hover:shadow-stamp-sm',
                  (!selectedChatSessionId || loadingFlashcards) && disabledCardClass
                )}
              >
                {loadingFlashcards ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <span className="text-sm font-display font-bold text-foreground">
                      {t('app.learn.minigames.loadingFlashcards') || 'Generating flashcards...'}
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/20 text-primary">
                      <Gamepad2 size={18} strokeWidth={2.5} />
                    </div>
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
                type="button"
                onClick={launchWordMatch}
                disabled={!selectedChatSessionId || loadingWordMatch}
                className={clsx(
                  'rounded-xl border-2 p-5 text-left transition-all',
                  'border-accent/30 bg-accent/5 hover:bg-accent/10 hover:border-accent hover:shadow-stamp-sm',
                  (!selectedChatSessionId || loadingWordMatch) && disabledCardClass
                )}
              >
                {loadingWordMatch ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-accent" />
                    <span className="text-sm font-display font-bold text-foreground">
                      {t('app.learn.minigames.loadingWordMatch') || 'Generating word match game...'}
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-accent/30 bg-accent/20 text-accent-foreground">
                      <Puzzle size={18} strokeWidth={2.5} />
                    </div>
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
      </section>

      <AnimatePresence>
        {showListeningQuiz && listeningQuestions.length > 0 && activeGameContext && (
          <ListeningQuiz
            questions={listeningQuestions}
            locale={learningLocale}
            scenarioTitle={activeGameContext.scenarioTitle}
            onClose={closeListeningQuiz}
            onComplete={onListeningComplete}
          />
        )}
        {showGrammarChallenge && grammarQuestions.length > 0 && activeGameContext && (
          <GrammarChallenge
            questions={grammarQuestions}
            scenarioTitle={activeGameContext.scenarioTitle}
            onClose={closeGrammarChallenge}
            onComplete={onGrammarComplete}
          />
        )}
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
