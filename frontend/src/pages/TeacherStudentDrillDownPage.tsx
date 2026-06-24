import { useEffect, useReducer, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Loader2,
  MessageSquareText,
  Scale,
  Target,
  type LucideIcon,
  Users,
} from 'lucide-react';
import {
  getStudentCompliance,
  getStudentDrillDown,
  updateStudentCompliance,
} from '@/api/teacher';
import { Alert, AlertDescription, Badge, Button, Card } from '@/components/ui';
import { formatSpeakingMinutes } from '@/lib/utils';
import type {
  ConsentStatus,
  StudentComplianceRecord,
  StudentDrillDownData,
} from '@/types';

const CONSENT_OPTIONS: Array<{ value: ConsentStatus; label: string }> = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'granted', label: 'Granted' },
  { value: 'revoked', label: 'Revoked' },
  { value: 'not_required', label: 'Not required' },
];

const RETENTION_OPTIONS = [
  { value: 'standard_school', label: 'Standard school retention' },
  { value: 'no_raw_audio', label: 'No raw audio retention' },
];

type ComplianceDraft = {
  isMinor: boolean;
  guardianConsentStatus: ConsentStatus;
  voiceConsentStatus: ConsentStatus;
  textAllowed: boolean;
  retentionPolicyId: string;
};

const DEFAULT_COMPLIANCE_DRAFT: ComplianceDraft = {
  isMinor: true,
  guardianConsentStatus: 'unknown',
  voiceConsentStatus: 'unknown',
  textAllowed: true,
  retentionPolicyId: 'standard_school',
};

function createComplianceDraft(record: StudentComplianceRecord): ComplianceDraft {
  return {
    isMinor: record.isMinor,
    guardianConsentStatus: record.guardianConsentStatus as ConsentStatus,
    voiceConsentStatus: record.voiceConsentStatus as ConsentStatus,
    textAllowed: record.textAllowed,
    retentionPolicyId: record.retentionPolicyId,
  };
}

type StudentDrillDownState = {
  loading: boolean;
  error: string | null;
  analytics: StudentDrillDownData | null;
  compliance: StudentComplianceRecord | null;
  complianceError: string | null;
  isSavingCompliance: boolean;
  complianceDraft: ComplianceDraft;
};

type StudentDrillDownAction =
  | { type: 'invalid-route' }
  | { type: 'load-start' }
  | { type: 'load-success'; analytics: StudentDrillDownData; compliance: StudentComplianceRecord }
  | { type: 'load-error'; error: string }
  | { type: 'patch-compliance-draft'; patch: Partial<ComplianceDraft> }
  | { type: 'save-start' }
  | { type: 'save-success'; compliance: StudentComplianceRecord }
  | { type: 'save-error'; error: string };

const initialStudentDrillDownState: StudentDrillDownState = {
  loading: true,
  error: null,
  analytics: null,
  compliance: null,
  complianceError: null,
  isSavingCompliance: false,
  complianceDraft: DEFAULT_COMPLIANCE_DRAFT,
};

function studentDrillDownReducer(
  state: StudentDrillDownState,
  action: StudentDrillDownAction
): StudentDrillDownState {
  switch (action.type) {
    case 'invalid-route':
      return { ...state, loading: false, error: 'Class id and student id are required.' };
    case 'load-start':
      return { ...state, loading: true };
    case 'load-success':
      return {
        ...state,
        loading: false,
        analytics: action.analytics,
        compliance: action.compliance,
        complianceDraft: createComplianceDraft(action.compliance),
        complianceError: null,
        error: null,
      };
    case 'load-error':
      return { ...state, loading: false, error: action.error };
    case 'patch-compliance-draft':
      return { ...state, complianceDraft: { ...state.complianceDraft, ...action.patch } };
    case 'save-start':
      return { ...state, complianceError: null, isSavingCompliance: true };
    case 'save-success':
      return {
        ...state,
        compliance: action.compliance,
        complianceDraft: createComplianceDraft(action.compliance),
        isSavingCompliance: false,
      };
    case 'save-error':
      return { ...state, complianceError: action.error, isSavingCompliance: false };
    default:
      return state;
  }
}

type StudentStat = {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  accent: string;
};

function StudentStatsGrid({ stats }: { stats: StudentStat[] }) {
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-6">
      {stats.map((stat) => (
        <Card key={stat.label} className="border-3 border-foreground p-5 shadow-stamp">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-foreground ${stat.accent}`}>
              <stat.icon size={22} strokeWidth={2.5} />
            </div>
          </div>
          <p className="text-3xl font-display font-bold text-foreground">{stat.value}</p>
          <p className="mt-1 text-sm font-medium text-muted-foreground">{stat.label}</p>
        </Card>
      ))}
    </div>
  );
}

function AssignmentBreakdownCard({
  assignments,
  onOpenAssignment,
}: {
  assignments: StudentDrillDownData['assignments'];
  onOpenAssignment: (assignmentId: string) => void;
}) {
  return (
    <Card className="border-3 border-foreground p-6 shadow-stamp">
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-2xl border-2 border-foreground bg-primary text-primary-foreground">
          <ClipboardList size={22} strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">Assignment breakdown</h2>
          <p className="text-sm text-muted-foreground">Practice activity per assignment</p>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {assignments.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
            No assignment sessions recorded for this student yet.
          </div>
        ) : (
          assignments.map((assignment) => (
            <button
              type="button"
              key={assignment.id}
              className="w-full cursor-pointer rounded-2xl border-2 border-border bg-secondary/40 p-4 text-left transition-colors hover:border-foreground/30"
              onClick={() => onOpenAssignment(assignment.id)}
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-foreground">{assignment.title}</p>
                <Badge variant={assignment.status === 'published' ? 'success' : 'outline'} size="sm">
                  {assignment.status}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>{assignment.sessionCount} sessions</span>
                <span>{formatSpeakingMinutes(assignment.estimatedSpeakingTimeSeconds)} min</span>
                <span>{assignment.totalStudentTurns} turns</span>
                <span>{assignment.selfCorrectionCount} self-corrections</span>
              </div>

              {assignment.targetExpressionTotalHits > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(assignment.targetExpressionHits).map(([expr, count]) => (
                    <Badge key={expr} variant="outline" size="sm">
                      {expr}: {count}
                    </Badge>
                  ))}
                </div>
              )}

              {assignment.rubricDimensionScores.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Scale size={14} className="text-muted-foreground" />
                  {assignment.rubricDimensionScores.map((dim) => (
                    <Badge key={dim.id} variant="secondary" size="sm">
                      {dim.id}: {dim.score.toFixed(2)}
                    </Badge>
                  ))}
                  {typeof assignment.rubricAverageScore === 'number' && (
                    <Badge variant="accent" size="sm">
                      avg {assignment.rubricAverageScore.toFixed(2)}
                    </Badge>
                  )}
                </div>
              )}
            </button>
          ))
        )}
      </div>
    </Card>
  );
}

type ConsentModalityCardProps = {
  compliance: StudentComplianceRecord | null;
  complianceDraft: ComplianceDraft;
  complianceError: string | null;
  isSavingCompliance: boolean;
  onDraftChange: (patch: Partial<ComplianceDraft>) => void;
  onSave: () => void;
};

function ConsentModalityCard({
  compliance,
  complianceDraft,
  complianceError,
  isSavingCompliance,
  onDraftChange,
  onSave,
}: ConsentModalityCardProps) {
  return (
    <Card className="border-3 border-foreground p-6 shadow-stamp">
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-2xl border-2 border-foreground bg-accent/20 text-accent-foreground">
          <CheckCircle2 size={22} strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">Consent and modality</h2>
          <p className="text-sm text-muted-foreground">Voice launch eligibility for this student.</p>
        </div>
      </div>

      {compliance ? (
        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant={compliance.voiceAllowed ? 'success' : 'outline'} size="sm">
              Voice {compliance.voiceAllowed ? 'allowed' : 'blocked'}
            </Badge>
            <Badge variant={compliance.textAllowed ? 'accent' : 'outline'} size="sm">
              Text {compliance.textAllowed ? 'allowed' : 'blocked'}
            </Badge>
            <Badge variant="secondary" size="sm">
              {compliance.retentionPolicy.label}
            </Badge>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-medium text-foreground">
              <span>Voice consent</span>
              <select
                value={complianceDraft.voiceConsentStatus}
                onChange={(event) => onDraftChange({ voiceConsentStatus: event.target.value as ConsentStatus })}
                className="w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none"
              >
                {CONSENT_OPTIONS.flatMap((option) => (
                  option.value === 'not_required'
                    ? []
                    : [<option key={option.value} value={option.value}>{option.label}</option>]
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm font-medium text-foreground">
              <span>Retention policy</span>
              <select
                value={complianceDraft.retentionPolicyId}
                onChange={(event) => onDraftChange({ retentionPolicyId: event.target.value })}
                className="w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none"
              >
                {RETENTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex items-center gap-3 rounded-2xl border-2 border-border bg-secondary/40 px-4 py-3 text-sm font-medium text-foreground">
            <input
              type="checkbox"
              checked={complianceDraft.textAllowed}
              onChange={(event) => onDraftChange({ textAllowed: event.target.checked })}
              className="size-4 rounded border-border"
            />
            Text launch allowed for this student
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={onSave} loading={isSavingCompliance}>
              Save consent state
            </Button>
            <p className="text-sm text-muted-foreground">
              Last verified: {compliance.lastVerifiedAt || 'not recorded'}
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
          Consent state is unavailable for this student.
        </div>
      )}

      {complianceError ? (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{complianceError}</AlertDescription>
        </Alert>
      ) : null}
    </Card>
  );
}

function RepeatedErrorsCard({ repeatedErrors }: { repeatedErrors: StudentDrillDownData['repeatedErrors'] }) {
  return (
    <Card className="border-3 border-foreground p-6 shadow-stamp">
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-2xl border-2 border-foreground bg-destructive/80 text-destructive-foreground">
          <AlertTriangle size={22} strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">Repeated errors</h2>
          <p className="text-sm text-muted-foreground">Error patterns across all assignments</p>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {repeatedErrors.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
            No repeated error patterns detected yet.
          </div>
        ) : (
          repeatedErrors.map((err) => (
            <div key={err.id} className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-foreground">{err.label}</p>
                <Badge variant="outline" size="sm">{err.category}</Badge>
                <Badge variant="secondary" size="sm">count {err.count}</Badge>
              </div>
              {err.rubricDimensionIds.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Rubric: {err.rubricDimensionIds.join(', ')}
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function RecentSessionsCard({
  recentSessions,
  debriefEnabled,
}: {
  recentSessions: StudentDrillDownData['recentSessions'];
  debriefEnabled?: boolean;
}) {
  return (
    <Card className="border-3 border-foreground p-6 shadow-stamp">
      <h2 className="text-xl font-display font-bold text-foreground">Recent sessions</h2>
      <div className="mt-5 space-y-3">
        {recentSessions.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
            No practice sessions recorded yet.
          </div>
        ) : (
          recentSessions.map((session) => (
            <div key={session.id} className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" size="sm">{session.status}</Badge>
                <Badge variant="secondary" size="sm">Turns {session.sessionSummary.studentTurnCount}</Badge>
                {debriefEnabled ? (
                  <Link
                    to={`/app/teacher/practice-sessions/${session.id}/debrief`}
                    className="ml-auto text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    View debrief
                  </Link>
                ) : null}
              </div>
              <p className="mt-3 text-sm text-foreground">
                Speaking {session.sessionSummary.estimatedSpeakingTimeSeconds}s · Self-corrections{' '}
                {session.sessionSummary.selfCorrectionCount} · Task completions {session.sessionSummary.taskCompletionCount}
              </p>
              {session.sessionSummary.endedReason ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Ended: {session.sessionSummary.endedReason}
                </p>
              ) : null}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

export function TeacherStudentDrillDownPage() {
  const { classId, studentUid } = useParams<{ classId: string; studentUid: string }>();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(studentDrillDownReducer, initialStudentDrillDownState);
  const {
    loading,
    error,
    analytics,
    compliance,
    complianceError,
    isSavingCompliance,
    complianceDraft,
  } = state;

  useEffect(() => {
    let isActive = true;

    if (!classId || !studentUid) {
      dispatch({ type: 'invalid-route' });
      return;
    }

    const load = async () => {
      dispatch({ type: 'load-start' });
      try {
        const [data, complianceRecord] = await Promise.all([
          getStudentDrillDown(classId, studentUid),
          getStudentCompliance(classId, studentUid),
        ]);
        if (!isActive) return;
        dispatch({ type: 'load-success', analytics: data, compliance: complianceRecord });
      } catch (err) {
        if (!isActive) return;
        dispatch({
          type: 'load-error',
          error: err instanceof Error ? err.message : 'Failed to load student analytics.',
        });
      }
    };

    void load();
    return () => {
      isActive = false;
    };
  }, [classId, studentUid]);

  const handleComplianceSave = async () => {
    if (!classId || !studentUid) return;
    dispatch({ type: 'save-start' });
    try {
      const updated = await updateStudentCompliance(classId, studentUid, complianceDraft);
      dispatch({ type: 'save-success', compliance: updated });
    } catch (err) {
      dispatch({
        type: 'save-error',
        error: err instanceof Error ? err.message : 'Failed to update consent state.',
      });
    }
  };

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
          <AlertDescription>{error || 'Student analytics are unavailable.'}</AlertDescription>
        </Alert>
        <Button
          variant="outline"
          onClick={() => navigate(classId ? `/app/teacher/classes/${classId}/analytics` : '/app/teacher')}
        >
          Back to class
        </Button>
      </div>
    );
  }

  const stats = [
    { label: 'Sessions', value: analytics.summary.sessionCount, icon: BarChart3, accent: 'bg-primary/10 text-primary' },
    { label: 'Student turns', value: analytics.summary.totalStudentTurns, icon: Users, accent: 'bg-success/15 text-success' },
    { label: 'Speaking minutes', value: formatSpeakingMinutes(analytics.summary.estimatedSpeakingTimeSeconds), icon: MessageSquareText, accent: 'bg-accent/20 text-accent-foreground' },
    { label: 'Words / turn', value: analytics.summary.averageStudentWordsPerTurn > 0 ? analytics.summary.averageStudentWordsPerTurn.toFixed(1) : '0', icon: Target, accent: 'bg-secondary text-foreground' },
    { label: 'Self-corrections', value: analytics.summary.selfCorrectionCount, icon: CheckCircle2, accent: 'bg-primary/5 text-foreground' },
    { label: 'Repeated errors', value: analytics.summary.repeatedErrorCount, icon: AlertTriangle, accent: 'bg-destructive/10 text-destructive' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="outline"
          size="sm"
          className="mb-4"
          onClick={() => navigate(`/app/teacher/classes/${classId}/analytics`)}
        >
          <ArrowLeft size={16} className="mr-2" />
          Back to class
        </Button>
        <h1 className="text-3xl font-display font-bold text-foreground">{analytics.student.displayName}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {analytics.class.name} · {analytics.class.subject || 'Language practice'} · {analytics.class.term || 'Current term'}
        </p>
      </div>

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

      <StudentStatsGrid stats={stats} />

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <AssignmentBreakdownCard
            assignments={analytics.assignments}
            onOpenAssignment={(assignmentId) => navigate(`/app/teacher/classes/${classId}/assignments/${assignmentId}/analytics`)}
          />
        </div>

        <div className="space-y-6">
          <ConsentModalityCard
            compliance={compliance}
            complianceDraft={complianceDraft}
            complianceError={complianceError}
            isSavingCompliance={isSavingCompliance}
            onDraftChange={(patch) => dispatch({ type: 'patch-compliance-draft', patch })}
            onSave={() => void handleComplianceSave()}
          />
          <RepeatedErrorsCard repeatedErrors={analytics.repeatedErrors} />
          <RecentSessionsCard recentSessions={analytics.recentSessions} debriefEnabled={analytics.debriefEnabled} />
        </div>
      </div>
    </div>
  );
}
