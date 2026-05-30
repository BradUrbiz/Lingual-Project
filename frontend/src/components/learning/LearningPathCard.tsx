import { clsx } from 'clsx';
import type { AssessmentResults, UserProfile } from '@/types';

const domainStyles: Record<string, string> = {
  grammar: 'bg-primary',
  vocabulary: 'bg-accent',
  pragmatics: 'bg-success',
  pronunciation: 'bg-foreground',
};


interface LearningPathCardProps {
  assessmentResults: AssessmentResults | null;
  profileSummary: UserProfile | null;
  t: (key: string) => string;
}

export function LearningPathCard({ assessmentResults, profileSummary, t }: LearningPathCardProps) {
  const focusAreas = profileSummary?.selectedCategories ?? [];
  const levelLabel =
    assessmentResults?.proficiencyLevel ||
    assessmentResults?.actflLevel ||
    assessmentResults?.sklcLevel;
  const levelDescription =
    assessmentResults?.proficiencyDescription ||
    assessmentResults?.actflDescription ||
    assessmentResults?.sklcDescription;
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
    <div className="shrink-0 overflow-hidden bg-card rounded-2xl border-3 border-foreground shadow-stamp p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            {t('app.learn.path.label')}
          </p>
          <h2 className="text-base font-display font-bold text-foreground">
            {t('app.learn.path.title')}
          </h2>
        </div>
        {levelLabel ? (
          <span className="text-xs font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-lg border border-primary/20">
            {t('app.learn.path.level')} {levelLabel}
          </span>
        ) : (
          <span className="text-xs font-bold text-muted-foreground bg-secondary px-2.5 py-1 rounded-lg border border-border">
            {t('app.learn.path.pending')}
          </span>
        )}
      </div>
      {levelDescription ? (
        <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{levelDescription}</p>
      ) : (
        <div className="mb-3 rounded-xl border-2 border-border bg-secondary p-3">
          <p className="text-sm font-display font-bold text-foreground">
            {t('app.learn.path.empty.title')}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {t('app.learn.path.empty.description')}
          </p>
          <button type="button"
            onClick={() => (window.location.href = '/assessment')}
            className="mt-2 inline-flex items-center gap-2 text-xs font-bold text-primary hover:text-primary/80 underline underline-offset-4"
          >
            {t('app.learn.path.empty.cta')}
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {focusAreas.map((area) => (
          <span
            key={area}
            className="text-xs font-bold text-foreground bg-secondary px-2.5 py-1 rounded-lg border-2 border-border"
          >
            {getCategoryLabel(area)}
          </span>
        ))}
        {domainEntries.slice(0, 2).map(([domain, score]) => (
          <span
            key={domain}
            className={clsx(
              'text-xs font-bold px-2.5 py-1 rounded-lg border',
              domainStyles[domain] ? `${domainStyles[domain]}/10 border-current` : 'bg-secondary border-border'
            )}
          >
            {domain.replace(/_/g, ' ')} {score}/10
          </span>
        ))}
      </div>
    </div>
  );
}
