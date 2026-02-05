import { useEffect, useState } from 'react';
import { TrendingUp, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { getUserProfile } from '@/api/user';
import { getAssessmentResults } from '@/api/assessment';
import { LearningPathCard } from '@/components/learning';
import type { AssessmentResults, UserProfile } from '@/types';
import { useLanguage } from '@/contexts/LanguageContext';

const domainStyles: Record<string, string> = {
  grammar: 'bg-primary',
  vocabulary: 'bg-accent',
  pragmatics: 'bg-success',
  pronunciation: 'bg-foreground',
};

const domainBadgeStyles: Record<string, string> = {
  grammar: 'bg-primary/10 text-primary border-primary/20',
  vocabulary: 'bg-accent/10 text-accent border-accent/20',
  cultural: 'bg-secondary text-foreground border-border',
  pragmatics: 'bg-success/10 text-success border-success/20',
  pronunciation: 'bg-foreground/10 text-foreground border-foreground/20',
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

  const getDomainLabel = (domain: string) => {
    const key = `profile.${domain}`;
    const translated = t(key);
    if (translated !== key) return translated;
    return domain.replace(/_/g, ' ');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-foreground text-background border-2 border-foreground flex items-center justify-center">
          <TrendingUp size={24} strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">
            {t('app.progress.title') || 'Learning Progress'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('app.progress.subtitle') || 'Track your skills and learning journey'}
          </p>
        </div>
      </div>

      {/* Learning Path Card (shared component) */}
      <LearningPathCard
        assessmentResults={assessmentResults}
        profileSummary={profileSummary}
        t={t}
      />

      {/* Detailed Domain Breakdown */}
      {domainEntries.length > 0 && (
        <div className="bg-card rounded-2xl border-3 border-foreground shadow-stamp p-6">
          <h2 className="text-lg font-display font-bold text-foreground mb-6">
            {t('app.progress.domainBreakdown') || 'Skill Breakdown'}
          </h2>
          <div className="space-y-5">
            {domainEntries.map(([domain, score]) => (
              <div key={domain} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-display font-bold text-foreground capitalize">
                      {getDomainLabel(domain)}
                    </span>
                    <span className={clsx(
                      'text-xs font-bold px-2.5 py-1 rounded-lg border',
                      domainBadgeStyles[domain] || 'bg-secondary text-muted-foreground border-border'
                    )}>
                      {score}/10
                    </span>
                  </div>
                  <span className="text-sm font-semibold text-muted-foreground">
                    {score >= 8 ? t('app.progress.level.strong') || 'Strong' :
                     score >= 5 ? t('app.progress.level.developing') || 'Developing' :
                     t('app.progress.level.needsPractice') || 'Needs Practice'}
                  </span>
                </div>
                <div className="h-3 w-full rounded-lg bg-secondary border border-border overflow-hidden">
                  <div
                    className={clsx(
                      'h-full rounded-lg transition-all',
                      domainStyles[domain] || 'bg-muted-foreground',
                      getScoreWidthClass(score)
                    )}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Future Sections Placeholder */}
      <div className="bg-card rounded-2xl border-3 border-border border-dashed p-8 text-center">
        <p className="text-sm font-display font-bold text-muted-foreground">
          {t('app.progress.comingSoon') || 'More coming soon'}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {t('app.progress.comingSoonDesc') || 'Curriculum progress, streak calendar, and learning analytics will appear here'}
        </p>
      </div>
    </div>
  );
}
