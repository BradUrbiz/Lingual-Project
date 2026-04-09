import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Gamepad2,
  GraduationCap,
  Loader2,
  MessageSquare,
  Users,
} from 'lucide-react';
import { getStudentAssignments } from '@/api/assignments';
import { getStudentCanvasContent } from '@/api/canvas';
import { getStudentClasses, leaveStudentClass, setActiveMembership, joinClassByCode } from '@/api/schools';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@/components/ui';
import { CanvasModuleView } from '@/components/canvas/CanvasModuleView';
import { ServiceNavigationCard } from '@/components/dashboard';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import type { StudentAssignmentSummary, TeacherClassSummary } from '@/types';
import type { CanvasCourseContentItem } from '@/types/canvas';

export function AppLearningPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { refreshUser } = useAuth();
  const surfaceClass = 'rounded-2xl border-3 border-foreground bg-card shadow-stamp';
  const [classes, setClasses] = useState<TeacherClassSummary[]>([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [classError, setClassError] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<StudentAssignmentSummary[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(true);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [canvasContent, setCanvasContent] = useState<CanvasCourseContentItem[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinSuccess, setJoinSuccess] = useState<string | null>(null);
  const [selectedClass, setSelectedClass] = useState<TeacherClassSummary | null>(null);
  const [isLeavingClass, setIsLeavingClass] = useState(false);

  const loadDashboardData = useCallback(async () => {
    setClassesLoading(true);
    setAssignmentsLoading(true);
    try {
      const [classesResult, assignmentsResult] = await Promise.allSettled([
        getStudentClasses(),
        getStudentAssignments(),
      ]);

      let classIds: string[] = [];

      if (classesResult.status === 'fulfilled') {
        setClasses(classesResult.value);
        setClassError(null);
        classIds = classesResult.value.map((classSummary) => classSummary.id);
      } else {
        setClasses([]);
        setClassError(classesResult.reason instanceof Error ? classesResult.reason.message : 'Failed to load classes.');
      }

      if (assignmentsResult.status === 'fulfilled') {
        setAssignments(assignmentsResult.value);
        setAssignmentError(null);
        if (!classIds.length) {
          classIds = assignmentsResult.value.map((assignment) => assignment.classId).filter(Boolean) as string[];
        }
      } else {
        setAssignments([]);
        setAssignmentError(
          assignmentsResult.reason instanceof Error
            ? assignmentsResult.reason.message
            : 'Failed to load assignments.'
        );
      }

      const uniqueClassIds = [...new Set(classIds)];
      const contentResults = await Promise.all(
        uniqueClassIds.map((classId) =>
          getStudentCanvasContent(classId).catch(() => [] as CanvasCourseContentItem[])
        ),
      );
      setCanvasContent(contentResults.flat());
    } catch (error) {
      setClasses([]);
      setAssignments([]);
      setClassError(error instanceof Error ? error.message : 'Failed to load classes.');
      setAssignmentError(error instanceof Error ? error.message : 'Failed to load assignments.');
      setCanvasContent([]);
    } finally {
      setClassesLoading(false);
      setAssignmentsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboardData();
  }, [loadDashboardData]);

  const handleJoinCodeChange = (value: string) => {
    setJoinCode(value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
    setJoinError(null);
    setJoinSuccess(null);
  };

  const handleJoinClass = async () => {
    if (joinCode.length !== 6) {
      setJoinError('Enter the 6-character class code your teacher shared.');
      return;
    }

    setJoinLoading(true);
    setJoinError(null);
    setJoinSuccess(null);

    try {
      const result = await joinClassByCode(joinCode);
      if (result.membershipId) {
        await setActiveMembership(result.membershipId);
      }
      await refreshUser();
      await loadDashboardData();
      setJoinCode('');
      setJoinSuccess(
        result.alreadyEnrolled
          ? `You are already enrolled in ${result.class.name}.`
          : `Joined ${result.class.name}. New assignments will appear here when available.`,
      );
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : 'Failed to join class. Please try again.');
    } finally {
      setJoinLoading(false);
    }
  };

  const handleLeaveClass = async () => {
    if (!selectedClass) return;

    setIsLeavingClass(true);
    setJoinError(null);
    setJoinSuccess(null);

    try {
      const leftClass = await leaveStudentClass(selectedClass.id);
      await refreshUser();
      await loadDashboardData();
      setJoinSuccess(`Left ${leftClass.name}.`);
      setSelectedClass(null);
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : 'Failed to leave class. Please try again.');
    } finally {
      setIsLeavingClass(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border-3 border-foreground bg-primary text-primary-foreground shadow-stamp-sm">
          <BookOpen size={24} strokeWidth={2.5} />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
            {t('app.layout.nav.learning') || 'Learning'}
          </p>
          <h1 className="text-3xl font-display font-bold text-foreground">
            {t('app.dashboard.title') || 'Learning Dashboard'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('app.dashboard.subtitle') || 'Your learning hub — pick up where you left off'}
          </p>
        </div>
      </header>

      <section className={`${surfaceClass} p-5`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-foreground bg-primary/10 text-primary">
                <Users size={20} strokeWidth={2.5} />
              </div>
              <div>
                <h2 className="text-lg font-display font-bold text-foreground">Join a classroom</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Enter your teacher&apos;s 6-character class code to connect this dashboard to assigned practice.
                </p>
              </div>
            </div>
          </div>
          <div className="flex w-full flex-col gap-3 lg:max-w-md">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                value={joinCode}
                onChange={(event) => handleJoinCodeChange(event.target.value)}
                placeholder="ABC123"
                maxLength={6}
                className="text-center font-mono text-lg tracking-[0.28em] uppercase"
                aria-label="Class join code"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void handleJoinClass();
                  }
                }}
              />
              <Button
                type="button"
                onClick={() => {
                  void handleJoinClass();
                }}
                disabled={joinLoading || joinCode.length !== 6}
                className="sm:min-w-[170px]"
              >
                {joinLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Joining...
                  </>
                ) : (
                  <>
                    Join class
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
            {joinError ? (
              <Alert variant="destructive">
                <AlertDescription>{joinError}</AlertDescription>
              </Alert>
            ) : null}
            {joinSuccess ? (
              <Alert variant="success">
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Class connected</AlertTitle>
                <AlertDescription>{joinSuccess}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </div>
      </section>

      <section className={`${surfaceClass} p-6`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-display font-bold text-foreground">Your classes and assignments</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              See the classes you&apos;re in and the practice your teachers assign there.
            </p>
          </div>
          <Badge variant="secondary" size="sm">
            {assignments.length} active
          </Badge>
        </div>

        {classError ? (
          <Alert className="mt-5">
            <AlertDescription>{classError}</AlertDescription>
          </Alert>
        ) : null}

        {assignmentError ? (
          <Alert className="mt-5">
            <AlertDescription>{assignmentError}</AlertDescription>
          </Alert>
        ) : null}

        {classesLoading ? (
          <div className="mt-5 flex items-center gap-3 rounded-2xl border-2 border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading classes...
          </div>
        ) : classes.length > 0 ? (
          <div className="mt-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Classes you are in
            </p>
            <div className="flex flex-wrap gap-2">
              {classes.map((classSummary) => (
                <button
                  type="button"
                  key={classSummary.id}
                  onClick={() => setSelectedClass(classSummary)}
                  className="inline-flex items-center gap-2 rounded-full border-2 border-border bg-secondary px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:border-foreground hover:bg-card"
                >
                  <span>{classSummary.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {classSummary.assignmentCount ?? 0} assignments
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border-2 border-dashed border-border bg-secondary/30 p-5 text-sm text-muted-foreground">
            Join a classroom with your teacher&apos;s code and it will appear here.
          </div>
        )}

        {assignmentsLoading ? (
          <div className="mt-6 flex items-center gap-3 rounded-2xl border-2 border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading assignments...
          </div>
        ) : assignments.length === 0 ? (
          <div className="mt-6 rounded-3xl border-3 border-dashed border-border bg-secondary/40 p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-foreground bg-card">
              <GraduationCap size={24} strokeWidth={2.5} />
            </div>
            <h3 className="mt-4 text-xl font-display font-bold text-foreground">No school assignments yet</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {classes.length > 0
                ? 'You are enrolled in classes. Assignments will show up here when your teacher publishes them.'
                : 'When a teacher publishes an assignment for your class, it will show up here.'}
            </p>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {assignments.map((assignment) => (
              <div key={assignment.id} className="rounded-2xl border-2 border-border bg-secondary/40 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={assignment.status === 'published' ? 'success' : 'outline'} size="sm">
                    {assignment.status}
                  </Badge>
                  <Badge variant="secondary" size="sm">
                    {assignment.taskType.replace('_', ' ')}
                  </Badge>
                </div>
                <h3 className="mt-4 text-xl font-display font-bold text-foreground">{assignment.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {assignment.className || 'Your class'} {assignment.dueAt ? `· Due ${assignment.dueAt}` : ''}
                </p>
                <p className="mt-3 text-sm text-foreground/80">
                  {assignment.description || 'Assignment details will be shown on the launch page.'}
                </p>
                <Button className="mt-5" onClick={() => navigate(`/app/assignments/${assignment.id}`)}>
                  Launch assignment
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {canvasContent.length > 0 && (
        <section className={`${surfaceClass} p-6`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-display font-bold text-foreground">Course modules</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Canvas course content from your enrolled classes.
              </p>
            </div>
          </div>
          <div className="mt-5">
            <CanvasModuleView
              items={canvasContent}
              linkedAssignments={Object.fromEntries(
                canvasContent
                  .filter((c) => c.lingualAssignmentId)
                  .map((c) => [c.canvasItemId, c.lingualAssignmentId!]),
              )}
              onLaunchAssignment={(assignmentId) => navigate(`/app/assignments/${assignmentId}`)}
            />
          </div>
        </section>
      )}

      <section className={`${surfaceClass} p-6`}>
        <div className="mb-5">
          <h2 className="text-lg font-display font-bold text-foreground">
            {t('app.dashboard.services') || 'Free Practice'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('app.dashboard.nextStep') || 'Pick your next practice route.'}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ServiceNavigationCard
            title={t('app.dashboard.card.chat.title') || 'AI Chat'}
            description={t('app.dashboard.card.chat.description') || 'Practice conversation with your AI tutor'}
            icon={<MessageSquare size={22} strokeWidth={2.5} />}
            href="/app/chat"
            color="primary"
          />
          <ServiceNavigationCard
            title={t('app.dashboard.card.games.title') || 'Practice Games'}
            description={t('app.dashboard.card.games.description') || 'Flashcards, word matching, and more'}
            icon={<Gamepad2 size={22} strokeWidth={2.5} />}
            href="/app/games"
            color="accent"
          />
        </div>
      </section>

      <Dialog open={Boolean(selectedClass)} onOpenChange={(open) => {
        if (!open && !isLeavingClass) {
          setSelectedClass(null);
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedClass?.name || 'Classroom'}</DialogTitle>
            <DialogDescription>
              Leave this classroom if you no longer want assignments and course content from it on your dashboard.
            </DialogDescription>
          </DialogHeader>
          {selectedClass ? (
            <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
              {selectedClass.subject || 'Subject TBD'}
              {selectedClass.term ? ` · ${selectedClass.term}` : ''}
              {selectedClass.gradeBand ? ` · Grades ${selectedClass.gradeBand}` : ''}
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setSelectedClass(null)}
              disabled={isLeavingClass}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void handleLeaveClass();
              }}
              loading={isLeavingClass}
            >
              Leave classroom
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
