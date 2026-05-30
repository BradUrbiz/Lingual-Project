import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';
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

type AppGamesState = {
  selectedObjectiveId: string | null;
  selectedScenarioOverrideId: string | null;
  activeGameContext: ActiveGameContext | null;
  showListeningQuiz: boolean;
  listeningQuestions: ListeningQuizQuestion[];
  showGrammarChallenge: boolean;
  grammarQuestions: GrammarChallengeQuestion[];
  showFlashcards: boolean;
  flashcards: Flashcard[];
  showWordMatch: boolean;
  wordMatchPairs: Flashcard[];
  chatSessions: ChatSession[];
  selectedChatSessionId: string | null;
  loadingChatSessions: boolean;
  loadingFlashcards: boolean;
  loadingWordMatch: boolean;
  savingResult: boolean;
  statusMessage: string | null;
  error: string | null;
};

type AppGamesAction =
  | { type: 'objectives:changed'; objectiveIds: string[] }
  | { type: 'objective:selected'; objectiveId: string }
  | { type: 'scenario:selected'; scenarioId: string }
  | { type: 'chatSessions:loading' }
  | { type: 'chatSessions:loaded'; sessions: ChatSession[] }
  | { type: 'chatSessions:failed'; message: string }
  | { type: 'chatSession:selected'; selectedChatSessionId: string }
  | { type: 'result:saving'; message: string }
  | { type: 'result:saved'; message: string }
  | { type: 'result:saveFailed'; message: string }
  | { type: 'curriculumGame:failed'; message: string }
  | { type: 'listeningQuiz:launched'; context: ActiveGameContext; questions: ListeningQuizQuestion[] }
  | { type: 'grammarChallenge:launched'; context: ActiveGameContext; questions: GrammarChallengeQuestion[] }
  | { type: 'game:closed'; game: 'listening' | 'grammar' | 'flashcards' | 'wordMatch' }
  | { type: 'flashcards:loading' }
  | { type: 'flashcards:loaded'; flashcards: Flashcard[] }
  | { type: 'flashcards:failed'; message: string }
  | { type: 'wordMatch:loading' }
  | { type: 'wordMatch:loaded'; wordMatchPairs: Flashcard[] }
  | { type: 'wordMatch:failed'; message: string };

const curriculaByLocale: Partial<Record<LearningLocale, Curriculum>> = {
  'ko-KR': curriculumExampleKo as Curriculum,
  'es-ES': curriculumExampleEs as Curriculum,
  'fr-FR': curriculumExampleFr as Curriculum,
  'ru-RU': curriculumExampleRu as Curriculum,
  'he-IL': curriculumExampleHe as Curriculum,
  'tl-PH': curriculumExampleTl as Curriculum,
};

const SURFACE_CLASS = 'rounded-2xl border-3 border-foreground bg-card shadow-stamp';
const SELECT_CLASS =
  'h-11 w-full rounded-xl border-2 border-border bg-card px-4 text-sm font-medium text-foreground focus:border-primary focus:outline-none md:w-[420px]';
const DISABLED_CARD_CLASS = 'opacity-55 cursor-not-allowed';

const INITIAL_APP_GAMES_STATE: AppGamesState = {
  selectedObjectiveId: null,
  selectedScenarioOverrideId: null,
  activeGameContext: null,
  showListeningQuiz: false,
  listeningQuestions: [],
  showGrammarChallenge: false,
  grammarQuestions: [],
  showFlashcards: false,
  flashcards: [],
  showWordMatch: false,
  wordMatchPairs: [],
  chatSessions: [],
  selectedChatSessionId: null,
  loadingChatSessions: true,
  loadingFlashcards: false,
  loadingWordMatch: false,
  savingResult: false,
  statusMessage: null,
  error: null,
};

function appGamesReducer(state: AppGamesState, action: AppGamesAction): AppGamesState {
  switch (action.type) {
    case 'objectives:changed': {
      if (!action.objectiveIds.length) {
        return { ...state, selectedObjectiveId: null, selectedScenarioOverrideId: null };
      }
      const stillValid =
        state.selectedObjectiveId && action.objectiveIds.includes(state.selectedObjectiveId);
      return {
        ...state,
        selectedObjectiveId: stillValid ? state.selectedObjectiveId : action.objectiveIds[0],
        selectedScenarioOverrideId: stillValid ? state.selectedScenarioOverrideId : null,
      };
    }
    case 'objective:selected':
      return {
        ...state,
        selectedObjectiveId: action.objectiveId,
        selectedScenarioOverrideId: null,
      };
    case 'scenario:selected':
      return { ...state, selectedScenarioOverrideId: action.scenarioId };
    case 'chatSessions:loading':
      return { ...state, loadingChatSessions: true };
    case 'chatSessions:loaded': {
      const selectedChatSessionId =
        state.selectedChatSessionId &&
        action.sessions.some((session) => session.id === state.selectedChatSessionId)
          ? state.selectedChatSessionId
          : action.sessions[0]?.id ?? null;
      return {
        ...state,
        chatSessions: action.sessions,
        selectedChatSessionId,
        loadingChatSessions: false,
      };
    }
    case 'chatSessions:failed':
      return { ...state, error: action.message, loadingChatSessions: false };
    case 'chatSession:selected':
      return { ...state, selectedChatSessionId: action.selectedChatSessionId };
    case 'result:saving':
      return { ...state, savingResult: true, statusMessage: action.message };
    case 'result:saved':
      return { ...state, savingResult: false, statusMessage: action.message };
    case 'result:saveFailed':
      return { ...state, savingResult: false, statusMessage: action.message };
    case 'curriculumGame:failed':
      return { ...state, error: action.message };
    case 'listeningQuiz:launched':
      return {
        ...state,
        activeGameContext: action.context,
        error: null,
        listeningQuestions: action.questions,
        showListeningQuiz: true,
        statusMessage: null,
      };
    case 'grammarChallenge:launched':
      return {
        ...state,
        activeGameContext: action.context,
        error: null,
        grammarQuestions: action.questions,
        showGrammarChallenge: true,
        statusMessage: null,
      };
    case 'game:closed':
      return closeGame(state, action.game);
    case 'flashcards:loading':
      return { ...state, loadingFlashcards: true, error: null };
    case 'flashcards:loaded':
      return {
        ...state,
        flashcards: action.flashcards,
        showFlashcards: true,
        loadingFlashcards: false,
      };
    case 'flashcards:failed':
      return { ...state, error: action.message, loadingFlashcards: false };
    case 'wordMatch:loading':
      return { ...state, loadingWordMatch: true, error: null };
    case 'wordMatch:loaded':
      return {
        ...state,
        wordMatchPairs: action.wordMatchPairs,
        showWordMatch: true,
        loadingWordMatch: false,
      };
    case 'wordMatch:failed':
      return { ...state, error: action.message, loadingWordMatch: false };
    default:
      return state;
  }
}

function closeGame(state: AppGamesState, game: 'listening' | 'grammar' | 'flashcards' | 'wordMatch') {
  switch (game) {
    case 'listening':
      return { ...state, showListeningQuiz: false, activeGameContext: null };
    case 'grammar':
      return { ...state, showGrammarChallenge: false, activeGameContext: null };
    case 'flashcards':
      return { ...state, showFlashcards: false };
    case 'wordMatch':
      return { ...state, showWordMatch: false };
    default:
      return state;
  }
}

export function AppGamesPage() {
  const { t } = useLanguage();
  const { learningLocale } = useLearningLocale();
  const [state, dispatch] = useReducer(appGamesReducer, INITIAL_APP_GAMES_STATE);

  const curriculum = useMemo(() => curriculaByLocale[learningLocale] ?? null, [learningLocale]);
  const objectives = useMemo(() => curriculum?.objectives ?? [], [curriculum]);
  const scenarios = useMemo(() => curriculum?.practice_scenarios ?? [], [curriculum]);

  useEffect(() => {
    dispatch({
      type: 'objectives:changed',
      objectiveIds: objectives.map((objective) => objective.id),
    });
  }, [objectives]);

  const filteredScenarios = useMemo(() => {
    if (!state.selectedObjectiveId) return scenarios;
    return scenarios.filter((scenario) => scenario.objective_id === state.selectedObjectiveId);
  }, [scenarios, state.selectedObjectiveId]);

  const selectedScenarioId = useMemo(() => {
    if (!filteredScenarios.length) return null;
    const overrideIsValid =
      state.selectedScenarioOverrideId &&
      filteredScenarios.some((scenario) => scenario.id === state.selectedScenarioOverrideId);
    return overrideIsValid ? state.selectedScenarioOverrideId : filteredScenarios[0].id;
  }, [filteredScenarios, state.selectedScenarioOverrideId]);

  useEffect(() => {
    let isActive = true;
    const loadChatSessions = async () => {
      dispatch({ type: 'chatSessions:loading' });
      try {
        const sessions = await getChatSessions();
        if (!isActive) return;
        dispatch({
          type: 'chatSessions:loaded',
          sessions: sessions.filter((session) => session.message_count > 0),
        });
      } catch (loadError) {
        if (!isActive) return;
        console.error('Failed to load chat sessions:', loadError);
        dispatch({
          type: 'chatSessions:failed',
          message: t('app.games.chatLoadFailed') || 'Failed to load chat sessions',
        });
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
      if (!state.activeGameContext) return;
      dispatch({
        type: 'result:saving',
        message: t('app.games.savingResult') || 'Saving result...',
      });
      try {
        await saveMinigameAttempt({
          gameType,
          locale: learningLocale,
          objectiveId: state.activeGameContext.objectiveId,
          scenarioId: state.activeGameContext.scenarioId,
          score: result.score,
          correctAnswers: result.correctAnswers,
          totalQuestions: result.totalQuestions,
          accuracy: Number(((result.correctAnswers / Math.max(result.totalQuestions, 1)) * 100).toFixed(2)),
          durationSeconds: result.durationSeconds,
          metadata: result.metadata,
        });
        dispatch({ type: 'result:saved', message: t('app.games.savedResult') || 'Result saved to progress' });
      } catch (saveError) {
        console.error('Failed to save minigame attempt:', saveError);
        dispatch({
          type: 'result:saveFailed',
          message: t('app.games.saveResultFailed') || 'Could not save result',
        });
      }
    },
    [state.activeGameContext, learningLocale, t]
  );

  const launchListeningQuiz = useCallback(() => {
    if (!selectedScenario) return;
    const questions = buildListeningQuizQuestions(selectedScenario, scenarios, 5);
    if (!questions.length) {
      dispatch({
        type: 'curriculumGame:failed',
        message: t('app.games.noQuestions') || 'No questions available for this scenario',
      });
      return;
    }
    dispatch({
      type: 'listeningQuiz:launched',
      context: buildActiveGameContext(selectedScenario),
      questions,
    });
  }, [scenarios, selectedScenario, t]);

  const launchGrammarChallenge = useCallback(() => {
    if (!selectedScenario) return;
    const questions = buildGrammarChallengeQuestions(selectedScenario, scenarios, 5);
    if (!questions.length) {
      dispatch({
        type: 'curriculumGame:failed',
        message: t('app.games.noQuestions') || 'No questions available for this scenario',
      });
      return;
    }
    dispatch({
      type: 'grammarChallenge:launched',
      context: buildActiveGameContext(selectedScenario),
      questions,
    });
  }, [scenarios, selectedScenario, t]);

  const launchFlashcardFlip = useCallback(async () => {
    if (!state.selectedChatSessionId) return;
    dispatch({ type: 'flashcards:loading' });
    try {
      const cards = await generateFlashcards(state.selectedChatSessionId);
      dispatch({ type: 'flashcards:loaded', flashcards: cards });
    } catch (loadError) {
      console.error('Failed to generate flashcards:', loadError);
      dispatch({
        type: 'flashcards:failed',
        message: t('app.games.flashcardsFailed') || 'Failed to generate flashcards',
      });
    }
  }, [state.selectedChatSessionId, t]);

  const launchWordMatch = useCallback(async () => {
    if (!state.selectedChatSessionId) return;
    dispatch({ type: 'wordMatch:loading' });
    try {
      const cards = await generateFlashcards(state.selectedChatSessionId);
      dispatch({ type: 'wordMatch:loaded', wordMatchPairs: cards.slice(0, 6) });
    } catch (loadError) {
      console.error('Failed to generate word match pairs:', loadError);
      dispatch({
        type: 'wordMatch:failed',
        message: t('app.games.wordMatchFailed') || 'Failed to generate word match pairs',
      });
    }
  }, [state.selectedChatSessionId, t]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <GamesHeader t={t} />
      <GamesFeedback
        error={state.error}
        savingResult={state.savingResult}
        statusMessage={state.statusMessage}
      />
      <CurriculumGamesSection
        curriculum={curriculum}
        filteredScenarios={filteredScenarios}
        objectives={objectives}
        selectedObjectiveId={state.selectedObjectiveId}
        selectedScenario={selectedScenario}
        selectedScenarioId={selectedScenarioId}
        t={t}
        onLaunchGrammarChallenge={launchGrammarChallenge}
        onLaunchListeningQuiz={launchListeningQuiz}
        onObjectiveChange={(objectiveId) => dispatch({ type: 'objective:selected', objectiveId })}
        onScenarioChange={(scenarioId) => dispatch({ type: 'scenario:selected', scenarioId })}
      />
      <ConversationGamesSection
        chatSessions={state.chatSessions}
        loadingChatSessions={state.loadingChatSessions}
        loadingFlashcards={state.loadingFlashcards}
        loadingWordMatch={state.loadingWordMatch}
        selectedChatSessionId={state.selectedChatSessionId}
        t={t}
        onLaunchFlashcards={launchFlashcardFlip}
        onLaunchWordMatch={launchWordMatch}
        onSelectChatSession={(selectedChatSessionId) =>
          dispatch({ type: 'chatSession:selected', selectedChatSessionId })
        }
      />
      <GameModals
        activeGameContext={state.activeGameContext}
        flashcards={state.flashcards}
        grammarQuestions={state.grammarQuestions}
        learningLocale={learningLocale}
        listeningQuestions={state.listeningQuestions}
        visibility={{
          flashcards: state.showFlashcards,
          grammarChallenge: state.showGrammarChallenge,
          listeningQuiz: state.showListeningQuiz,
          wordMatch: state.showWordMatch,
        }}
        wordMatchPairs={state.wordMatchPairs}
        onCloseFlashcards={() => dispatch({ type: 'game:closed', game: 'flashcards' })}
        onCloseGrammarChallenge={() => dispatch({ type: 'game:closed', game: 'grammar' })}
        onCloseListeningQuiz={() => dispatch({ type: 'game:closed', game: 'listening' })}
        onCloseWordMatch={() => dispatch({ type: 'game:closed', game: 'wordMatch' })}
        onGrammarComplete={(result) => void persistAttempt('grammar_challenge', result)}
        onListeningComplete={(result) => void persistAttempt('listening_quiz', result)}
      />
    </div>
  );
}

function buildActiveGameContext(selectedScenario: CurriculumScenario): ActiveGameContext {
  return {
    objectiveId: selectedScenario.objective_id,
    scenarioId: selectedScenario.id,
    scenarioTitle: selectedScenario.title,
  };
}

type TranslationFn = (key: string) => string;

function GamesHeader({ t }: { t: TranslationFn }) {
  return (
    <header className="flex items-start gap-4">
      <div className="flex size-12 items-center justify-center rounded-xl border-3 border-foreground bg-accent text-accent-foreground shadow-stamp-sm">
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
  );
}

function GamesFeedback({
  error,
  savingResult,
  statusMessage,
}: {
  error: string | null;
  savingResult: boolean;
  statusMessage: string | null;
}) {
  return (
    <>
      {error ? (
        <div
          role="alert"
          className="rounded-xl border-2 border-destructive bg-destructive/10 p-4 text-sm font-medium text-destructive"
        >
          {error}
        </div>
      ) : null}

      {statusMessage ? (
        <output
          className={clsx(
            'flex items-center gap-2 rounded-xl border-2 p-4 text-sm font-medium',
            savingResult
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-success bg-success/10 text-success'
          )}
        >
          {savingResult ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Gamepad2 className="size-4" />
          )}
          <span>{statusMessage}</span>
        </output>
      ) : null}
    </>
  );
}

type CurriculumGamesSectionProps = {
  curriculum: Curriculum | null;
  filteredScenarios: CurriculumScenario[];
  objectives: CurriculumObjective[];
  selectedObjectiveId: string | null;
  selectedScenario: CurriculumScenario | null;
  selectedScenarioId: string | null;
  t: TranslationFn;
  onLaunchGrammarChallenge: () => void;
  onLaunchListeningQuiz: () => void;
  onObjectiveChange: (objectiveId: string) => void;
  onScenarioChange: (scenarioId: string) => void;
};

function CurriculumGamesSection({
  curriculum,
  filteredScenarios,
  objectives,
  selectedObjectiveId,
  selectedScenario,
  selectedScenarioId,
  t,
  onLaunchGrammarChallenge,
  onLaunchListeningQuiz,
  onObjectiveChange,
  onScenarioChange,
}: CurriculumGamesSectionProps) {
  if (!curriculum) {
    return (
      <section className={`${SURFACE_CLASS} p-8 text-center`}>
        <p className="text-lg font-display font-bold text-foreground">
          {t('app.games.noCurriculum') || 'No game curriculum available for this locale yet'}
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          {t('app.games.noCurriculumDesc') || 'Try another learning language or continue with conversation games for now'}
        </p>
      </section>
    );
  }

  return (
    <section className={`${SURFACE_CLASS} space-y-6 p-6`}>
      <ObjectiveSelector
        objectives={objectives}
        selectedObjectiveId={selectedObjectiveId}
        t={t}
        onObjectiveChange={onObjectiveChange}
      />
      <ScenarioGrid
        filteredScenarios={filteredScenarios}
        selectedScenarioId={selectedScenarioId}
        t={t}
        onScenarioChange={onScenarioChange}
      />
      <CurriculumGameCards
        selectedScenario={selectedScenario}
        t={t}
        onLaunchGrammarChallenge={onLaunchGrammarChallenge}
        onLaunchListeningQuiz={onLaunchListeningQuiz}
      />
    </section>
  );
}

function ObjectiveSelector({
  objectives,
  selectedObjectiveId,
  t,
  onObjectiveChange,
}: {
  objectives: CurriculumObjective[];
  selectedObjectiveId: string | null;
  t: TranslationFn;
  onObjectiveChange: (objectiveId: string) => void;
}) {
  return (
    <div>
      <label htmlFor="games-objective-select" className="mb-2 block text-sm font-semibold text-foreground">
        {t('app.games.objectiveLabel') || 'Learning objective'}
      </label>
      <select
        id="games-objective-select"
        value={selectedObjectiveId || ''}
        onChange={(event) => onObjectiveChange(event.target.value)}
        className={SELECT_CLASS}
      >
        {objectives.map((objective) => (
          <option key={objective.id} value={objective.id}>
            {objective.title}
          </option>
        ))}
      </select>
    </div>
  );
}

function ScenarioGrid({
  filteredScenarios,
  selectedScenarioId,
  t,
  onScenarioChange,
}: {
  filteredScenarios: CurriculumScenario[];
  selectedScenarioId: string | null;
  t: TranslationFn;
  onScenarioChange: (scenarioId: string) => void;
}) {
  return (
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
              onClick={() => onScenarioChange(scenario.id)}
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
  );
}

function CurriculumGameCards({
  selectedScenario,
  t,
  onLaunchGrammarChallenge,
  onLaunchListeningQuiz,
}: {
  selectedScenario: CurriculumScenario | null;
  t: TranslationFn;
  onLaunchGrammarChallenge: () => void;
  onLaunchListeningQuiz: () => void;
}) {
  return (
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
        <CurriculumGameCard
          borderClassName="border-accent/30 bg-accent/5 hover:bg-accent/10 hover:border-accent"
          description={t('app.games.listeningQuizDesc') || 'Listen and identify target phrases from the scenario'}
          disabled={!selectedScenario}
          icon={<Headphones size={18} strokeWidth={2.5} />}
          iconClassName="border-accent/30 bg-accent/20 text-accent-foreground"
          title={t('app.games.listeningQuiz') || 'Listening Quiz'}
          onLaunch={onLaunchListeningQuiz}
        />
        <CurriculumGameCard
          borderClassName="border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary"
          description={t('app.games.grammarChallengeDesc') || 'Fill in missing words and strengthen core language patterns'}
          disabled={!selectedScenario}
          icon={<Puzzle size={18} strokeWidth={2.5} />}
          iconClassName="border-primary/30 bg-primary/20 text-primary"
          title={t('app.games.grammarChallenge') || 'Grammar Challenge'}
          onLaunch={onLaunchGrammarChallenge}
        />
      </div>
    </div>
  );
}

type CurriculumGameCardProps = {
  borderClassName: string;
  description: string;
  disabled: boolean;
  icon: ReactNode;
  iconClassName: string;
  title: string;
  onLaunch: () => void;
};

function CurriculumGameCard({
  borderClassName,
  description,
  disabled,
  icon,
  iconClassName,
  title,
  onLaunch,
}: CurriculumGameCardProps) {
  return (
    <button
      type="button"
      onClick={onLaunch}
      disabled={disabled}
      className={clsx(
        'rounded-xl border-2 p-5 text-left transition-all hover:shadow-stamp-sm',
        borderClassName,
        disabled && DISABLED_CARD_CLASS
      )}
    >
      <div className="mb-3 flex items-center gap-3">
        <span className={clsx('flex size-10 items-center justify-center rounded-xl border', iconClassName)}>
          {icon}
        </span>
        <span className="text-lg font-display font-bold text-foreground">{title}</span>
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
    </button>
  );
}

type ConversationGamesSectionProps = {
  chatSessions: ChatSession[];
  loadingChatSessions: boolean;
  loadingFlashcards: boolean;
  loadingWordMatch: boolean;
  selectedChatSessionId: string | null;
  t: TranslationFn;
  onLaunchFlashcards: () => void;
  onLaunchWordMatch: () => void;
  onSelectChatSession: (selectedChatSessionId: string) => void;
};

function ConversationGamesSection({
  chatSessions,
  loadingChatSessions,
  loadingFlashcards,
  loadingWordMatch,
  selectedChatSessionId,
  t,
  onLaunchFlashcards,
  onLaunchWordMatch,
  onSelectChatSession,
}: ConversationGamesSectionProps) {
  return (
    <section className={`${SURFACE_CLASS} p-6`}>
      <div className="mb-4 flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl border-2 border-foreground bg-secondary text-foreground">
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
          <Loader2 className="size-6 animate-spin text-primary" />
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
        <ConversationGameControls
          chatSessions={chatSessions}
          loadingFlashcards={loadingFlashcards}
          loadingWordMatch={loadingWordMatch}
          selectedChatSessionId={selectedChatSessionId}
          t={t}
          onLaunchFlashcards={onLaunchFlashcards}
          onLaunchWordMatch={onLaunchWordMatch}
          onSelectChatSession={onSelectChatSession}
        />
      )}
    </section>
  );
}

function ConversationGameControls({
  chatSessions,
  loadingFlashcards,
  loadingWordMatch,
  selectedChatSessionId,
  t,
  onLaunchFlashcards,
  onLaunchWordMatch,
  onSelectChatSession,
}: {
  chatSessions: ChatSession[];
  loadingFlashcards: boolean;
  loadingWordMatch: boolean;
  selectedChatSessionId: string | null;
  t: TranslationFn;
  onLaunchFlashcards: () => void;
  onLaunchWordMatch: () => void;
  onSelectChatSession: (selectedChatSessionId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="games-chat-session-select" className="mb-2 block text-sm font-semibold text-foreground">
          {t('app.games.selectSession') || 'Select a conversation'}
        </label>
        <select
          id="games-chat-session-select"
          value={selectedChatSessionId || ''}
          onChange={(event) => onSelectChatSession(event.target.value)}
          className={SELECT_CLASS}
        >
          {chatSessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.title} · {session.message_count} {t('app.games.messages') || 'msgs'}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ConversationGameCard
          disabled={!selectedChatSessionId || loadingFlashcards}
          loading={loadingFlashcards}
          loadingLabel={t('app.learn.minigames.loadingFlashcards') || 'Generating flashcards...'}
          icon={<Gamepad2 size={18} strokeWidth={2.5} />}
          iconClassName="border-primary/30 bg-primary/20 text-primary"
          title={t('app.learn.minigames.flashcards') || 'Flashcard Flip'}
          description={t('app.learn.minigames.flashcardsDesc') || 'Review vocabulary from your conversation'}
          borderClassName="border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary"
          onLaunch={onLaunchFlashcards}
        />
        <ConversationGameCard
          disabled={!selectedChatSessionId || loadingWordMatch}
          loading={loadingWordMatch}
          loadingLabel={t('app.learn.minigames.loadingWordMatch') || 'Generating word match game...'}
          icon={<Puzzle size={18} strokeWidth={2.5} />}
          iconClassName="border-accent/30 bg-accent/20 text-accent-foreground"
          title={t('app.learn.minigames.wordMatch') || 'Word Match'}
          description={t('app.learn.minigames.wordMatchDesc') || 'Match word pairs from your conversation'}
          borderClassName="border-accent/30 bg-accent/5 hover:bg-accent/10 hover:border-accent"
          onLaunch={onLaunchWordMatch}
        />
      </div>
    </div>
  );
}

type ConversationGameCardProps = {
  borderClassName: string;
  description: string;
  disabled: boolean;
  icon: ReactNode;
  iconClassName: string;
  loading: boolean;
  loadingLabel: string;
  title: string;
  onLaunch: () => void;
};

function ConversationGameCard({
  borderClassName,
  description,
  disabled,
  icon,
  iconClassName,
  loading,
  loadingLabel,
  title,
  onLaunch,
}: ConversationGameCardProps) {
  return (
    <button
      type="button"
      onClick={onLaunch}
      disabled={disabled}
      className={clsx(
        'rounded-xl border-2 p-5 text-left transition-all hover:shadow-stamp-sm',
        borderClassName,
        disabled && DISABLED_CARD_CLASS
      )}
    >
      {loading ? (
        <div className="flex items-center gap-2">
          <Loader2 className="size-5 animate-spin text-primary" />
          <span className="text-sm font-display font-bold text-foreground">{loadingLabel}</span>
        </div>
      ) : (
        <>
          <div className={clsx('mb-3 flex size-10 items-center justify-center rounded-xl border', iconClassName)}>
            {icon}
          </div>
          <span className="text-lg font-display font-bold text-foreground">{title}</span>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </>
      )}
    </button>
  );
}

type GameModalsProps = {
  activeGameContext: ActiveGameContext | null;
  flashcards: Flashcard[];
  grammarQuestions: GrammarChallengeQuestion[];
  learningLocale: LearningLocale;
  listeningQuestions: ListeningQuizQuestion[];
  visibility: {
    flashcards: boolean;
    grammarChallenge: boolean;
    listeningQuiz: boolean;
    wordMatch: boolean;
  };
  wordMatchPairs: Flashcard[];
  onCloseFlashcards: () => void;
  onCloseGrammarChallenge: () => void;
  onCloseListeningQuiz: () => void;
  onCloseWordMatch: () => void;
  onGrammarComplete: (result: MinigameCompletionResult) => void;
  onListeningComplete: (result: MinigameCompletionResult) => void;
};

function GameModals({
  activeGameContext,
  flashcards,
  grammarQuestions,
  learningLocale,
  listeningQuestions,
  visibility,
  wordMatchPairs,
  onCloseFlashcards,
  onCloseGrammarChallenge,
  onCloseListeningQuiz,
  onCloseWordMatch,
  onGrammarComplete,
  onListeningComplete,
}: GameModalsProps) {
  return (
    <AnimatePresence>
      {visibility.listeningQuiz && listeningQuestions.length > 0 && activeGameContext ? (
        <ListeningQuiz
          questions={listeningQuestions}
          locale={learningLocale}
          scenarioTitle={activeGameContext.scenarioTitle}
          onClose={onCloseListeningQuiz}
          onComplete={onListeningComplete}
        />
      ) : null}
      {visibility.grammarChallenge && grammarQuestions.length > 0 && activeGameContext ? (
        <GrammarChallenge
          questions={grammarQuestions}
          scenarioTitle={activeGameContext.scenarioTitle}
          onClose={onCloseGrammarChallenge}
          onComplete={onGrammarComplete}
        />
      ) : null}
      {visibility.flashcards && flashcards.length > 0 ? (
        <FlashcardFlip flashcards={flashcards} onClose={onCloseFlashcards} />
      ) : null}
      {visibility.wordMatch && wordMatchPairs.length > 0 ? (
        <WordMatch wordPairs={wordMatchPairs} onClose={onCloseWordMatch} />
      ) : null}
    </AnimatePresence>
  );
}
