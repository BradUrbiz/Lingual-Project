import { useCallback, useEffect, useMemo, useState } from 'react';
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

export function TeacherClassAnalyticsPage() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<ClassAnalyticsData | null>(null);

  // Filter state
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [appliedDateFrom, setAppliedDateFrom] = useState('');
  const [appliedDateTo, setAppliedDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(
    async (filters?: { dateFrom?: string; dateTo?: string }) => {
      if (!classId) return;
      setLoading(true);
      try {
        const data = await getClassAnalytics(classId, filters);
        setAnalytics(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load class analytics.');
      } finally {
        setLoading(false);
      }
    },
    [classId],
  );

  useEffect(() => {
    if (!classId) {
      setLoading(false);
      setError('Class id is required.');
      return;
    }
    void load();
  }, [classId, load]);

  const applyDateFilter = () => {
    setAppliedDateFrom(dateFrom);
    setAppliedDateTo(dateTo);
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
    setDateFrom('');
    setDateTo('');
    setAppliedDateFrom('');
    setAppliedDateTo('');
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
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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

  const selectStyle = 'h-9 rounded-xl border-2 border-border bg-card px-3 text-sm text-foreground focus:border-primary focus:outline-none';

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
          <AlertTriangle className="h-4 w-4" />
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
            message="Your assignments are ready — students can start practicing."
          />
        </>
      )}

      {/* Date range filter */}
      <Card className="border-2 border-border p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Filter size={16} />
            Filters
          </div>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">From</span>
            <div className="relative">
              <Calendar className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className={selectStyle + ' pl-8 w-[160px]'}
              />
            </div>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">To</span>
            <div className="relative">
              <Calendar className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className={selectStyle + ' pl-8 w-[160px]'}
              />
            </div>
          </label>
          <Button size="sm" onClick={applyDateFilter} disabled={loading || (!dateFrom && !dateTo)}>
            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Apply
          </Button>
          {hasActiveDateFilter && (
            <Button variant="ghost" size="sm" onClick={clearDateFilter} disabled={loading}>
              <X size={14} className="mr-1" />
              Clear dates
            </Button>
          )}
          <div className="ml-auto">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Assignment status</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className={selectStyle + ' w-[150px]'}
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

      {/* Summary stats */}
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

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Assignment breakdown */}
        <Card className="border-3 border-foreground p-6 shadow-stamp">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-foreground bg-primary text-primary-foreground">
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
            {filteredAssignments.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
                {statusFilter
                  ? `No ${statusFilter} assignments found.`
                  : 'No assignments have been created for this class yet.'}
              </div>
            ) : (
              filteredAssignments.map((assignment) => (
                <div
                  key={assignment.id}
                  className="cursor-pointer rounded-2xl border-2 border-border bg-secondary/40 p-4 transition-colors hover:border-foreground/30"
                  onClick={() => navigate(`/app/teacher/classes/${classId}/assignments/${assignment.id}/analytics`)}
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
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Student roster */}
        <Card className="border-3 border-foreground p-6 shadow-stamp">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-foreground bg-success text-success-foreground">
              <Users size={22} strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-xl font-display font-bold text-foreground">Students</h2>
              <p className="text-sm text-muted-foreground">Per-student practice summary</p>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {analytics.students.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
                No students have practiced in this class yet.
              </div>
            ) : (
              analytics.students.map((student) => (
                <div
                  key={student.uid}
                  className="cursor-pointer rounded-2xl border-2 border-border bg-secondary/40 p-4 transition-colors hover:border-foreground/30"
                  onClick={() => navigate(`/app/teacher/classes/${classId}/students/${student.uid}/analytics`)}
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
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
