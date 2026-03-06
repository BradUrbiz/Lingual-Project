import { useEffect, useState } from 'react';
import { TrendingUp, Loader2, Gamepad2 } from 'lucide-react';
import { clsx } from 'clsx';
import { getUserProfile } from '@/api/user';
import { getAssessmentResults } from '@/api/assessment';
import { getMinigameSummary } from '@/api/minigames';
import { LearningPathCard } from '@/components/learning';
import type { AssessmentResults, MinigameSummary, UserProfile } from '@/types';
import { useLanguage } from '@/contexts/LanguageContext';

const domainStyles: Record<string, string> = {
  grammar: 'bg-primary',
  vocabulary: 'bg-accent',
  pragmatics: 'bg-success',
  pronunciation: 'bg-foreground',
  interpretive_comprehension: 'bg-primary',
  interpersonal_communication: 'bg-accent',
  presentational_communication: 'bg-success',
  language_control: 'bg-foreground',
};

const domainBadgeStyles: Record<string, string> = {
  grammar: 'bg-primary/10 text-primary border-primary/20',
  vocabulary: 'bg-accent/10 text-accent border-accent/20',
  cultural: 'bg-secondary text-foreground border-border',
  pragmatics: 'bg-success/10 text-success border-success/20',
  pronunciation: 'bg-foreground/10 text-foreground border-foreground/20',
  interpretive_comprehension: 'bg-primary/10 text-primary border-primary/20',
  interpersonal_communication: 'bg-accent/10 text-accent border-accent/20',
  presentational_communication: 'bg-success/10 text-success border-success/20',
  language_control: 'bg-foreground/10 text-foreground border-foreground/20',
};

const scoreWidthClasses: Record<number, string> = {
  0: 'w-0', 1: 'w-[10%]', 2: 'w-[20%]', 3: 'w-[30%]', 4: 'w-[40%]',
  5: 'w-[50%]', 6: 'w-[60%]', 7: 'w-[70%]', 8: 'w-[80%]', 9: 'w-[90%]', 10: 'w-[100%]',
};

const getScoreWidthClass = (score: number) => {
  const rounded = Math.round(score);
  const clamped = Math.min(10, Math.max(0, rounded));
  return scoreWidthClasses[clamped] ?? 'w-0';
};

export function AppProgressPage() {
  const { t } = useLanguage();
  const [assessmentResults, setAssessmentResults] = useState<AssessmentResults | null>(null);
  const [profileSummary, setProfileSummary] = useState<UserProfile | null>(null);
  const [minigameSummary, setMinigameSummary] = useState<MinigameSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    const loadData = async () => {
      setLoading(true);
      try {
        const profile = await getUserProfile();
        if (!isActive) return;
        setProfileSummary(profile);

        if (profile.assessed) {
          try {
            const results = await getAssessmentResults();
            if (!isActive) return;
            setAssessmentResults(results);
          } catch (err) {
            console.error('Failed to load assessment results:', err);
          }
        }

        try {
          const summary = await getMinigameSummary();
          if (!isActive) return;
          setMinigameSummary(summary);
        } catch (err) {
          console.error('Failed to load minigame summary:', err);
        }
      } catch (err) {
        console.error('Failed to load profile summary:', err);
      } finally {
        if (isActive) setLoading(false);
      }
    };

    loadData();
    return () => { isActive = false; };
  }, []);

  const domainEntries = assessmentResults?.domainBands
    ? Object.entries(assessmentResults.domainBands).sort((a, b) => b[1] - a[1])
    : [];
  const levelLabel =
    assessmentResults?.proficiencyLevel ||
    assessmentResults?.actflLevel ||
    assessmentResults?.sklcLevel;
  const topDomain = domainEntries[0] ?? null;

  const getDomainLabel = (domain: string) => {
    const key = `profile.${domain}`;
    const translated = t(key);
    if (translated !== key) return translated;
    return domain.replace(/_/g, ' ');
  };

  const getGameLabel = (gameType: string) => {
    if (gameType === 'listening_quiz') return t('app.games.listeningQuiz') || 'Listening Quiz';
    if (gameType === 'grammar_challenge') return t('app.games.grammarChallenge') || 'Grammar Challenge';
    return gameType;
  };

  const getScoreStatus = (score: number) => {
    if (score >= 8) return t('app.progress.level.strong') || 'Strong';
    if (score >= 5) return t('app.progress.level.developing') || 'Developing';
    return t('app.progress.level.needsPractice') || 'Needs Practice';
  };

  const getScoreStatusClass = (score: number) => {
    if (score >= 8) return 'border-success/35 bg-success/15 text-success';
    if (score >= 5) return 'border-accent/35 bg-accent/20 text-accent-foreground';
    return 'border-destructive/35 bg-destructive/10 text-destructive';
  };

  const surfaceClass = 'rounded-2xl border-3 border-foreground bg-card shadow-stamp';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border-3 border-foreground bg-foreground text-background shadow-stamp-sm">
          <TrendingUp size={24} strokeWidth={2.5} />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
            {t('app.layout.nav.progress') || 'Progress'}
          </p>
          <h1 className="text-2xl font-display font-bold text-foreground">
            {t('app.progress.title') || 'Learning Progress'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('app.progress.subtitle') || 'Track your skills and learning journey'}
          </p>
        </div>
      </header>

      <section className={`${surfaceClass} p-4 sm:p-5`}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border-2 border-border bg-secondary/70 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('app.learn.path.level') || 'Level'}
            </p>
            <p className="mt-1 text-xl font-display font-bold text-foreground">
              {levelLabel || '—'}
            </p>
          </div>
          <div className="rounded-xl border-2 border-border bg-secondary/70 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('app.progress.domainBreakdown') || 'Skill Breakdown'}
            </p>
            <p className="mt-1 text-xl font-display font-bold text-foreground">
              {domainEntries.length}
            </p>
          </div>
          <div className="rounded-xl border-2 border-border bg-secondary/70 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('app.learn.chat.badges.strength') || 'Top strength'}
            </p>
            <p className="mt-1 truncate text-base font-semibold text-foreground">
              {topDomain ? getDomainLabel(topDomain[0]) : '—'}
            </p>
          </div>
          <div className="rounded-xl border-2 border-border bg-secondary/70 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('app.progress.minigames.attempts') || 'Attempts'}
            </p>
            <p className="mt-1 text-xl font-display font-bold text-foreground">
              {minigameSummary?.totalAttempts ?? 0}
            </p>
          </div>
        </div>
      </section>

      {/* Learning Path Card (shared component) */}
      <LearningPathCard
        assessmentResults={assessmentResults}
        profileSummary={profileSummary}
        t={t}
      />

      {/* Detailed Domain Breakdown */}
      {domainEntries.length > 0 ? (
        <section className={`${surfaceClass} p-6`}>
          <h2 className="mb-5 text-lg font-display font-bold text-foreground">
            {t('app.progress.domainBreakdown') || 'Skill Breakdown'}
          </h2>
          <div className="space-y-3">
            {domainEntries.map(([domain, score]) => (
              <div key={domain} className="rounded-xl border-2 border-border bg-secondary/50 p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="truncate font-display font-bold text-foreground capitalize">
                      {getDomainLabel(domain)}
                    </span>
                    <span className={clsx(
                      'rounded-lg border px-2.5 py-1 text-xs font-bold',
                      domainBadgeStyles[domain] || 'bg-secondary text-muted-foreground border-border'
                    )}>
                      {score}/10
                    </span>
                  </div>
                  <span className={clsx(
                    'rounded-lg border px-2.5 py-1 text-[11px] font-semibold',
                    getScoreStatusClass(score)
                  )}>
                    {getScoreStatus(score)}
                  </span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-lg border border-border bg-card">
                  <div
                    className={clsx(
                      'h-full rounded-lg transition-all duration-300',
                      domainStyles[domain] || 'bg-muted-foreground',
                      getScoreWidthClass(score)
                    )}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className={`${surfaceClass} p-6`}>
          <h2 className="mb-2 text-lg font-display font-bold text-foreground">
            {t('app.progress.domainBreakdown') || 'Skill Breakdown'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('app.progress.comingSoon') || 'More coming soon'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('app.progress.comingSoonDesc') || 'Curriculum progress, streak calendar, and learning analytics will appear here'}
          </p>
        </section>
      )}

      {/* Minigame Performance */}
      <section className={`${surfaceClass} p-6`}>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-foreground bg-secondary text-foreground">
            <Gamepad2 size={18} strokeWidth={2.5} />
          </div>
          <h2 className="text-lg font-display font-bold text-foreground">
            {t('app.progress.minigames.title') || 'Minigame Performance'}
          </h2>
        </div>

        {!minigameSummary || minigameSummary.totalAttempts === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('app.progress.minigames.empty') || 'Play games to see your performance stats here.'}
          </p>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-xl border-2 border-border bg-secondary p-3">
                <p className="text-xs font-semibold text-muted-foreground">{t('app.progress.minigames.attempts') || 'Attempts'}</p>
                <p className="text-2xl font-display font-bold text-foreground">{minigameSummary.totalAttempts}</p>
              </div>
              <div className="rounded-xl border-2 border-border bg-secondary p-3">
                <p className="text-xs font-semibold text-muted-foreground">{t('app.progress.minigames.accuracy') || 'Avg accuracy'}</p>
                <p className="text-2xl font-display font-bold text-foreground">
                  {Math.round(minigameSummary.averageAccuracy)}%
                </p>
              </div>
              <div className="rounded-xl border-2 border-border bg-secondary p-3">
                <p className="text-xs font-semibold text-muted-foreground">{t('app.progress.minigames.bestScore') || 'Best score'}</p>
                <p className="text-2xl font-display font-bold text-foreground">{minigameSummary.bestScore}</p>
              </div>
              <div className="rounded-xl border-2 border-border bg-secondary p-3">
                <p className="text-xs font-semibold text-muted-foreground">{t('app.progress.minigames.correct') || 'Correct answers'}</p>
                <p className="text-2xl font-display font-bold text-foreground">{minigameSummary.totalCorrectAnswers}</p>
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-display font-bold text-foreground">
                {t('app.progress.minigames.byGame') || 'By game'}
              </h3>
              <div className="space-y-2">
                {Object.entries(minigameSummary.byGame).map(([gameType, stats]) => (
                  <div key={gameType} className="rounded-xl border-2 border-border bg-secondary/40 p-3">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-foreground">{getGameLabel(gameType)}</p>
                      <p className="text-sm text-muted-foreground">{stats.attempts} {t('app.progress.minigames.attempts') || 'attempts'}</p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('app.progress.minigames.accuracy') || 'Avg accuracy'}: {Math.round(stats.averageAccuracy)}% · {t('app.progress.minigames.bestScore') || 'Best score'}: {stats.bestScore}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-display font-bold text-foreground">
                {t('app.progress.minigames.recent') || 'Recent attempts'}
              </h3>
              <div className="space-y-2">
                {minigameSummary.recentAttempts.slice(0, 5).map((attempt) => (
                  <div key={attempt.id || `${attempt.gameType}-${attempt.createdAt}`} className="rounded-xl border-2 border-border bg-secondary/40 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-foreground">{getGameLabel(attempt.gameType)}</p>
                      <p className="text-xs text-muted-foreground">
                        {attempt.createdAt ? new Date(attempt.createdAt).toLocaleDateString() : ''}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {attempt.correctAnswers}/{attempt.totalQuestions} · {Math.round(attempt.accuracy || 0)}% · {t('app.progress.minigames.score') || 'Score'}: {attempt.score}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
