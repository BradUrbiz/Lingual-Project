import { useCallback, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Filter,
  Loader2,
  MessageSquareText,
  ShieldCheck,
  type LucideIcon,
  Users,
  X,
} from 'lucide-react';
import { getClassAnalytics } from '@/api/teacher';
import { Alert, AlertDescription, Badge, Button, Card } from '@/components/ui';
import { CanvasSyncStatus } from '@/components/canvas/CanvasSyncStatus';
import { OnboardingHint } from '@/components/ui/OnboardingHint';
import { formatSpeakingMinutes } from '@/lib/utils';
import type { ClassAnalyticsData } from '@/types';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
];

const SELECT_STYLE = 'h-9 rounded-xl border-2 border-border bg-card px-3 text-sm text-foreground focus:border-primary focus:outline-none';

type ClassAnalyticsState = {
  loading: boolean;
  error: string | null;
  analytics: ClassAnalyticsData | null;
  dateFrom: string;
  dateTo: string;
  appliedDateFrom: string;
  appliedDateTo: string;
  statusFilter: string;
};

type ClassAnalyticsAction =
  | { type: 'invalid-class' }
  | { type: 'load-start' }
  | { type: 'load-success'; analytics: ClassAnalyticsData }
  | { type: 'load-error'; error: string }
  | { type: 'set-date-from'; value: string }
  | { type: 'set-date-to'; value: string }
  | { type: 'set-status-filter'; value: string }
  | { type: 'apply-date-filter' }
  | { type: 'clear-date-filter' };

const initialClassAnalyticsState: ClassAnalyticsState = {
  loading: true,
  error: null,
  analytics: null,
  dateFrom: '',
  dateTo: '',
  appliedDateFrom: '',
  appliedDateTo: '',
  statusFilter: '',
};

function classAnalyticsReducer(
  state: ClassAnalyticsState,
  action: ClassAnalyticsAction
): ClassAnalyticsState {
  switch (action.type) {
    case 'invalid-class':
      return { ...state, loading: false, error: 'Class id is required.' };
    case 'load-start':
      return { ...state, loading: true };
    case 'load-success':
      return { ...state, loading: false, analytics: action.analytics, error: null };
    case 'load-error':
      return { ...state, loading: false, error: action.error };
    case 'set-date-from':
      return { ...state, dateFrom: action.value };
    case 'set-date-to':
      return { ...state, dateTo: action.value };
    case 'set-status-filter':
      return { ...state, statusFilter: action.value };
    case 'apply-date-filter':
      return { ...state, appliedDateFrom: state.dateFrom, appliedDateTo: state.dateTo };
    case 'clear-date-filter':
      return { ...state, dateFrom: '', dateTo: '', appliedDateFrom: '', appliedDateTo: '' };
    default:
      return state;
  }
}

type AnalyticsStat = {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  accent: string;
};

function AnalyticsStatsGrid({ stats }: { stats: AnalyticsStat[] }) {
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

type ClassAnalyticsFiltersProps = {
  dateFrom: string;
  dateTo: string;
  appliedDateFrom: string;
  appliedDateTo: string;
  statusFilter: string;
  loading: boolean;
  hasActiveDateFilter: boolean;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onApplyDateFilter: () => void;
  onClearDateFilter: () => void;
};

function ClassAnalyticsFilters({
  dateFrom,
  dateTo,
  appliedDateFrom,
  appliedDateTo,
  statusFilter,
  loading,
  hasActiveDateFilter,
  onDateFromChange,
  onDateToChange,
  onStatusFilterChange,
  onApplyDateFilter,
  onClearDateFilter,
}: ClassAnalyticsFiltersProps) {
  return (
    <Card className="border-2 border-border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Filter size={16} />
          Filters
        </div>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">From</span>
          <div className="relative">
            <Calendar className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => onDateFromChange(e.target.value)}
              className={SELECT_STYLE + ' pl-8 w-[160px]'}
            />
          </div>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">To</span>
          <div className="relative">
            <Calendar className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => onDateToChange(e.target.value)}
              className={SELECT_STYLE + ' pl-8 w-[160px]'}
            />
          </div>
        </label>
        <Button size="sm" onClick={onApplyDateFilter} disabled={loading || (!dateFrom && !dateTo)}>
          {loading ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
          Apply
        </Button>
        {hasActiveDateFilter && (
          <Button variant="ghost" size="sm" onClick={onClearDateFilter} disabled={loading}>
            <X size={14} className="mr-1" />
            Clear dates
          </Button>
        )}
        <div className="ml-auto">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Assignment status</span>
            <select
              value={statusFilter}
              onChange={(e) => onStatusFilterChange(e.target.value)}
              className={SELECT_STYLE + ' w-[150px]'}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {hasActiveDateFilter && (
        <p className="mt-2 text-xs text-muted-foreground">
          Showing sessions from{' '}
          <strong>{appliedDateFrom || 'the beginning'}</strong>
          {' to '}
          <strong>{appliedDateTo || 'now'}</strong>
        </p>
      )}
    </Card>
  );
}

type AssignmentActivityCardProps = {
  assignments: ClassAnalyticsData['assignments'];
  classId: string | undefined;
  statusFilter: string;
  onOpenAssignment: (assignmentId: string) => void;
};

function AssignmentActivityCard({
  assignments,
  classId,
  statusFilter,
  onOpenAssignment,
}: AssignmentActivityCardProps) {
  return (
    <Card className="border-3 border-foreground p-6 shadow-stamp">
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-2xl border-2 border-foreground bg-primary text-primary-foreground">
          <ClipboardList size={22} strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">Assignments</h2>
          <p className="text-sm text-muted-foreground">
            Per-assignment practice activity
            {statusFilter ? ` (${statusFilter})` : ''}
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {assignments.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
            {statusFilter
              ? `No ${statusFilter} assignments found.`
              : 'No assignments have been created for this class yet.'}
          </div>
        ) : (
          assignments.map((assignment) => (
            <button
              type="button"
              key={assignment.id}
              className="w-full cursor-pointer rounded-2xl border-2 border-border bg-secondary/40 p-4 text-left transition-colors hover:border-foreground/30"
              onClick={() => onOpenAssignment(assignment.id)}
              disabled={!classId}
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-foreground">{assignment.title}</p>
                <Badge variant={assignment.status === 'published' ? 'success' : 'outline'} size="sm">
                  {assignment.status}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>{assignment.sessionCount} sessions</span>
                <span>{assignment.uniqueStudentCount} students</span>
                <span>{formatSpeakingMinutes(assignment.estimatedSpeakingTimeSeconds)} min speaking</span>
                <span>{assignment.selfCorrectionCount} self-corrections</span>
              </div>
            </button>
          ))
        )}
      </div>
    </Card>
  );
}

type StudentSummaryCardProps = {
  students: ClassAnalyticsData['students'];
  classId: string | undefined;
  onOpenStudent: (studentUid: string) => void;
};

function StudentSummaryCard({ students, classId, onOpenStudent }: StudentSummaryCardProps) {
  return (
    <Card className="border-3 border-foreground p-6 shadow-stamp">
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-2xl border-2 border-foreground bg-success text-success-foreground">
          <Users size={22} strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">Students</h2>
          <p className="text-sm text-muted-foreground">Per-student practice summary</p>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {students.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
            No students have practiced in this class yet.
          </div>
        ) : (
          students.map((student) => (
            <button
              type="button"
              key={student.uid}
              className="w-full cursor-pointer rounded-2xl border-2 border-border bg-secondary/40 p-4 text-left transition-colors hover:border-foreground/30"
              onClick={() => onOpenStudent(student.uid)}
              disabled={!classId}
            >
              <p className="text-sm font-semibold text-foreground">{student.displayName}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>{student.sessionCount} sessions</span>
                <span>{formatSpeakingMinutes(student.estimatedSpeakingTimeSeconds)} min speaking</span>
                <span>{student.totalStudentTurns} turns</span>
                <span>
                  {student.averageStudentWordsPerTurn > 0
                    ? `${student.averageStudentWordsPerTurn} words/turn`
                    : 'no turns yet'}
                </span>
                {student.selfCorrectionCount > 0 && (
                  <span>{student.selfCorrectionCount} self-corrections</span>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </Card>
  );
}

export function TeacherClassAnalyticsPage() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(classAnalyticsReducer, initialClassAnalyticsState);
  const {
    loading,
    error,
    analytics,
    dateFrom,
    dateTo,
    appliedDateFrom,
    appliedDateTo,
    statusFilter,
  } = state;

  const load = useCallback(
    async (filters?: { dateFrom?: string; dateTo?: string }) => {
      if (!classId) return;
      dispatch({ type: 'load-start' });
      try {
        const data = await getClassAnalytics(classId, filters);
        dispatch({ type: 'load-success', analytics: data });
      } catch (err) {
        dispatch({
          type: 'load-error',
          error: err instanceof Error ? err.message : 'Failed to load class analytics.',
        });
      }
    },
    [classId],
  );

  useEffect(() => {
    if (!classId) {
      dispatch({ type: 'invalid-class' });
      return;
    }
    void load();
  }, [classId, load]);

  const applyDateFilter = () => {
    dispatch({ type: 'apply-date-filter' });
    const filters: { dateFrom?: string; dateTo?: string } = {};
    if (dateFrom) filters.dateFrom = new Date(dateFrom).toISOString();
    if (dateTo) {
      // Set to end of day
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      filters.dateTo = end.toISOString();
    }
    void load(filters);
  };

  const clearDateFilter = () => {
    dispatch({ type: 'clear-date-filter' });
    void load();
  };

  const hasActiveDateFilter = appliedDateFrom || appliedDateTo;

  // Client-side assignment status filter
  const filteredAssignments = useMemo(() => {
    if (!analytics) return [];
    if (!statusFilter) return analytics.assignments;
    return analytics.assignments.filter((a) => a.status === statusFilter);
  }, [analytics, statusFilter]);

  if (loading && !analytics) {
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
          <AlertDescription>{error || 'Class analytics are unavailable.'}</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => navigate('/app/teacher')}>
          Back to dashboard
        </Button>
      </div>
    );
  }

  const avgSessionsPerStudent =
    analytics.summary.enrolledStudentCount > 0
      ? (analytics.summary.sessionCount / analytics.summary.enrolledStudentCount).toFixed(1)
      : '0';

  const stats = [
    { label: 'Assignments', value: analytics.summary.assignmentCount, icon: ClipboardList, accent: 'bg-primary/10 text-primary' },
    { label: 'Students enrolled', value: analytics.summary.enrolledStudentCount, icon: Users, accent: 'bg-success/15 text-success' },
    { label: 'Avg sessions / student', value: avgSessionsPerStudent, icon: BarChart3, accent: 'bg-accent/20 text-accent-foreground' },
    { label: 'Speaking minutes', value: formatSpeakingMinutes(analytics.summary.estimatedSpeakingTimeSeconds), icon: MessageSquareText, accent: 'bg-secondary text-foreground' },
    { label: 'Self-corrections', value: analytics.summary.selfCorrectionCount, icon: CheckCircle2, accent: 'bg-primary/5 text-foreground' },
    { label: 'Repeated errors', value: analytics.summary.repeatedErrorCount, icon: AlertTriangle, accent: 'bg-destructive/10 text-destructive' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-4 flex flex-wrap gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/app/teacher')}
          >
            <ArrowLeft size={16} className="mr-2" />
            Back to dashboard
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/app/teacher/classes/${classId}/compliance`)}
          >
            <ShieldCheck size={16} className="mr-2" />
            Compliance ops
          </Button>
        </div>
        {classId && <CanvasSyncStatus classId={classId} />}
        <h1 className="text-3xl font-display font-bold text-foreground">{analytics.class.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {analytics.class.subject || 'Language practice'} · {analytics.class.term || 'Current term'}
          {analytics.class.gradeBand ? ` · ${analytics.class.gradeBand}` : ''}
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

      {analytics && (
        <>
          <OnboardingHint
            show={analytics.summary.enrolledStudentCount === 0}
            message="Share the join code with your students to get started."
            ctaLabel="Manage Join Code"
            ctaTo={`/app/teacher`}
          />
          <OnboardingHint
            show={analytics.summary.enrolledStudentCount > 0 && analytics.assignments.length === 0}
            message="Map your curriculum to create assignments."
            ctaLabel="Map Curriculum"
            ctaTo={`/app/teacher/classes/${classId}/assignments`}
          />
          <OnboardingHint
            show={analytics.summary.enrolledStudentCount > 0 && analytics.assignments.length > 0 && analytics.assignments.every((a: { sessionCount?: number }) => (a.sessionCount ?? 0) === 0)}
            message="Your assignments are ready - students can start practicing."
          />
        </>
      )}

      <ClassAnalyticsFilters
        dateFrom={dateFrom}
        dateTo={dateTo}
        appliedDateFrom={appliedDateFrom}
        appliedDateTo={appliedDateTo}
        statusFilter={statusFilter}
        loading={loading}
        hasActiveDateFilter={Boolean(hasActiveDateFilter)}
        onDateFromChange={(value) => dispatch({ type: 'set-date-from', value })}
        onDateToChange={(value) => dispatch({ type: 'set-date-to', value })}
        onStatusFilterChange={(value) => dispatch({ type: 'set-status-filter', value })}
        onApplyDateFilter={applyDateFilter}
        onClearDateFilter={clearDateFilter}
      />

      <AnalyticsStatsGrid stats={stats} />

      <div className="grid gap-6 xl:grid-cols-2">
        <AssignmentActivityCard
          assignments={filteredAssignments}
          classId={classId}
          statusFilter={statusFilter}
          onOpenAssignment={(assignmentId) => navigate(`/app/teacher/classes/${classId}/assignments/${assignmentId}/analytics`)}
        />
        <StudentSummaryCard
          students={analytics.students}
          classId={classId}
          onOpenStudent={(studentUid) => navigate(`/app/teacher/classes/${classId}/students/${studentUid}/analytics`)}
        />
      </div>
    </div>
  );
}
