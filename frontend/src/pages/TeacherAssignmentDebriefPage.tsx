import { useEffect, useReducer } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle,
  BookOpen,
  Compass,
  HelpCircle,
  Loader2,
  MessageSquareText,
  Repeat,
  Star,
  TrendingUp,
  Users,
} from 'lucide-react';
import { getAssignmentDebrief, type AssignmentDebrief } from '@/api/teacher';
import { Alert, AlertDescription, Badge, Card } from '@/components/ui';

// ── State ────────────────────────────────────────────────────────────

type DebriefState =
  | { phase: 'loading' }
  | { phase: 'not-available' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; debrief: AssignmentDebrief };

type DebriefAction =
  | { type: 'load-success'; debrief: AssignmentDebrief }
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

function ParticipationCard({ participation }: { participation: AssignmentDebrief['participation'] }) {
  return (
    <SectionCard title="Participation" icon={Users} accent="bg-primary/10 text-primary">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
          <p className="text-2xl font-display font-bold text-foreground">{participation.sessionCount}</p>
          <p className="mt-1 text-sm text-muted-foreground">Sessions</p>
        </div>
        <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
          <p className="text-2xl font-display font-bold text-foreground">{participation.completedSessionCount}</p>
          <p className="mt-1 text-sm text-muted-foreground">Completed</p>
        </div>
        <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
          <p className="text-2xl font-display font-bold text-foreground">{participation.studentCount}</p>
          <p className="mt-1 text-sm text-muted-foreground">Students</p>
        </div>
        <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
          <p className="text-sm font-medium text-foreground">{formatTimestamp(participation.firstStartedAt)}</p>
          <p className="mt-1 text-xs text-muted-foreground">First started</p>
          {participation.lastStartedAt && participation.lastStartedAt !== participation.firstStartedAt && (
            <>
              <p className="mt-2 text-sm font-medium text-foreground">{formatTimestamp(participation.lastStartedAt)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Last started</p>
            </>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

function UptakeCard({ uptake }: { uptake: AssignmentDebrief['uptake'] }) {
  const { selfCorrectionCount, feedbackCounts, taskCompletionCount } = uptake;
  const hasAny = selfCorrectionCount > 0 || taskCompletionCount > 0 ||
    feedbackCounts.recast > 0 || feedbackCounts.elicitation > 0 || feedbackCounts.reviewItem > 0;
  if (!hasAny) return null;
  return (
    <SectionCard title="Feedback uptake" icon={TrendingUp} accent="bg-success/15 text-success">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
          <p className="text-2xl font-display font-bold text-foreground">{selfCorrectionCount}</p>
          <p className="mt-1 text-sm text-muted-foreground">Self-corrections</p>
        </div>
        <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
          <p className="text-2xl font-display font-bold text-foreground">{taskCompletionCount}</p>
          <p className="mt-1 text-sm text-muted-foreground">Task completions</p>
        </div>
      </div>
      <div className="mt-4">
        <p className="mb-2 text-sm font-medium text-foreground">Feedback counts</p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" size="sm">Recast: {feedbackCounts.recast}</Badge>
          <Badge variant="outline" size="sm">Elicitation: {feedbackCounts.elicitation}</Badge>
          <Badge variant="outline" size="sm">Review item: {feedbackCounts.reviewItem}</Badge>
        </div>
      </div>
    </SectionCard>
  );
}

function TargetedCorrectionsCard({ promotions }: { promotions: AssignmentDebrief['promotions'] }) {
  if (promotions.count === 0) return null;
  return (
    <SectionCard title="Targeted corrections" icon={Repeat} accent="bg-accent/20 text-accent-foreground">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Grammar targets that were repeatedly corrected across sessions.
        </p>
        <ul className="space-y-1.5">
          {promotions.byTarget.map((item, i) => (
            <li key={`${item.target}-${i}`} className="flex items-center gap-3 rounded-2xl border-2 border-border bg-secondary/40 p-4">
              <p className="flex-1 text-sm font-semibold text-foreground">{item.target}</p>
              <div className="flex gap-2">
                <Badge variant="secondary" size="sm">×{item.count}</Badge>
                <Badge variant="outline" size="sm">{item.sessionCount} session{item.sessionCount !== 1 ? 's' : ''}</Badge>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </SectionCard>
  );
}

function CoachingInterventionsCard({ reSteers }: { reSteers: AssignmentDebrief['directorReSteers'] }) {
  if (reSteers.count === 0) return null;
  const kindEntries = Object.entries(reSteers.byKind).filter(([, count]) => count > 0);
  return (
    <SectionCard title="Coaching interventions" icon={Compass} accent="bg-secondary text-foreground">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Moments the AI coach corrected the tutor mid-conversation, across all sessions.
        </p>
        <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
          <p className="text-2xl font-display font-bold text-foreground">{reSteers.count}</p>
          <p className="mt-1 text-sm text-muted-foreground">Total interventions</p>
        </div>
        {kindEntries.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-foreground">By kind</p>
            <div className="flex flex-wrap gap-2">
              {kindEntries.map(([kind, count]) => (
                <Badge key={kind} variant="outline" size="sm">
                  {kind}: {count}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {reSteers.byTarget.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-foreground">By target</p>
            <div className="flex flex-wrap gap-2">
              {reSteers.byTarget.map((item) => (
                <Badge key={item.target} variant="secondary" size="sm">
                  {item.target}: {item.count}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function HelpUsageCard({ helpUsage }: { helpUsage: AssignmentDebrief['helpUsage'] }) {
  if (helpUsage.askCount === 0) return null;
  const nonZeroKinds = Object.entries(helpUsage.byKind).filter(([, count]) => count > 0);
  return (
    <SectionCard title="Help usage" icon={HelpCircle} accent="bg-secondary text-foreground">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
          <p className="text-2xl font-display font-bold text-foreground">{helpUsage.askCount}</p>
          <p className="mt-1 text-sm text-muted-foreground">Total ask events</p>
        </div>
        <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
          <p className="text-2xl font-display font-bold text-foreground">{helpUsage.sessionsWithHelp}</p>
          <p className="mt-1 text-sm text-muted-foreground">Sessions with help</p>
        </div>
      </div>
      {nonZeroKinds.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-foreground">By kind</p>
          <div className="flex flex-wrap gap-2">
            {nonZeroKinds.map(([kind, count]) => (
              <Badge key={kind} variant="outline" size="sm">
                {kind}: {count}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function AffectCard({ affect }: { affect: AssignmentDebrief['affect'] }) {
  if (affect.sessionsWithSignal === 0) return null;
  const readinessEntries = Object.entries(affect.byReadiness).filter(([, count]) => count > 0);
  return (
    <SectionCard title="Affect readiness" icon={MessageSquareText} accent="bg-primary/5 text-foreground">
      <div className="space-y-3">
        <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
          <p className="text-2xl font-display font-bold text-foreground">{affect.sessionsWithSignal}</p>
          <p className="mt-1 text-sm text-muted-foreground">Sessions with affect signal</p>
        </div>
        {readinessEntries.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-foreground">Distribution</p>
            <div className="flex flex-wrap gap-2">
              {readinessEntries.map(([readiness, count]) => (
                <Badge key={readiness} variant="secondary" size="sm">
                  {readiness}: {count}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function CoachReviewCard({ coachReview }: { coachReview: AssignmentDebrief['coachReview'] }) {
  if (coachReview.sessionCount === 0) return null;
  return (
    <SectionCard title="Coach reviews" icon={Star} accent="bg-accent/20 text-accent-foreground">
      <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
        <p className="text-2xl font-display font-bold text-foreground">{coachReview.sessionCount}</p>
        <p className="mt-1 text-sm text-muted-foreground">Sessions with a coach review</p>
      </div>
    </SectionCard>
  );
}

function SuggestedNextCard({ suggestedNext }: { suggestedNext: AssignmentDebrief['suggestedNext'] }) {
  if (suggestedNext.length === 0) return null;
  return (
    <SectionCard title="Suggested next practice" icon={BookOpen} accent="bg-primary/10 text-primary">
      <ul className="space-y-2">
        {suggestedNext.map((item, i) => (
          <li key={i} className="rounded-xl border border-border bg-secondary/40 px-4 py-2.5 text-sm text-foreground">
            {item}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function CaveatsCard({ caveats }: { caveats: AssignmentDebrief['caveats'] }) {
  return (
    <SectionCard title="Caveats" icon={AlertTriangle} accent="bg-muted text-muted-foreground">
      {caveats.length === 0 ? (
        <EmptyState message="No caveats." />
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

export function TeacherAssignmentDebriefPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const [state, dispatch] = useReducer(debriefReducer, { phase: 'loading' });

  useEffect(() => {
    let isActive = true;

    if (!assignmentId) {
      dispatch({ type: 'not-available' });
      return;
    }

    const load = async () => {
      try {
        const debrief = await getAssignmentDebrief(assignmentId);
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
          message: err instanceof Error ? err.message : 'Failed to load assignment debrief.',
        });
      }
    };

    void load();
    return () => {
      isActive = false;
    };
  }, [assignmentId]);

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
            {state.phase === 'error' ? state.message : 'Assignment coaching debrief is not available.'}
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
        <h1 className="text-3xl font-display font-bold text-foreground">Assignment coaching debrief</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Aggregated coaching-process signals across all practice sessions for this assignment.
        </p>
      </div>

      {/* Cards */}
      <ParticipationCard participation={debrief.participation} />
      <UptakeCard uptake={debrief.uptake} />
      <TargetedCorrectionsCard promotions={debrief.promotions} />
      <CoachingInterventionsCard reSteers={debrief.directorReSteers} />
      <HelpUsageCard helpUsage={debrief.helpUsage} />
      <AffectCard affect={debrief.affect} />
      <CoachReviewCard coachReview={debrief.coachReview} />
      <SuggestedNextCard suggestedNext={debrief.suggestedNext} />
      <CaveatsCard caveats={debrief.caveats} />
    </div>
  );
}
