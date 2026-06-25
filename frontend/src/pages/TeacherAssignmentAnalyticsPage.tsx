import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Loader2,
  Target,
} from 'lucide-react';
import { getAssignmentAnalytics } from '@/api/assignments';
import { Alert, AlertDescription, Badge, Button, Card } from '@/components/ui';
import { useLanguage } from '@/contexts/LanguageContext';
import type { AssignmentAnalyticsData } from '@/types';

function getLocalizedText(
  value: Record<string, string> | undefined,
  lang: 'en' | 'ko',
  fallback = ''
): string {
  if (!value) return fallback;
  return value[lang] || value.en || Object.values(value)[0] || fallback;
}

function formatStatusVariant(status: string): 'success' | 'secondary' | 'outline' {
  if (status === 'published') return 'success';
  if (status === 'archived') return 'secondary';
  return 'outline';
}

function ScaffoldFreeAssignmentCard() {
  const { t } = useLanguage();
  return (
    <Card className="border-3 border-foreground p-6 shadow-stamp">
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-2xl border-2 border-foreground bg-secondary text-secondary-foreground">
          <AlertTriangle size={22} strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">{t('teacher.assignmentAnalytics.scaffoldFree.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('teacher.assignmentAnalytics.scaffoldFree.descriptionPre')}<strong>N/A</strong>{t('teacher.assignmentAnalytics.scaffoldFree.descriptionPost')}
          </p>
        </div>
      </div>
    </Card>
  );
}

function EvidenceTargetsCard({ analytics }: { analytics: AssignmentAnalyticsData }) {
  const { t } = useLanguage();
  return (
    <Card className="border-3 border-foreground p-6 shadow-stamp">
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-2xl border-2 border-foreground bg-primary text-primary-foreground">
          <Target size={22} strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">{t('teacher.assignmentAnalytics.evidenceTargets.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('teacher.assignmentAnalytics.evidenceTargets.subtitle')}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t('teacher.assignmentAnalytics.evidenceTargets.minTurns')}</p>
          <p className="mt-2 text-lg font-bold text-foreground">
            {analytics.pedagogy.evidence.minTurns ?? 'n/a'}
          </p>
        </div>
        <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t('teacher.assignmentAnalytics.evidenceTargets.feedbackCounts')}</p>
          <p className="mt-2 text-sm text-foreground">
            Recast {analytics.summary.feedbackCounts.recast} · Elicitation {analytics.summary.feedbackCounts.elicitation}
            {' '}· Review {analytics.summary.feedbackCounts.reviewItem}
          </p>
        </div>
        <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t('teacher.assignmentAnalytics.evidenceTargets.rubricFocus')}</p>
          <p className="mt-2 text-sm text-foreground">
            {analytics.mapping.rubricFocus.length > 0 ? analytics.mapping.rubricFocus.join(', ') : t('teacher.assignmentAnalytics.evidenceTargets.noRubricFocus')}
          </p>
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-base font-semibold text-foreground">{t('teacher.assignmentAnalytics.evidenceTargets.targetExpressions')}</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {analytics.pedagogy.targetExpressions.length === 0 ? (
            <span className="text-sm text-muted-foreground">{t('teacher.assignmentAnalytics.evidenceTargets.noTargetHits')}</span>
          ) : (
            analytics.pedagogy.targetExpressions.map((item) => (
              <Badge key={item.id} variant="outline" size="sm">
                {item.id}: {item.count}
              </Badge>
            ))
          )}
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-base font-semibold text-foreground">{t('teacher.sessionDebrief.repeatedErrors.title')}</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {analytics.pedagogy.repeatedErrors.length === 0 ? (
            <span className="text-sm text-muted-foreground">{t('teacher.assignmentAnalytics.evidenceTargets.noRepeatedErrors')}</span>
          ) : (
            analytics.pedagogy.repeatedErrors.map((item) => (
              <Badge key={item.id} variant="outline" size="sm">
                {item.label}: {item.count}
                {typeof item.studentCount === 'number' && item.studentCount > 0
                  ? t('teacher.assignmentAnalytics.evidenceTargets.studentsSuffix').replace('{count}', String(item.studentCount))
                  : ''}
              </Badge>
            ))
          )}
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-base font-semibold text-foreground">{t('teacher.assignmentAnalytics.evidenceTargets.rubricDimensionSnapshot')}</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {analytics.pedagogy.rubricDimensionScores.length === 0 ? (
            <span className="text-sm text-muted-foreground">{t('teacher.assignmentAnalytics.evidenceTargets.noRubricDimension')}</span>
          ) : (
            analytics.pedagogy.rubricDimensionScores.map((item) => (
              <Badge key={item.id} variant="secondary" size="sm">
                {item.id}: {item.score.toFixed(2)}
              </Badge>
            ))
          )}
        </div>
      </div>
    </Card>
  );
}

function ObjectiveAlignmentCard({
  analytics,
  lang,
}: {
  analytics: AssignmentAnalyticsData;
  lang: 'en' | 'ko';
}) {
  const { t } = useLanguage();
  return (
    <Card className="border-3 border-foreground p-6 shadow-stamp">
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-2xl border-2 border-foreground bg-success text-success-foreground">
          <BookOpen size={22} strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">{t('teacher.assignmentAnalytics.objectiveAlignment.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('teacher.assignmentAnalytics.objectiveAlignment.subtitle')}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4">
        {analytics.pedagogy.objectives.map((objective) => (
          <div key={objective.id} className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" size="sm">{objective.id}</Badge>
              <Badge variant="secondary" size="sm">{objective.mode}</Badge>
              <Badge variant="accent" size="sm">{t('teacher.assignmentAnalytics.turns').replace('{n}', String(objective.turnCount))}</Badge>
            </div>
            <p className="mt-3 text-sm font-semibold text-foreground">
              {getLocalizedText(objective.canDo, lang, objective.id)}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('teacher.assignmentAnalytics.objectiveAlignment.meta')
                .replace('{domains}', objective.foundationDomains.join(', ') || 'n/a')
                .replace('{rubric}', objective.rubricId || 'n/a')
                .replace('{threshold}', String(objective.rubricThreshold ?? 'n/a'))}
            </p>
            {typeof objective.estimatedRubricScore === 'number' ? (
              <p className="mt-1 text-sm text-foreground/80">
                {t('teacher.assignmentAnalytics.objectiveAlignment.estimatedScore').replace('{score}', objective.estimatedRubricScore.toFixed(2))} · {objective.meetingThreshold ? t('teacher.assignmentAnalytics.meetingThreshold') : t('teacher.assignmentAnalytics.belowThreshold')}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {objective.communicativeFunctions.map((item) => (
                <Badge key={`${objective.id}-${item}`} variant="outline" size="sm">
                  {item}
                </Badge>
              ))}
              {objective.discourseMoves.map((item) => (
                <Badge key={`${objective.id}-${item}`} variant="secondary" size="sm">
                  {item}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RubricViewCard({
  analytics,
  lang,
}: {
  analytics: AssignmentAnalyticsData;
  lang: 'en' | 'ko';
}) {
  const { t } = useLanguage();
  return (
    <Card className="border-3 border-foreground p-6 shadow-stamp">
      <h2 className="text-xl font-display font-bold text-foreground">{t('teacher.assignmentAnalytics.rubricView.title')}</h2>
      <div className="mt-5 space-y-4">
        {analytics.pedagogy.rubrics.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
            {t('teacher.assignmentAnalytics.rubricView.empty')}
          </div>
        ) : (
          analytics.pedagogy.rubrics.map((rubric) => (
            <div key={rubric.id} className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" size="sm">{rubric.id}</Badge>
                <Badge variant="accent" size="sm">{t('teacher.assignmentAnalytics.turns').replace('{n}', String(rubric.turnCount))}</Badge>
                {typeof rubric.averageScore === 'number' ? (
                  <Badge variant="secondary" size="sm">{t('teacher.assignmentAnalytics.avg').replace('{n}', rubric.averageScore.toFixed(2))}</Badge>
                ) : null}
                {typeof rubric.threshold === 'number' ? (
                  <Badge variant="outline" size="sm">{t('teacher.assignmentAnalytics.threshold').replace('{n}', String(rubric.threshold))}</Badge>
                ) : null}
                {rubric.confidence ? (
                  <Badge variant="outline" size="sm">{t('teacher.assignmentAnalytics.confidence').replace('{n}', rubric.confidence)}</Badge>
                ) : null}
                {typeof rubric.averageScore === 'number' && typeof rubric.threshold === 'number' ? (
                  <Badge variant={rubric.meetingThreshold ? 'success' : 'secondary'} size="sm">
                    {rubric.meetingThreshold ? t('teacher.assignmentAnalytics.meetingThreshold') : t('teacher.assignmentAnalytics.belowThreshold')}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-3 font-semibold text-foreground">
                {getLocalizedText(rubric.title, lang, rubric.id)}
              </p>
              <div className="mt-3 space-y-2">
                {rubric.dimensions.map((dimension) => (
                  <div key={dimension.id} className="rounded-xl border border-border bg-card/60 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">
                        {getLocalizedText(dimension.title, lang, dimension.id)}
                      </p>
                      {typeof dimension.averageScore === 'number' ? (
                        <Badge variant="secondary" size="sm">{t('teacher.assignmentAnalytics.score').replace('{n}', dimension.averageScore.toFixed(2))}</Badge>
                      ) : null}
                      {typeof dimension.threshold === 'number' ? (
                        <Badge variant="outline" size="sm">{t('teacher.assignmentAnalytics.threshold').replace('{n}', String(dimension.threshold))}</Badge>
                      ) : null}
                      {dimension.confidence ? (
                        <Badge variant="outline" size="sm">{t('teacher.assignmentAnalytics.confidence').replace('{n}', dimension.confidence)}</Badge>
                      ) : null}
                      {typeof dimension.averageScore === 'number' && typeof dimension.threshold === 'number' ? (
                        <Badge variant={dimension.meetingThreshold ? 'success' : 'secondary'} size="sm">
                          {dimension.meetingThreshold ? t('teacher.assignmentAnalytics.meetingThreshold') : t('teacher.assignmentAnalytics.belowThreshold')}
                        </Badge>
                      ) : null}
                      <Badge variant="outline" size="sm">{t('teacher.assignmentAnalytics.signals').replace('{n}', String(dimension.signalCount))}</Badge>
                      {dimension.errorCount > 0 ? (
                        <Badge variant="outline" size="sm">{t('teacher.assignmentAnalytics.errors').replace('{n}', String(dimension.errorCount))}</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {getLocalizedText(dimension.description, lang)}
                    </p>
                    {dimension.evidence && dimension.evidence.length > 0 ? (
                      <p className="mt-2 text-sm text-foreground/80">
                        {t('teacher.assignmentAnalytics.evidence').replace('{text}', dimension.evidence.join(' · '))}
                      </p>
                    ) : null}
                    {dimension.concerns && dimension.concerns.length > 0 ? (
                      <p className="mt-1 text-sm text-destructive/90">
                        {t('teacher.assignmentAnalytics.concerns').replace('{text}', dimension.concerns.join(' · '))}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function RecentAttemptsCard({ analytics }: { analytics: AssignmentAnalyticsData }) {
  const { t } = useLanguage();
  return (
    <Card className="border-3 border-foreground p-6 shadow-stamp">
      <h2 className="text-xl font-display font-bold text-foreground">{t('teacher.assignmentAnalytics.recentAttempts.title')}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {t('teacher.assignmentAnalytics.recentAttempts.subtitle')}
      </p>
      <div className="mt-5 space-y-3">
        {analytics.recentSessions.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
            {t('teacher.assignmentAnalytics.recentAttempts.empty')}
          </div>
        ) : (
          analytics.recentSessions.map((session) => (
            <div key={session.id} className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" size="sm">{session.status}</Badge>
                <Badge variant="secondary" size="sm">{t('teacher.assignmentAnalytics.turns').replace('{n}', String(session.sessionSummary.studentTurnCount))}</Badge>
              </div>
              <p className="mt-3 text-sm text-foreground">
                {t('teacher.assignmentAnalytics.recentAttempts.summary')
                  .replace('{speakingS}', String(session.sessionSummary.estimatedSpeakingTimeSeconds))
                  .replace('{selfCorrections}', String(session.sessionSummary.selfCorrectionCount))
                  .replace('{taskCompletions}', String(session.sessionSummary.taskCompletionCount))}
              </p>
              {session.sessionSummary.endedReason ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('teacher.assignmentAnalytics.recentAttempts.ended').replace('{reason}', session.sessionSummary.endedReason)}
                </p>
              ) : null}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

export function TeacherAssignmentAnalyticsPage() {
  const { classId, assignmentId } = useParams<{ classId: string; assignmentId: string }>();
  const navigate = useNavigate();
  const { lang, t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<AssignmentAnalyticsData | null>(null);

  useEffect(() => {
    let isActive = true;

    if (!assignmentId) {
      setLoading(false);
      setError('Assignment id is required.');
      return;
    }

    const loadAnalytics = async () => {
      setLoading(true);
      try {
        const nextAnalytics = await getAssignmentAnalytics(assignmentId);
        if (!isActive) return;
        setAnalytics(nextAnalytics);
        setError(null);
      } catch (loadError) {
        if (!isActive) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load assignment analytics.');
      } finally {
        if (isActive) setLoading(false);
      }
    };

    void loadAnalytics();
    return () => {
      isActive = false;
    };
  }, [assignmentId]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{error || t('teacher.assignmentAnalytics.unavailable')}</AlertDescription>
        </Alert>
        <Button
          variant="outline"
          onClick={() => navigate(classId ? `/app/teacher/classes/${classId}/assignments` : '/app/teacher')}
        >
          {t('teacher.assignmentAnalytics.backToAssignments')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Button
            variant="outline"
            size="sm"
            className="mb-4"
            onClick={() => navigate(`/app/teacher/classes/${classId}/assignments`)}
          >
            <ArrowLeft size={16} className="mr-2" />
            {t('teacher.assignmentAnalytics.backToAssignments')}
          </Button>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge variant={formatStatusVariant(analytics.assignment.status)} size="sm">
              {analytics.assignment.status}
            </Badge>
            <Badge variant="outline" size="sm">
              {analytics.pedagogy.taskModel || t('teacher.assignmentAnalytics.taskModelNA')}
            </Badge>
          </div>
          <h1 className="text-3xl font-display font-bold text-foreground">{analytics.assignment.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {analytics.class.name} · {analytics.class.subject || t('teacher.classAnalytics.languagePractice')} ·{' '}
            {analytics.class.term || t('teacher.classAnalytics.currentTerm')}
          </p>
          <p className="mt-3 max-w-3xl text-sm text-foreground/80">
            {analytics.assignment.description || t('teacher.assignmentAnalytics.noDescription')}
          </p>
        </div>
      </div>

      {analytics.debriefEnabled && analytics.debriefRollupEnabled && assignmentId ? (
        <Link
          to={`/app/teacher/assignments/${assignmentId}/debrief`}
          className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('teacher.assignmentAnalytics.viewCoachingDebrief')}
        </Link>
      ) : null}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {analytics.limitations.map((message) => (
        <Alert key={message}>
          <AlertTriangle className="size-4" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ))}

      {analytics.assignment.taskType === 'custom_prompt' && <ScaffoldFreeAssignmentCard />}

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          {analytics.assignment.taskType !== 'custom_prompt' && (
            <>
              <EvidenceTargetsCard analytics={analytics} />
              <ObjectiveAlignmentCard analytics={analytics} lang={lang} />
            </>
          )}
        </div>

        <div className="space-y-6">
          {analytics.assignment.taskType !== 'custom_prompt' && (
            <RubricViewCard analytics={analytics} lang={lang} />
          )}

          <RecentAttemptsCard analytics={analytics} />
        </div>
      </div>
    </div>
  );
}
