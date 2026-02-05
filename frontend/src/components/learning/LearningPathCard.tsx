import { clsx } from 'clsx';
import type { AssessmentResults, UserProfile } from '@/types';

const domainStyles: Record<string, string> = {
  grammar: 'bg-primary',
  vocabulary: 'bg-accent',
  pragmatics: 'bg-success',
  pronunciation: 'bg-foreground',
};

const scoreWidthClasses: Record<number, string> = {
  0: 'w-0',
  1: 'w-[10%]',
  2: 'w-[20%]',
  3: 'w-[30%]',
  4: 'w-[40%]',
  5: 'w-[50%]',
  6: 'w-[60%]',
  7: 'w-[70%]',
  8: 'w-[80%]',
  9: 'w-[90%]',
  10: 'w-[100%]',
};

const getScoreWidthClass = (score: number) => {
  const rounded = Math.round(score);
  const clamped = Math.min(10, Math.max(0, rounded));
  return scoreWidthClasses[clamped] ?? 'w-0';
};

interface LearningPathCardProps {
  assessmentResults: AssessmentResults | null;
  profileSummary: UserProfile | null;
  t: (key: string) => string;
}

export function LearningPathCard({ assessmentResults, profileSummary, t }: LearningPathCardProps) {
  const focusAreas = profileSummary?.selectedCategories ?? [];
  const domainEntries = assessmentResults?.domainBands
    ? Object.entries(assessmentResults.domainBands).sort((a, b) => b[1] - a[1])
    : [];

  const getCategoryLabel = (area: string) => {
    const key = `categories.${area}`;
    const translated = t(key);
    if (translated !== key) return translated;
    return area.replace(/_/g, ' ');
  };

  return (
    <div className="bg-card rounded-2xl border-3 border-foreground shadow-stamp p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            {t('app.learn.path.label')}
          </p>
          <h2 className="text-lg font-display font-bold text-foreground">
            {t('app.learn.path.title')}
          </h2>
        </div>
        {assessmentResults?.sklcLevel ? (
          <span className="text-xs font-bold text-primary bg-primary/10 px-3 py-1.5 rounded-lg border border-primary/20">
            {t('app.learn.path.level')} {assessmentResults.sklcLevel}
          </span>
        ) : (
          <span className="text-xs font-bold text-muted-foreground bg-secondary px-3 py-1.5 rounded-lg border border-border">
            {t('app.learn.path.pending')}
          </span>
        )}
      </div>
      {assessmentResults?.sklcDescription ? (
        <p className="text-sm text-muted-foreground mb-4">{assessmentResults.sklcDescription}</p>
      ) : (
        <div className="mb-4 rounded-xl border-2 border-border bg-secondary p-4">
          <p className="text-sm font-display font-bold text-foreground">
            {t('app.learn.path.empty.title')}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {t('app.learn.path.empty.description')}
          </p>
          <button
            onClick={() => (window.location.href = '/assessment')}
            className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-primary hover:text-primary/80 underline underline-offset-4"
          >
            {t('app.learn.path.empty.cta')}
          </button>
        </div>
      )}

      {focusAreas.length > 0 && (
        <div className="mb-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            {t('app.learn.path.focus')}
          </p>
          <div className="flex flex-wrap gap-2">
            {focusAreas.map((area) => (
              <span
                key={area}
                className="text-xs font-bold text-foreground bg-secondary px-3 py-1.5 rounded-lg border-2 border-border"
              >
                {getCategoryLabel(area)}
              </span>
            ))}
          </div>
        </div>
      )}

      {domainEntries.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            {t('app.learn.path.strengths')}
          </p>
          {domainEntries.slice(0, 3).map(([domain, score]) => (
            <div key={domain} className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-bold text-foreground capitalize">
                  {domain.replace(/_/g, ' ')}
                </span>
                <span className="font-semibold">{score}/10</span>
              </div>
              <div className="h-2 w-full rounded-lg bg-secondary border border-border overflow-hidden">
                <div
                  className={clsx(
                    'h-full rounded-lg',
                    domainStyles[domain] || 'bg-muted-foreground',
                    getScoreWidthClass(score)
                  )}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
