import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Loader2,
  MessageSquareText,
  Users,
} from 'lucide-react';
import { getClassAnalytics } from '@/api/teacher';
import { Alert, AlertDescription, Badge, Button, Card } from '@/components/ui';
import type { ClassAnalyticsData } from '@/types';

export function TeacherClassAnalyticsPage() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<ClassAnalyticsData | null>(null);

  useEffect(() => {
    let isActive = true;

    if (!classId) {
      setLoading(false);
      setError('Class id is required.');
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        const data = await getClassAnalytics(classId);
        if (!isActive) return;
        setAnalytics(data);
        setError(null);
      } catch (err) {
        if (!isActive) return;
        setError(err instanceof Error ? err.message : 'Failed to load class analytics.');
      } finally {
        if (isActive) setLoading(false);
      }
    };

    void load();
    return () => {
      isActive = false;
    };
  }, [classId]);

  if (loading) {
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

  const stats = [
    { label: 'Assignments', value: analytics.summary.assignmentCount, icon: ClipboardList, accent: 'bg-primary/10 text-primary' },
    { label: 'Students enrolled', value: analytics.summary.enrolledStudentCount, icon: Users, accent: 'bg-success/15 text-success' },
    { label: 'Sessions', value: analytics.summary.sessionCount, icon: BarChart3, accent: 'bg-accent/20 text-accent-foreground' },
    { label: 'Speaking minutes', value: Math.round(analytics.summary.estimatedSpeakingTimeSeconds / 60), icon: MessageSquareText, accent: 'bg-secondary text-foreground' },
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
          onClick={() => navigate('/app/teacher')}
        >
          <ArrowLeft size={16} className="mr-2" />
          Back to dashboard
        </Button>
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
              <p className="text-sm text-muted-foreground">Per-assignment practice activity</p>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {analytics.assignments.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
                No assignments have been created for this class yet.
              </div>
            ) : (
              analytics.assignments.map((assignment) => (
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
                    <Badge variant="secondary" size="sm">
                      {assignment.taskType.replaceAll('_', ' ')}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span>{assignment.sessionCount} sessions</span>
                    <span>{assignment.uniqueStudentCount} students</span>
                    <span>{Math.round(assignment.estimatedSpeakingTimeSeconds / 60)} min speaking</span>
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
                    <span>{Math.round(student.estimatedSpeakingTimeSeconds / 60)} min speaking</span>
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
