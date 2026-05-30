import { useCallback, useMemo, useReducer, useRef, useEffect } from 'react';
import { Loader2, Mic, RefreshCcw, SkipForward } from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useLearningLocale } from '@/contexts/LearningLocaleContext';
import {
  createPronunciationSession,
  savePronunciationAttempt,
  uploadPronunciationAudio,
} from '@/api/pronunciation';
import { usePronunciationPractice } from '@/hooks/usePronunciationPractice';
import type { PronunciationAttempt } from '@/types';
import { PRONUNCIATION_PROMPTS } from '@/data/pronunciationPrompts';
import curriculumExampleKo from '@/data/curriculum_example_ko.json';

const formatScore = (value?: number | null) => {
  if (typeof value !== 'number') return '-';
  return Math.round(value).toString();
};

const average = (values: Array<number | undefined | null>) => {
  const filtered = values.filter((value): value is number => typeof value === 'number');
  if (!filtered.length) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
};

const createCaptionTrackUrl = (attempt: PronunciationAttempt) => {
  const captionText = attempt.recognizedText || attempt.referenceText;
  const vtt = ['WEBVTT', '', '00:00:00.000 --> 99:59:59.000', captionText].join('\n');
  return `data:text/vtt;charset=utf-8,${encodeURIComponent(vtt)}`;
};

type CurriculumObjective = {
  id: string;
  level_id: string;
  title: string;
  skills: string[];
};

type CurriculumScenario = {
  id: string;
  objective_id: string;
  title: string;
  setting: string;
  roles: string[];
  difficulty: string;
  target_phrases: string[];
  success_criteria: string[];
};

type CurriculumPrompt = {
  id: string;
  objective_id: string;
  text: string;
};

type Curriculum = {
  curriculum_id: string;
  locale: string;
  title: string;
  levels: Array<{ id: string; name: string; description: string }>;
  objectives: CurriculumObjective[];
  practice_scenarios: CurriculumScenario[];
  pronunciation_prompts: CurriculumPrompt[];
};

type PronunciationPageState = {
  currentIndex: number;
  attempts: PronunciationAttempt[];
  selectedWordIndex: number;
  isSaving: boolean;
  error: string | null;
  selectedObjectiveId: string | null;
  selectedScenarioOverrideId: string | null;
};

type PronunciationPageAction =
  | { type: 'resetLocale' }
  | { type: 'resetSession' }
  | { type: 'nextPrompt'; promptCount: number }
  | { type: 'setSelectedWordIndex'; selectedWordIndex: number }
  | { type: 'latestAttemptChanged' }
  | { type: 'setSaving'; isSaving: boolean }
  | { type: 'setError'; error: string | null }
  | { type: 'addAttempt'; attempt: PronunciationAttempt }
  | { type: 'selectObjective'; objectiveId: string | null }
  | { type: 'selectScenario'; scenarioId: string; objectiveId: string };

const INITIAL_PRONUNCIATION_PAGE_STATE: PronunciationPageState = {
  currentIndex: 0,
  attempts: [],
  selectedWordIndex: 0,
  isSaving: false,
  error: null,
  selectedObjectiveId: null,
  selectedScenarioOverrideId: null,
};

function pronunciationPageReducer(
  state: PronunciationPageState,
  action: PronunciationPageAction
): PronunciationPageState {
  switch (action.type) {
    case 'resetLocale':
      return {
        ...state,
        currentIndex: 0,
        attempts: [],
        selectedWordIndex: 0,
        selectedObjectiveId: null,
        selectedScenarioOverrideId: null,
      };
    case 'resetSession':
      return { ...state, attempts: [] };
    case 'nextPrompt':
      return {
        ...state,
        currentIndex: (state.currentIndex + 1) % Math.max(action.promptCount, 1),
      };
    case 'setSelectedWordIndex':
      return { ...state, selectedWordIndex: action.selectedWordIndex };
    case 'latestAttemptChanged':
      return { ...state, selectedWordIndex: 0 };
    case 'setSaving':
      return { ...state, isSaving: action.isSaving };
    case 'setError':
      return { ...state, error: action.error };
    case 'addAttempt':
      return { ...state, attempts: [action.attempt, ...state.attempts] };
    case 'selectObjective':
      return {
        ...state,
        selectedObjectiveId: action.objectiveId,
        selectedScenarioOverrideId: null,
        currentIndex: 0,
      };
    case 'selectScenario':
      return {
        ...state,
        selectedScenarioOverrideId: action.scenarioId,
        selectedObjectiveId: action.objectiveId,
        currentIndex: 0,
      };
    default:
      return state;
  }
}

export function PronunciationPracticePage() {
  const { t } = useLanguage();
  const { learningLocale } = useLearningLocale();
  const { status, error: practiceError, assess } = usePronunciationPractice();
  const sessionIdRef = useRef<string | null>(null);
  const rawAudioStorageAllowedRef = useRef(true);
  const [pageState, dispatch] = useReducer(
    pronunciationPageReducer,
    INITIAL_PRONUNCIATION_PAGE_STATE
  );
  const {
    currentIndex,
    attempts,
    selectedWordIndex,
    isSaving,
    error,
    selectedObjectiveId,
    selectedScenarioOverrideId,
  } = pageState;

  const curriculum = curriculumExampleKo as Curriculum;
  const curriculumMatchesLocale = curriculum.locale === learningLocale;

  const objectivesById = useMemo(() => {
    const map = new Map<string, CurriculumObjective>();
    if (curriculumMatchesLocale) {
      curriculum.objectives.forEach((objective) => map.set(objective.id, objective));
    }
    return map;
  }, [curriculumMatchesLocale, curriculum.objectives]);

  const scenarios = useMemo(
    () => (curriculumMatchesLocale ? curriculum.practice_scenarios : []),
    [curriculumMatchesLocale, curriculum.practice_scenarios]
  );

  const filteredScenarios = useMemo(
    () =>
      selectedObjectiveId
        ? scenarios.filter((scenario) => scenario.objective_id === selectedObjectiveId)
        : scenarios,
    [scenarios, selectedObjectiveId]
  );

  const selectedScenarioId = useMemo(() => {
    if (!filteredScenarios.length) return null;
    const overrideIsValid =
      selectedScenarioOverrideId &&
      filteredScenarios.some((scenario) => scenario.id === selectedScenarioOverrideId);
    return overrideIsValid ? selectedScenarioOverrideId : filteredScenarios[0].id;
  }, [filteredScenarios, selectedScenarioOverrideId]);
  const selectedScenario =
    filteredScenarios.find((scenario) => scenario.id === selectedScenarioId) || null;
  const selectedObjective = selectedScenario
    ? objectivesById.get(selectedScenario.objective_id) || null
    : null;

  const localePrompts = useMemo(() => {
    if (curriculumMatchesLocale) {
      const basePrompts = curriculum.pronunciation_prompts;
      if (selectedObjectiveId) {
        return basePrompts.filter((prompt) => prompt.objective_id === selectedObjectiveId);
      }
      if (selectedScenario) {
        return basePrompts.filter((prompt) => prompt.objective_id === selectedScenario.objective_id);
      }
      return basePrompts;
    }
    return PRONUNCIATION_PROMPTS.reduce<CurriculumPrompt[]>((prompts, prompt) => {
      if (prompt.locale === learningLocale) {
        prompts.push({
          id: prompt.id,
          objective_id: '',
          text: prompt.text,
        });
      }
      return prompts;
    }, []);
  }, [
    curriculumMatchesLocale,
    curriculum.pronunciation_prompts,
    learningLocale,
    selectedScenario,
    selectedObjectiveId,
  ]);

  const currentPrompt = localePrompts[currentIndex % Math.max(localePrompts.length, 1)];
  const latestAttempt = attempts[0];
  const selectedWord = latestAttempt?.words?.[selectedWordIndex] ?? null;
  const latestAttemptCaptionUrl = useMemo(
    () => (latestAttempt ? createCaptionTrackUrl(latestAttempt) : null),
    [latestAttempt],
  );

  const phonemeLowThreshold = 70;

  useEffect(() => {
    sessionIdRef.current = null;
    rawAudioStorageAllowedRef.current = true;
    dispatch({ type: 'resetLocale' });
  }, [learningLocale]);

  useEffect(() => {
    dispatch({ type: 'latestAttemptChanged' });
  }, [latestAttempt?.id]);

  const formatErrorType = useCallback(
    (errorType?: string) => {
      if (!errorType) return t('app.practice.words.errorType.none');
      const normalized = errorType.trim();
      const key = `app.practice.words.errorType.${normalized}` as const;
      const translated = t(key);
      return translated === key ? normalized : translated;
    },
    [t]
  );

  const summary = useMemo(() => {
    if (!attempts.length) return null;
    return {
      count: attempts.length,
      accuracy: average(attempts.map((attempt) => attempt.scores.accuracy)),
      fluency: average(attempts.map((attempt) => attempt.scores.fluency)),
      completeness: average(attempts.map((attempt) => attempt.scores.completeness)),
      prosody: average(attempts.map((attempt) => attempt.scores.prosody)),
    };
  }, [attempts]);

  const objectiveStats = useMemo(() => {
    if (!attempts.length) return [];
    const map = new Map<
      string,
      {
        count: number;
        accuracy: Array<number | undefined | null>;
        fluency: Array<number | undefined | null>;
        completeness: Array<number | undefined | null>;
      }
    >();
    attempts.forEach((attempt) => {
      const objectiveId = attempt.objectiveId || 'unassigned';
      const entry = map.get(objectiveId) || {
        count: 0,
        accuracy: [],
        fluency: [],
        completeness: [],
      };
      entry.count += 1;
      entry.accuracy.push(attempt.scores.accuracy);
      entry.fluency.push(attempt.scores.fluency);
      entry.completeness.push(attempt.scores.completeness);
      map.set(objectiveId, entry);
    });
    return Array.from(map.entries()).map(([objectiveId, stats]) => ({
      objectiveId,
      title:
        objectivesById.get(objectiveId)?.title ||
        (objectiveId === 'unassigned'
          ? t('app.practice.objectives.unassigned')
          : t('app.practice.scenario.objectiveFallback')),
      count: stats.count,
      accuracy: average(stats.accuracy),
      fluency: average(stats.fluency),
      completeness: average(stats.completeness),
    }));
  }, [attempts, objectivesById, t]);

  const phonemeThresholdLabel = (t('app.practice.words.phonemes.threshold') || '{{n}}').replace(
    '{{n}}',
    String(phonemeLowThreshold)
  );
  const fallbackPhonemeLabel = t('app.practice.words.phonemes.fallback') || 'Sound {{n}}';

  const resetSession = useCallback(() => {
    sessionIdRef.current = null;
    dispatch({ type: 'resetSession' });
  }, []);

  const nextPrompt = useCallback(() => {
    dispatch({ type: 'nextPrompt', promptCount: localePrompts.length });
  }, [localePrompts.length]);

  const handlePractice = useCallback(async () => {
    if (!currentPrompt) return;
    dispatch({ type: 'setError', error: null });
    dispatch({ type: 'setSaving', isSaving: true });
    try {
      let activeSessionId = sessionIdRef.current;
      if (!activeSessionId) {
        const session = await createPronunciationSession(learningLocale, {
          promptSetId: selectedScenario?.id,
          objectiveId: selectedScenario?.objective_id,
        });
        activeSessionId = session.sessionId;
        sessionIdRef.current = activeSessionId;
        rawAudioStorageAllowedRef.current = session.session?.rawAudioStorageAllowed !== false;
      }

      const { attempt, audioBlob } = await assess(
        currentPrompt.text,
        learningLocale,
        currentPrompt.id,
      );
      let audioUrl: string | undefined;
      if (audioBlob && rawAudioStorageAllowedRef.current) {
        try {
          audioUrl = await uploadPronunciationAudio({
            sessionId: activeSessionId,
            promptId: currentPrompt.id,
            blob: audioBlob,
          });
          toast.success(t('app.practice.toast.recordingSaved'));
        } catch (uploadError) {
          console.error('Failed to upload pronunciation audio:', uploadError);
        }
      } else if (audioBlob && !rawAudioStorageAllowedRef.current) {
        toast.info('Raw audio retention is disabled for this school context, so the recording was not stored.');
      }
      const attemptPayload: PronunciationAttempt = {
        ...attempt,
        sessionId: activeSessionId,
        promptId: currentPrompt.id,
        objectiveId: selectedScenario?.objective_id,
        audioUrl,
      };
      await savePronunciationAttempt(attemptPayload);
      dispatch({
        type: 'addAttempt',
        attempt: { ...attemptPayload, createdAt: new Date().toISOString() },
      });
    } catch (err) {
      console.error('Failed to run practice:', err);
      const message =
        err instanceof Error && err.message ? err.message : t('app.practice.error');
      dispatch({ type: 'setError', error: message });
    } finally {
      dispatch({ type: 'setSaving', isSaving: false });
    }
  }, [assess, currentPrompt, learningLocale, t, selectedScenario]);

  const isBusy = status !== 'idle' || isSaving;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PronunciationHeader t={t} />

      <div className="rounded-2xl border-3 border-foreground bg-card p-6 shadow-stamp space-y-6">
        {curriculumMatchesLocale && scenarios.length > 0 ? (
          <ScenarioSelector
            curriculum={curriculum}
            filteredScenarios={filteredScenarios}
            scenariosCount={scenarios.length}
            selectedObjective={selectedObjective}
            selectedObjectiveId={selectedObjectiveId}
            selectedScenario={selectedScenario}
            selectedScenarioId={selectedScenarioId}
            t={t}
            onSelectObjective={(objectiveId) => dispatch({ type: 'selectObjective', objectiveId })}
            onSelectScenario={(scenario) => dispatch({
              type: 'selectScenario',
              scenarioId: scenario.id,
              objectiveId: scenario.objective_id,
            })}
          />
        ) : null}

        <PromptControls
          currentPrompt={currentPrompt}
          isBusy={isBusy}
          selectedObjective={selectedObjective}
          status={status}
          t={t}
          onNextPrompt={nextPrompt}
          onPractice={handlePractice}
        />

        <PracticeErrorBanner message={error || practiceError} />

        <PracticeResultsGrid
          fallbackPhonemeLabel={fallbackPhonemeLabel}
          formatErrorType={formatErrorType}
          latestAttempt={latestAttempt}
          latestAttemptCaptionUrl={latestAttemptCaptionUrl}
          objectiveStats={objectiveStats}
          phonemeLowThreshold={phonemeLowThreshold}
          phonemeThresholdLabel={phonemeThresholdLabel}
          selectedWord={selectedWord}
          selectedWordIndex={selectedWordIndex}
          summary={summary}
          t={t}
          onResetSession={resetSession}
          onSelectWord={(selectedWordIndex) => dispatch({
            type: 'setSelectedWordIndex',
            selectedWordIndex,
          })}
        />
      </div>
    </div>
  );
}

type TranslationFn = (key: string) => string;
type PronunciationWord = NonNullable<PronunciationAttempt['words']>[number];
type PracticeSummary = {
  count: number;
  accuracy: number | null;
  fluency: number | null;
  completeness: number | null;
  prosody: number | null;
};
type ObjectiveStat = {
  objectiveId: string;
  title: string;
  count: number;
  accuracy: number | null;
  fluency: number | null;
  completeness: number | null;
};

function PronunciationHeader({ t }: { t: TranslationFn }) {
  return (
    <header className="flex items-start gap-4">
      <div className="flex size-12 items-center justify-center rounded-xl border-3 border-foreground bg-primary text-primary-foreground shadow-stamp-sm">
        <Mic size={24} strokeWidth={2.5} />
      </div>
      <div className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
          {t('app.layout.nav.practice') || 'Pronunciation'}
        </p>
        <h1 className="text-3xl font-display font-bold text-foreground">
          {t('app.practice.title')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('app.practice.subtitle')}
        </p>
      </div>
    </header>
  );
}

type ScenarioSelectorProps = {
  curriculum: Curriculum;
  filteredScenarios: CurriculumScenario[];
  scenariosCount: number;
  selectedObjective: CurriculumObjective | null;
  selectedObjectiveId: string | null;
  selectedScenario: CurriculumScenario | null;
  selectedScenarioId: string | null;
  t: TranslationFn;
  onSelectObjective: (objectiveId: string | null) => void;
  onSelectScenario: (scenario: CurriculumScenario) => void;
};

function ScenarioSelector({
  curriculum,
  filteredScenarios,
  scenariosCount,
  selectedObjective,
  selectedObjectiveId,
  selectedScenario,
  selectedScenarioId,
  t,
  onSelectObjective,
  onSelectScenario,
}: ScenarioSelectorProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            {t('app.practice.scenario.label')}
          </p>
          <h2 className="text-lg font-display font-bold text-foreground">{curriculum.title}</h2>
        </div>
        <span className="text-xs font-semibold text-muted-foreground">
          {t('app.practice.scenario.count')} · {scenariosCount}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor="objective-filter"
          id="objective-filter-label"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {t('app.practice.scenario.objectiveFilter')}
        </label>
        <select
          id="objective-filter"
          aria-labelledby="objective-filter-label"
          value={selectedObjectiveId || ''}
          onChange={(event) => onSelectObjective(event.target.value || null)}
          className="h-11 px-4 rounded-xl border-2 border-border bg-card text-foreground text-sm font-semibold"
        >
          <option value="">{t('app.practice.scenario.objectiveAll')}</option>
          {curriculum.objectives.map((objective) => (
            <option key={objective.id} value={objective.id}>
              {objective.title}
            </option>
          ))}
        </select>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        {filteredScenarios.map((scenario) => (
          <button
            key={scenario.id}
            type="button"
            onClick={() => onSelectScenario(scenario)}
            className={clsx(
              'text-left p-4 rounded-xl border-2 transition-all',
              selectedScenarioId === scenario.id
                ? 'bg-primary text-primary-foreground border-foreground shadow-stamp-sm'
                : 'bg-card border-border hover:border-foreground'
            )}
          >
            <div className="text-sm font-bold">{scenario.title}</div>
            <div className="text-xs opacity-80 mt-1">{scenario.setting}</div>
          </button>
        ))}
      </div>

      {filteredScenarios.length === 0 ? (
        <div className="text-sm text-muted-foreground">{t('app.practice.scenario.empty')}</div>
      ) : null}

      {selectedScenario ? (
        <SelectedScenarioCard
          selectedObjective={selectedObjective}
          selectedScenario={selectedScenario}
          t={t}
        />
      ) : null}
    </div>
  );
}

function SelectedScenarioCard({
  selectedObjective,
  selectedScenario,
  t,
}: {
  selectedObjective: CurriculumObjective | null;
  selectedScenario: CurriculumScenario;
  t: TranslationFn;
}) {
  return (
    <div className="rounded-xl border-2 border-border bg-secondary/40 p-4 text-sm">
      <div className="font-semibold text-foreground">
        {selectedObjective?.title || t('app.practice.scenario.objectiveFallback')}
      </div>
      <div className="text-muted-foreground mt-1">
        {selectedScenario.roles.join(' · ')} · {selectedScenario.difficulty}
      </div>
      {selectedObjective?.skills?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {selectedObjective.skills.map((skill) => (
            <span
              key={skill}
              className="px-2.5 py-1 rounded-lg border border-border text-xs font-semibold text-foreground bg-card"
            >
              {skill}
            </span>
          ))}
        </div>
      ) : null}
      {selectedScenario.target_phrases?.length ? (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('app.practice.scenario.targets')}
          </div>
          <ul className="mt-2 space-y-1 text-foreground">
            {selectedScenario.target_phrases.map((phrase) => (
              <li key={phrase} className="text-sm">
                {phrase}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

type PromptControlsProps = {
  currentPrompt?: CurriculumPrompt;
  isBusy: boolean;
  selectedObjective: CurriculumObjective | null;
  status: string;
  t: TranslationFn;
  onNextPrompt: () => void;
  onPractice: () => void;
};

function PromptControls({
  currentPrompt,
  isBusy,
  selectedObjective,
  status,
  t,
  onNextPrompt,
  onPractice,
}: PromptControlsProps) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          {t('app.practice.promptLabel')}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-display font-bold text-foreground">
            {currentPrompt?.text || ''}
          </h2>
          {selectedObjective?.title ? (
            <span className="px-2.5 py-1 rounded-lg border border-border text-xs font-semibold text-foreground bg-secondary/40">
              {selectedObjective.title}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onPractice}
            disabled={isBusy}
            className={clsx(
              'flex h-11 items-center gap-2 px-5 rounded-xl border-2 border-foreground font-bold shadow-stamp transition-all',
              'bg-primary text-primary-foreground hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_var(--foreground)]',
              'disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none disabled:hover:translate-y-0'
            )}
          >
            {status === 'listening' ? (
              <>
                <Loader2 className="animate-spin" size={18} />
                {t('app.practice.listening')}
              </>
            ) : status === 'processing' ? (
              <>
                <Loader2 className="animate-spin" size={18} />
                {t('app.practice.processing')}
              </>
            ) : (
              <>
                <Mic size={18} />
                {t('app.practice.start')}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onNextPrompt}
            disabled={isBusy}
            className="flex min-h-11 items-center gap-2 px-4 rounded-xl border-2 border-border text-muted-foreground font-bold hover:text-foreground hover:border-foreground transition-all"
          >
            <SkipForward size={18} />
            {t('app.practice.next')}
          </button>
        </div>
      </div>
    </div>
  );
}

function PracticeErrorBanner({ message }: { message?: string | null }) {
  if (!message) return null;

  return (
    <div className="p-4 rounded-xl border-2 border-destructive/30 bg-destructive/10 text-destructive text-sm">
      {message}
    </div>
  );
}

type PracticeResultsGridProps = {
  fallbackPhonemeLabel: string;
  formatErrorType: (errorType?: string) => string;
  latestAttempt?: PronunciationAttempt;
  latestAttemptCaptionUrl: string | null;
  objectiveStats: ObjectiveStat[];
  phonemeLowThreshold: number;
  phonemeThresholdLabel: string;
  selectedWord: PronunciationWord | null;
  selectedWordIndex: number;
  summary: PracticeSummary | null;
  t: TranslationFn;
  onResetSession: () => void;
  onSelectWord: (selectedWordIndex: number) => void;
};

function PracticeResultsGrid({
  fallbackPhonemeLabel,
  formatErrorType,
  latestAttempt,
  latestAttemptCaptionUrl,
  objectiveStats,
  phonemeLowThreshold,
  phonemeThresholdLabel,
  selectedWord,
  selectedWordIndex,
  summary,
  t,
  onResetSession,
  onSelectWord,
}: PracticeResultsGridProps) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-6">
        <ScoresPanel
          latestAttempt={latestAttempt}
          summary={summary}
          t={t}
          onResetSession={onResetSession}
        />
        <RecordingPanel
          latestAttempt={latestAttempt}
          latestAttemptCaptionUrl={latestAttemptCaptionUrl}
          t={t}
        />
        <WordsPanel
          fallbackPhonemeLabel={fallbackPhonemeLabel}
          formatErrorType={formatErrorType}
          latestAttempt={latestAttempt}
          phonemeLowThreshold={phonemeLowThreshold}
          phonemeThresholdLabel={phonemeThresholdLabel}
          selectedWord={selectedWord}
          selectedWordIndex={selectedWordIndex}
          t={t}
          onSelectWord={onSelectWord}
        />
      </div>

      <div className="space-y-6">
        <ObjectiveStatsPanel objectiveStats={objectiveStats} t={t} />
      </div>
    </div>
  );
}

function ScoresPanel({
  latestAttempt,
  summary,
  t,
  onResetSession,
}: {
  latestAttempt?: PronunciationAttempt;
  summary: PracticeSummary | null;
  t: TranslationFn;
  onResetSession: () => void;
}) {
  const scoreItems = [
    { label: t('app.practice.scores.accuracy'), value: latestAttempt?.scores.accuracy },
    { label: t('app.practice.scores.fluency'), value: latestAttempt?.scores.fluency },
    { label: t('app.practice.scores.completeness'), value: latestAttempt?.scores.completeness },
    { label: t('app.practice.scores.prosody'), value: latestAttempt?.scores.prosody },
  ];

  return (
    <div className="bg-secondary/40 border-2 border-border rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-display font-bold text-foreground">
          {t('app.practice.scores.title')}
        </h3>
        <button
          type="button"
          onClick={onResetSession}
          className="text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <RefreshCcw size={12} /> {t('app.practice.retry')}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4 text-sm">
        {scoreItems.map((item) => (
          <div key={item.label} className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{item.label}</span>
            <span className="text-lg font-bold text-foreground">{formatScore(item.value)}</span>
          </div>
        ))}
      </div>
      {summary ? (
        <div className="mt-4 rounded-xl border-2 border-border/80 bg-card p-4 text-sm">
          <div className="font-semibold text-foreground">{t('app.practice.session.title')}</div>
          <div className="text-muted-foreground mt-2 space-y-1">
            <div>
              {t('app.practice.session.attempts')}:{' '}
              <span className="font-semibold text-foreground">{summary.count}</span>
            </div>
            <div>
              {t('app.practice.session.avgAccuracy')}:{' '}
              <span className="font-semibold text-foreground">
                {summary.accuracy ? Math.round(summary.accuracy) : '-'}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RecordingPanel({
  latestAttempt,
  latestAttemptCaptionUrl,
  t,
}: {
  latestAttempt?: PronunciationAttempt;
  latestAttemptCaptionUrl: string | null;
  t: TranslationFn;
}) {
  return (
    <div className="bg-card border-2 border-border rounded-2xl p-5 space-y-4">
      <h3 className="text-lg font-display font-bold text-foreground">
        {t('app.practice.recording.title')}
      </h3>
      {!latestAttempt?.audioUrl ? (
        <p className="text-sm text-muted-foreground">{t('app.practice.recording.empty')}</p>
      ) : (
        <audio
          aria-label={t('app.practice.recording.title')}
          controls
          src={latestAttempt.audioUrl}
          className="w-full"
          preload="none"
        >
          <track
            kind="captions"
            srcLang="en"
            label="Recognized speech"
            src={latestAttemptCaptionUrl ?? undefined}
            default
          />
        </audio>
      )}
    </div>
  );
}

type WordsPanelProps = {
  fallbackPhonemeLabel: string;
  formatErrorType: (errorType?: string) => string;
  latestAttempt?: PronunciationAttempt;
  phonemeLowThreshold: number;
  phonemeThresholdLabel: string;
  selectedWord: PronunciationWord | null;
  selectedWordIndex: number;
  t: TranslationFn;
  onSelectWord: (selectedWordIndex: number) => void;
};

function WordsPanel({
  fallbackPhonemeLabel,
  formatErrorType,
  latestAttempt,
  phonemeLowThreshold,
  phonemeThresholdLabel,
  selectedWord,
  selectedWordIndex,
  t,
  onSelectWord,
}: WordsPanelProps) {
  return (
    <div className="bg-card border-2 border-border rounded-2xl p-5 space-y-4">
      <h3 className="text-lg font-display font-bold text-foreground">
        {t('app.practice.words.title')}
      </h3>
      {!latestAttempt?.words?.length ? (
        <p className="text-sm text-muted-foreground">{t('app.practice.words.empty')}</p>
      ) : (
        <div className="space-y-4">
          <WordButtons
            selectedWordIndex={selectedWordIndex}
            words={latestAttempt.words}
            onSelectWord={onSelectWord}
          />

          {selectedWord ? (
            <SelectedWordPanel
              fallbackPhonemeLabel={fallbackPhonemeLabel}
              formatErrorType={formatErrorType}
              phonemeLowThreshold={phonemeLowThreshold}
              phonemeThresholdLabel={phonemeThresholdLabel}
              selectedWord={selectedWord}
              t={t}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function WordButtons({
  selectedWordIndex,
  words,
  onSelectWord,
}: {
  selectedWordIndex: number;
  words: PronunciationWord[];
  onSelectWord: (selectedWordIndex: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {words.map((word, index) => {
        const isSelected = index === selectedWordIndex;
        return (
          <button
            type="button"
            key={`${word.word}-${index}`}
            onClick={() => onSelectWord(index)}
            aria-label={`${word.word}${isSelected ? ' selected' : ''}`}
            className={clsx(
              'px-3 py-1 rounded-lg border-2 text-sm font-semibold transition-all',
              isSelected
                ? 'border-foreground bg-foreground text-background shadow-stamp'
                : 'border-border text-foreground bg-secondary/40 hover:border-foreground hover:-translate-y-0.5'
            )}
          >
            {word.word}
            {word.accuracy !== undefined ? ` • ${Math.round(word.accuracy)}` : ''}
          </button>
        );
      })}
    </div>
  );
}

type SelectedWordPanelProps = {
  fallbackPhonemeLabel: string;
  formatErrorType: (errorType?: string) => string;
  phonemeLowThreshold: number;
  phonemeThresholdLabel: string;
  selectedWord: PronunciationWord;
  t: TranslationFn;
};

function SelectedWordPanel({
  fallbackPhonemeLabel,
  formatErrorType,
  phonemeLowThreshold,
  phonemeThresholdLabel,
  selectedWord,
  t,
}: SelectedWordPanelProps) {
  return (
    <div className="rounded-2xl border-2 border-border bg-secondary/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            {t('app.practice.words.panelTitle')}
          </div>
          <div className="text-lg font-display font-bold text-foreground">
            {selectedWord.word}
            {selectedWord.accuracy !== undefined ? (
              <span className="ml-2 text-sm font-bold text-muted-foreground">
                {Math.round(selectedWord.accuracy)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            {t('app.practice.words.errorType.label')}
          </span>
          <span className="px-3 py-1 rounded-lg border-2 border-border bg-card text-xs font-bold text-foreground">
            {formatErrorType(selectedWord.errorType)}
          </span>
        </div>
      </div>

      <PhonemeList
        fallbackPhonemeLabel={fallbackPhonemeLabel}
        phonemeLowThreshold={phonemeLowThreshold}
        phonemeThresholdLabel={phonemeThresholdLabel}
        selectedWord={selectedWord}
        t={t}
      />
    </div>
  );
}

function PhonemeList({
  fallbackPhonemeLabel,
  phonemeLowThreshold,
  phonemeThresholdLabel,
  selectedWord,
  t,
}: {
  fallbackPhonemeLabel: string;
  phonemeLowThreshold: number;
  phonemeThresholdLabel: string;
  selectedWord: PronunciationWord;
  t: TranslationFn;
}) {
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          {t('app.practice.words.phonemes.title')}
        </div>
        <div className="text-xs text-muted-foreground">{phonemeThresholdLabel}</div>
      </div>
      {!selectedWord.phonemes?.length ? (
        <p className="mt-2 text-sm text-muted-foreground">{t('app.practice.words.phonemes.empty')}</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {selectedWord.phonemes.map((phoneme, index) => {
            const score = phoneme.accuracy;
            const isLow = typeof score === 'number' && score < phonemeLowThreshold;
            const label =
              phoneme.phoneme ||
              fallbackPhonemeLabel.replace('{{n}}', String(index + 1));
            return (
              <span
                key={`${phoneme.phoneme}-${index}`}
                className={clsx(
                  'px-2.5 py-1 rounded-lg border-2 text-xs font-bold',
                  isLow
                    ? 'border-destructive/30 bg-destructive/10 text-destructive'
                    : 'border-border bg-card text-foreground'
                )}
                title={typeof score === 'number' ? `${label} • ${Math.round(score)}` : label}
              >
                {label}
                {typeof score === 'number' ? (
                  <span className="ml-1.5 text-[11px] opacity-80">{Math.round(score)}</span>
                ) : null}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ObjectiveStatsPanel({
  objectiveStats,
  t,
}: {
  objectiveStats: ObjectiveStat[];
  t: TranslationFn;
}) {
  return (
    <div className="bg-card border-2 border-border rounded-2xl p-5 space-y-4">
      <h3 className="text-lg font-display font-bold text-foreground">
        {t('app.practice.objectives.title')}
      </h3>
      {!objectiveStats.length ? (
        <p className="text-sm text-muted-foreground">{t('app.practice.objectives.empty')}</p>
      ) : (
        <div className="space-y-3">
          {objectiveStats.map((stat) => (
            <div key={stat.objectiveId} className="rounded-xl border-2 border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-foreground">{stat.title}</div>
                <div className="text-xs text-muted-foreground">
                  {t('app.practice.session.attempts')}: {stat.count}
                </div>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-3 text-xs text-muted-foreground">
                <div>
                  {t('app.practice.scores.accuracy')}:{' '}
                  <span className="font-semibold text-foreground">{formatScore(stat.accuracy)}</span>
                </div>
                <div>
                  {t('app.practice.scores.fluency')}:{' '}
                  <span className="font-semibold text-foreground">{formatScore(stat.fluency)}</span>
                </div>
                <div>
                  {t('app.practice.scores.completeness')}:{' '}
                  <span className="font-semibold text-foreground">{formatScore(stat.completeness)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
