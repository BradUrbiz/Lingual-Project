import { useEffect, useReducer } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Compass,
  HelpCircle,
  Loader2,
  MessageSquareText,
  Repeat,
  Star,
  Target,
  TrendingUp,
  Wrench,
} from 'lucide-react';
import { getSessionDebrief, type SessionDebrief } from '@/api/teacher';
import { Alert, AlertDescription, Badge, Card } from '@/components/ui';
import { useLanguage } from '@/contexts/LanguageContext';

// ── State ────────────────────────────────────────────────────────────

type DebriefState =
  | { phase: 'loading' }
  | { phase: 'not-available' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; debrief: SessionDebrief };

type DebriefAction =
  | { type: 'load-success'; debrief: SessionDebrief }
  | { type: 'not-available' }
  | { type: 'error'; message: string };

function debriefReducer(_state: DebriefState, action: DebriefAction): DebriefState {
  switch (action.type) {
    case 'load-success':
      return { phase: 'ready', debrief: action.debrief };
    case 'not-available':
      return { phase: 'not-available' };
    case 'error':
      return { phase: 'error', message: action.message };
  }
}

// ── Helper ───────────────────────────────────────────────────────────

function formatTimestamp(ts: string | null): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

// ── Sub-components ───────────────────────────────────────────────────

function SectionCard({
  title,
  icon: Icon,
  accent,
  children,
}: {
  title: string;
  icon: React.ElementType;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-3 border-foreground p-6 shadow-stamp">
      <div className="flex items-center gap-3">
        <div className={`flex size-11 items-center justify-center rounded-2xl border-2 border-foreground ${accent}`}>
          <Icon size={22} strokeWidth={2.5} />
        </div>
        <h2 className="text-xl font-display font-bold text-foreground">{title}</h2>
      </div>
      <div className="mt-5">{children}</div>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function CoverageCard({ coverage }: { coverage: SessionDebrief['coverage'] }) {
  const { t } = useLanguage();
  const expressionEntries = Object.entries(coverage.expressionHits);
  const vocabEntries = Object.entries(coverage.vocabularyHits);
  const hasHits = expressionEntries.length > 0 || vocabEntries.length > 0;
  const hasUncovered = coverage.uncovered.length > 0;
  const hasRecycle = coverage.recycle.length > 0;

  return (
    <SectionCard title={t('teacher.sessionDebrief.coverage.title')} icon={Target} accent="bg-primary/10 text-primary">
      {hasHits ? (
        <div className="space-y-4">
          {expressionEntries.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">{t('teacher.sessionDebrief.coverage.expressionHits')}</p>
              <div className="flex flex-wrap gap-2">
                {expressionEntries.map(([expr, count]) => (
                  <Badge key={expr} variant="outline" size="sm">
                    {expr}: {count}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {vocabEntries.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">{t('teacher.sessionDebrief.coverage.vocabularyHits')}</p>
              <div className="flex flex-wrap gap-2">
                {vocabEntries.map(([word, count]) => (
                  <Badge key={word} variant="secondary" size="sm">
                    {word}: {count}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <EmptyState message={t('teacher.sessionDebrief.coverage.noHits')} />
      )}

      {(hasUncovered || hasRecycle) && (
        <div className="mt-4 space-y-3">
          {hasUncovered && (
            <div>
              <p className="mb-2 text-sm font-medium text-muted-foreground">{t('teacher.sessionDebrief.coverage.uncovered')}</p>
              <div className="flex flex-wrap gap-2">
                {coverage.uncovered.map((expr) => (
                  <Badge key={expr} variant="outline" size="sm">
                    {expr}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {hasRecycle && (
            <div>
              <p className="mb-2 text-sm font-medium text-muted-foreground">{t('teacher.sessionDebrief.coverage.recycle')}</p>
              <div className="flex flex-wrap gap-2">
                {coverage.recycle.map((expr) => (
                  <Badge key={expr} variant="accent" size="sm">
                    {expr}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function UptakeCard({ uptake }: { uptake: SessionDebrief['uptake'] }) {
  const { t } = useLanguage();
  const { selfCorrectionCount, feedbackCounts, taskCompletionCount } = uptake;
  return (
    <SectionCard title={t('teacher.sessionDebrief.uptake.title')} icon={TrendingUp} accent="bg-success/15 text-success">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
          <p className="text-2xl font-display font-bold text-foreground">{selfCorrectionCount}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('teacher.debrief.uptake.selfCorrections')}</p>
        </div>
        <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
          <p className="text-2xl font-display font-bold text-foreground">{taskCompletionCount}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('teacher.debrief.uptake.taskCompletions')}</p>
        </div>
      </div>
      <div className="mt-4">
        <p className="mb-2 text-sm font-medium text-foreground">{t('teacher.debrief.uptake.feedbackCounts')}</p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" size="sm">{t('teacher.sessionDebrief.uptake.recast').replace('{count}', String(feedbackCounts.recast))}</Badge>
          <Badge variant="outline" size="sm">{t('teacher.sessionDebrief.uptake.elicitation').replace('{count}', String(feedbackCounts.elicitation))}</Badge>
          <Badge variant="outline" size="sm">{t('teacher.sessionDebrief.uptake.reviewItem').replace('{count}', String(feedbackCounts.reviewItem))}</Badge>
        </div>
      </div>
    </SectionCard>
  );
}

function RepeatedErrorsCard({ repeatedErrors }: { repeatedErrors: SessionDebrief['repeatedErrors'] }) {
  const { t } = useLanguage();
  return (
    <SectionCard title={t('teacher.sessionDebrief.repeatedErrors.title')} icon={AlertTriangle} accent="bg-destructive/10 text-destructive">
      {repeatedErrors.length === 0 ? (
        <EmptyState message={t('teacher.sessionDebrief.repeatedErrors.empty')} />
      ) : (
        <div className="space-y-3">
          {repeatedErrors.map((err, i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl border-2 border-border bg-secondary/40 p-4">
              <p className="flex-1 text-sm font-semibold text-foreground">{err.label}</p>
              <Badge variant="secondary" size="sm">×{err.count}</Badge>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function CoachReviewCard({ coachReview }: { coachReview: SessionDebrief['coachReview'] }) {
  const { t } = useLanguage();
  if (!coachReview) return null;

  // Backend shape (serialize_coach_review): wins=[{text}], work_on=[{utterance,better,why,target,confidence_caveat}].
  // Render the object fields (a bare object is not a valid React child). Stay tolerant of a plain-string entry too.
  const winText = (w: unknown): string => {
    if (typeof w === 'string') return w;
    if (w && typeof w === 'object' && typeof (w as { text?: unknown }).text === 'string') return (w as { text: string }).text;
    return '';
  };
  const workOnText = (item: unknown): string => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      const o = item as { utterance?: unknown; better?: unknown; why?: unknown; target?: unknown };
      const head = [o.utterance, o.better].filter((s): s is string => typeof s === 'string' && !!s).join(' → ');
      const why = typeof o.why === 'string' && o.why ? ` (${o.why})` : '';
      return (head + why) || (typeof o.target === 'string' ? o.target : '');
    }
    return '';
  };
  const wins = (Array.isArray(coachReview.wins) ? coachReview.wins : []).map(winText).filter(Boolean);
  const workOn = (Array.isArray(coachReview.work_on) ? coachReview.work_on : []).map(workOnText).filter(Boolean);

  return (
    <SectionCard title={t('teacher.debrief.coachReview.title')} icon={Star} accent="bg-accent/20 text-accent-foreground">
      <div className="space-y-4">
        {wins.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <CheckCircle2 size={14} className="text-success" />
              {t('teacher.sessionDebrief.coachReview.wins')}
            </p>
            <ul className="space-y-1.5">
              {wins.map((win, i) => (
                <li key={i} className="rounded-xl border border-border bg-secondary/40 px-4 py-2.5 text-sm text-foreground">
                  {win}
                </li>
              ))}
            </ul>
          </div>
        )}
        {workOn.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Wrench size={14} className="text-primary" />
              {t('teacher.sessionDebrief.coachReview.workOn')}
            </p>
            <ul className="space-y-1.5">
              {workOn.map((item, i) => (
                <li key={i} className="rounded-xl border border-border bg-secondary/40 px-4 py-2.5 text-sm text-foreground">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
        {wins.length === 0 && workOn.length === 0 && (
          <EmptyState message={t('teacher.sessionDebrief.coachReview.empty')} />
        )}
      </div>
    </SectionCard>
  );
}

function DirectorReSteersCard({ reSteers }: { reSteers: SessionDebrief['directorReSteers'] }) {
  const { t } = useLanguage();
  if (!reSteers || reSteers.count === 0) return null;
  const label = (kind: string, target: string) => {
    if (kind === 'language_drift') return t('teacher.sessionDebrief.coaching.langDrift').replace('{target}', target || 'the target language');
    if (kind === 'target_neglect') return t('teacher.sessionDebrief.coaching.targetNeglect').replace('{target}', target);
    return target ? t('teacher.sessionDebrief.coaching.genericWithTarget').replace('{target}', target) : t('teacher.sessionDebrief.coaching.generic');
  };
  const kindLabel = (kind: string) => {
    if (kind === 'language_drift') return t('teacher.sessionDebrief.coaching.kindLanguage');
    if (kind === 'target_neglect') return t('teacher.sessionDebrief.coaching.kindTarget');
    return t('teacher.sessionDebrief.coaching.kindRe');
  };
  return (
    <SectionCard title={t('teacher.debrief.coaching.title')} icon={Compass} accent="bg-secondary text-foreground">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t('teacher.sessionDebrief.coaching.description')}
        </p>
        <ul className="space-y-1.5">
          {reSteers.items.map((r, i) => (
            <li key={`${r.turnIndex}-${i}`} className="flex items-center gap-3 rounded-2xl border-2 border-border bg-secondary/40 p-4">
              <p className="flex-1 text-sm text-foreground">
                {label(r.kind, r.target)}
                {r.turnIndex != null ? (
                  <span className="ml-1 text-muted-foreground">{t('teacher.sessionDebrief.coaching.turnLabel').replace('{n}', String(r.turnIndex))}</span>
                ) : null}
              </p>
              <Badge variant="secondary" size="sm">{kindLabel(r.kind)}</Badge>
            </li>
          ))}
        </ul>
      </div>
    </SectionCard>
  );
}

function PromotionsCard({ promotions }: { promotions: SessionDebrief['promotions'] }) {
  const { t } = useLanguage();
  if (!promotions || promotions.count === 0) return null;
  const label = (reason: string, target: string) => {
    if (reason === 'hard_target') return t('teacher.sessionDebrief.promotions.hardTarget').replace('{target}', target);
    if (reason === 'repeat') return t('teacher.sessionDebrief.promotions.repeat').replace('{target}', target);
    return t('teacher.sessionDebrief.promotions.generic').replace('{target}', target);
  };
  const reasonLabel = (reason: string) => {
    if (reason === 'hard_target') return t('teacher.sessionDebrief.promotions.grammar');
    if (reason === 'repeat') return t('teacher.sessionDebrief.promotions.recurring');
    return t('teacher.sessionDebrief.promotions.promoted');
  };
  return (
    <SectionCard title={t('teacher.debrief.corrections.title')} icon={Repeat} accent="bg-accent/20 text-accent-foreground">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t('teacher.sessionDebrief.promotions.description')}
        </p>
        <ul className="space-y-1.5">
          {promotions.items.map((p, i) => (
            <li key={`${p.turnIndex}-${i}`} className="flex items-center gap-3 rounded-2xl border-2 border-border bg-secondary/40 p-4">
              <p className="flex-1 text-sm text-foreground">
                {label(p.reason, p.target)}
                {p.turnIndex != null ? (
                  <span className="ml-1 text-muted-foreground">{t('teacher.sessionDebrief.coaching.turnLabel').replace('{n}', String(p.turnIndex))}</span>
                ) : null}
              </p>
              <Badge variant="secondary" size="sm">{reasonLabel(p.reason)}</Badge>
            </li>
          ))}
        </ul>
      </div>
    </SectionCard>
  );
}

function HelpUsageCard({ helpUsage }: { helpUsage: SessionDebrief['helpUsage'] }) {
  const { t } = useLanguage();
  const kindEntries = Object.entries(helpUsage.byKind);
  return (
    <SectionCard title={t('teacher.debrief.help.title')} icon={HelpCircle} accent="bg-secondary text-foreground">
      <div className="mb-4 rounded-2xl border-2 border-border bg-secondary/40 p-4">
        <p className="text-2xl font-display font-bold text-foreground">{helpUsage.askCount}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('teacher.debrief.help.totalAskEvents')}</p>
      </div>
      {kindEntries.length > 0 ? (
        <div>
          <p className="mb-2 text-sm font-medium text-foreground">{t('teacher.debrief.byKind')}</p>
          <div className="flex flex-wrap gap-2">
            {kindEntries.map(([kind, count]) => (
              <Badge key={kind} variant="outline" size="sm">
                {kind}: {count}
              </Badge>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState message={t('teacher.sessionDebrief.help.noBreakdown')} />
      )}
    </SectionCard>
  );
}

function AffectCard({ affect }: { affect: SessionDebrief['affect'] }) {
  const { t } = useLanguage();
  if (!affect) return null;
  return (
    <SectionCard title={t('teacher.debrief.affect.title')} icon={MessageSquareText} accent="bg-primary/5 text-foreground">
      <div className="space-y-3">
        {affect.readiness ? (
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-muted-foreground">{t('teacher.sessionDebrief.affect.readiness')}</p>
            <Badge variant="secondary" size="sm">{affect.readiness}</Badge>
          </div>
        ) : null}
        {affect.reason ? (
          <p className="text-sm text-foreground">{affect.reason}</p>
        ) : null}
        {!affect.readiness && !affect.reason && (
          <EmptyState message={t('teacher.sessionDebrief.affect.noSignal')} />
        )}
      </div>
    </SectionCard>
  );
}

function SuggestedNextCard({ suggestedNext }: { suggestedNext: SessionDebrief['suggestedNext'] }) {
  const { t } = useLanguage();
  return (
    <SectionCard title={t('teacher.debrief.suggestedNext.title')} icon={BookOpen} accent="bg-primary/10 text-primary">
      {suggestedNext.length === 0 ? (
        <EmptyState message={t('teacher.sessionDebrief.suggestedNext.empty')} />
      ) : (
        <ul className="space-y-2">
          {suggestedNext.map((item, i) => (
            <li key={i} className="rounded-xl border border-border bg-secondary/40 px-4 py-2.5 text-sm text-foreground">
              {item}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function CaveatsCard({ caveats }: { caveats: SessionDebrief['caveats'] }) {
  const { t } = useLanguage();
  return (
    <SectionCard title={t('teacher.debrief.caveats.title')} icon={AlertTriangle} accent="bg-muted text-muted-foreground">
      {caveats.length === 0 ? (
        <EmptyState message={t('teacher.debrief.caveats.empty')} />
      ) : (
        <ul className="space-y-2">
          {caveats.map((caveat, i) => (
            <li key={i} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              {caveat}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export function TeacherSessionDebriefPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { t } = useLanguage();
  const [state, dispatch] = useReducer(debriefReducer, { phase: 'loading' });

  useEffect(() => {
    let isActive = true;

    if (!sessionId) {
      dispatch({ type: 'not-available' });
      return;
    }

    const load = async () => {
      try {
        const debrief = await getSessionDebrief(sessionId);
        if (!isActive) return;
        if (!debrief) {
          dispatch({ type: 'not-available' });
        } else {
          dispatch({ type: 'load-success', debrief });
        }
      } catch (err) {
        if (!isActive) return;
        dispatch({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to load session debrief.',
        });
      }
    };

    void load();
    return () => {
      isActive = false;
    };
  }, [sessionId]);

  if (state.phase === 'loading') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (state.phase === 'not-available' || state.phase === 'error') {
    return (
      <div className="space-y-4">
        <Alert variant={state.phase === 'error' ? 'destructive' : 'default'}>
          <AlertDescription>
            {state.phase === 'error' ? state.message : t('teacher.sessionDebrief.notAvailable')}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const { debrief } = state;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-display font-bold text-foreground">{t('teacher.sessionDebrief.pageTitle')}</h1>
          {debrief.status ? (
            <Badge variant={debrief.status === 'completed' ? 'success' : 'outline'} size="sm">
              {debrief.status}
            </Badge>
          ) : null}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {debrief.startedAt ? t('teacher.sessionDebrief.startedAt').replace('{ts}', formatTimestamp(debrief.startedAt)) : t('teacher.sessionDebrief.startTimeUnknown')}
          {debrief.endedAt ? t('teacher.sessionDebrief.endedAt').replace('{ts}', formatTimestamp(debrief.endedAt)) : ''}
        </p>
      </div>

      {/* Main sections */}
      <CoverageCard coverage={debrief.coverage} />
      <UptakeCard uptake={debrief.uptake} />
      <RepeatedErrorsCard repeatedErrors={debrief.repeatedErrors} />
      <DirectorReSteersCard reSteers={debrief.directorReSteers} />
      <PromotionsCard promotions={debrief.promotions} />
      {debrief.coachReview ? <CoachReviewCard coachReview={debrief.coachReview} /> : null}
      <HelpUsageCard helpUsage={debrief.helpUsage} />
      {debrief.affect ? <AffectCard affect={debrief.affect} /> : null}
      <SuggestedNextCard suggestedNext={debrief.suggestedNext} />
      <CaveatsCard caveats={debrief.caveats} />
    </div>
  );
}
