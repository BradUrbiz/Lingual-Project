import { useCallback, useMemo, useState, useEffect } from 'react';
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
  if (typeof value !== 'number') return '—';
  return Math.round(value).toString();
};

const average = (values: Array<number | undefined | null>) => {
  const filtered = values.filter((value): value is number => typeof value === 'number');
  if (!filtered.length) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
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

export function PronunciationPracticePage() {
  const { t } = useLanguage();
  const { learningLocale } = useLearningLocale();
  const { status, error: practiceError, assess } = usePronunciationPractice();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [attempts, setAttempts] = useState<PronunciationAttempt[]>([]);
  const [selectedWordIndex, setSelectedWordIndex] = useState<number>(0);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugPhonemePayload, setDebugPhonemePayload] = useState(false);

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

  const [selectedObjectiveId, setSelectedObjectiveId] = useState<string | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(
    scenarios.length ? scenarios[0].id : null
  );

  const filteredScenarios = useMemo(
    () =>
      selectedObjectiveId
        ? scenarios.filter((scenario) => scenario.objective_id === selectedObjectiveId)
        : scenarios,
    [scenarios, selectedObjectiveId]
  );

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
    return PRONUNCIATION_PROMPTS.filter((prompt) => prompt.locale === learningLocale).map((prompt) => ({
      id: prompt.id,
      objective_id: '',
      text: prompt.text,
    }));
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

  const phonemeLowThreshold = 70;

  useEffect(() => {
    setCurrentIndex(0);
    setAttempts([]);
    setSessionId(null);
    setSelectedWordIndex(0);
    if (curriculumMatchesLocale && scenarios.length) {
      setSelectedObjectiveId(null);
      setSelectedScenarioId(scenarios[0].id);
    } else {
      setSelectedObjectiveId(null);
      setSelectedScenarioId(null);
    }
  }, [learningLocale, curriculumMatchesLocale, scenarios]);

  useEffect(() => {
    setSelectedWordIndex(0);
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
    setAttempts([]);
    setSessionId(null);
  }, []);

  const nextPrompt = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % Math.max(localePrompts.length, 1));
  }, [localePrompts.length]);

  const handlePractice = useCallback(async () => {
    if (!currentPrompt) return;
    setError(null);
    setIsSaving(true);
    try {
      let activeSessionId = sessionId;
      if (!activeSessionId) {
        const session = await createPronunciationSession(learningLocale, {
          promptSetId: selectedScenario?.id,
          objectiveId: selectedScenario?.objective_id,
        });
        activeSessionId = session.sessionId;
        setSessionId(activeSessionId);
      }

      const { attempt, audioBlob } = await assess(
        currentPrompt.text,
        learningLocale,
        currentPrompt.id,
        { debugPhonemePayload }
      );
      let audioUrl: string | undefined;
      if (audioBlob) {
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
      }
      const attemptPayload: PronunciationAttempt = {
        ...attempt,
        sessionId: activeSessionId,
        promptId: currentPrompt.id,
        objectiveId: selectedScenario?.objective_id,
        audioUrl,
      };
      await savePronunciationAttempt(attemptPayload);
      setAttempts((prev) => [{ ...attemptPayload, createdAt: new Date().toISOString() }, ...prev]);
    } catch (err) {
      console.error('Failed to run practice:', err);
      const message =
        err instanceof Error && err.message ? err.message : t('app.practice.error');
      setError(message);
    } finally {
      setIsSaving(false);
    }
  }, [assess, currentPrompt, debugPhonemePayload, learningLocale, sessionId, t, selectedScenario]);

  const isBusy = status !== 'idle' || isSaving;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border-3 border-foreground bg-primary text-primary-foreground shadow-stamp-sm">
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

      <div className="rounded-2xl border-3 border-foreground bg-card p-6 shadow-stamp space-y-6">
        {curriculumMatchesLocale && scenarios.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  {t('app.practice.scenario.label')}
                </p>
                <h2 className="text-lg font-display font-bold text-foreground">
                  {curriculum.title}
                </h2>
              </div>
              <span className="text-xs font-semibold text-muted-foreground">
                {t('app.practice.scenario.count')} · {scenarios.length}
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
                onChange={(event) => {
                  const nextObjectiveId = event.target.value || null;
                  setSelectedObjectiveId(nextObjectiveId);
                  const nextScenarios = nextObjectiveId
                    ? scenarios.filter((scenario) => scenario.objective_id === nextObjectiveId)
                    : scenarios;
                  setSelectedScenarioId(nextScenarios.length ? nextScenarios[0].id : null);
                  setCurrentIndex(0);
                }}
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
                  onClick={() => {
                    setSelectedScenarioId(scenario.id);
                    setSelectedObjectiveId(scenario.objective_id);
                    setCurrentIndex(0);
                  }}
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

            {filteredScenarios.length === 0 && (
              <div className="text-sm text-muted-foreground">
                {t('app.practice.scenario.empty')}
              </div>
            )}

            {selectedScenario && (
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
            )}
          </div>
        )}

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
                onClick={handlePractice}
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
                onClick={nextPrompt}
                disabled={isBusy}
                className="flex min-h-11 items-center gap-2 px-4 rounded-xl border-2 border-border text-muted-foreground font-bold hover:text-foreground hover:border-foreground transition-all"
              >
                <SkipForward size={18} />
                {t('app.practice.next')}
              </button>
            </div>

            <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground select-none">
              <input
                type="checkbox"
                checked={debugPhonemePayload}
                onChange={(event) => setDebugPhonemePayload(event.target.checked)}
                className="h-3.5 w-3.5 rounded border border-border accent-foreground"
              />
              Debug phoneme payload
            </label>
          </div>
        </div>

        {(error || practiceError) && (
          <div className="p-4 rounded-xl border-2 border-destructive/30 bg-destructive/10 text-destructive text-sm">
            {error || practiceError}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-6">
            <div className="bg-secondary/40 border-2 border-border rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-display font-bold text-foreground">
                  {t('app.practice.scores.title')}
                </h3>
                <button
                  type="button"
                  onClick={resetSession}
                  className="text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <RefreshCcw size={12} /> {t('app.practice.retry')}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                {[
                  { label: t('app.practice.scores.accuracy'), value: latestAttempt?.scores.accuracy },
                  { label: t('app.practice.scores.fluency'), value: latestAttempt?.scores.fluency },
                  { label: t('app.practice.scores.completeness'), value: latestAttempt?.scores.completeness },
                  { label: t('app.practice.scores.prosody'), value: latestAttempt?.scores.prosody },
                ].map((item) => (
                  <div key={item.label} className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{item.label}</span>
                    <span className="text-lg font-bold text-foreground">{formatScore(item.value)}</span>
                  </div>
                ))}
              </div>
              {summary && (
                <div className="mt-4 rounded-xl border-2 border-border/80 bg-card p-4 text-sm">
                  <div className="font-semibold text-foreground">{t('app.practice.session.title')}</div>
                  <div className="text-muted-foreground mt-2 space-y-1">
                    <div>
                      {t('app.practice.session.attempts')}: <span className="font-semibold text-foreground">{summary.count}</span>
                    </div>
                    <div>
                      {t('app.practice.session.avgAccuracy')}:{' '}
                      <span className="font-semibold text-foreground">
                        {summary.accuracy ? Math.round(summary.accuracy) : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-card border-2 border-border rounded-2xl p-5 space-y-4">
              <h3 className="text-lg font-display font-bold text-foreground">
                {t('app.practice.recording.title')}
              </h3>
              {!latestAttempt?.audioUrl ? (
                <p className="text-sm text-muted-foreground">{t('app.practice.recording.empty')}</p>
              ) : (
                <audio
                  controls
                  src={latestAttempt.audioUrl}
                  className="w-full"
                  preload="none"
                />
              )}
            </div>

            <div className="bg-card border-2 border-border rounded-2xl p-5 space-y-4">
              <h3 className="text-lg font-display font-bold text-foreground">
                {t('app.practice.words.title')}
              </h3>
              {!latestAttempt?.words?.length ? (
                <p className="text-sm text-muted-foreground">{t('app.practice.words.empty')}</p>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {latestAttempt.words.map((word, index) => {
                      const isSelected = index === selectedWordIndex;
                      return (
                        <button
                          type="button"
                          key={`${word.word}-${index}`}
                          onClick={() => setSelectedWordIndex(index)}
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

                  {selectedWord && (
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

                      <div className="mt-4">
                        <div className="flex items-center justify-between">
                          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                            {t('app.practice.words.phonemes.title')}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {phonemeThresholdLabel}
                          </div>
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
                                  title={
                                    typeof score === 'number'
                                      ? `${label} • ${Math.round(score)}`
                                      : label
                                  }
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
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
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
                          {t('app.practice.scores.accuracy')}: <span className="font-semibold text-foreground">{formatScore(stat.accuracy)}</span>
                        </div>
                        <div>
                          {t('app.practice.scores.fluency')}: <span className="font-semibold text-foreground">{formatScore(stat.fluency)}</span>
                        </div>
                        <div>
                          {t('app.practice.scores.completeness')}: <span className="font-semibold text-foreground">{formatScore(stat.completeness)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
