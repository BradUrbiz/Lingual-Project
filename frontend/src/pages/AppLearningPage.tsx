import { useCallback, useEffect, useReducer } from 'react';
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

const SURFACE_CLASS = 'rounded-2xl border-3 border-foreground bg-card shadow-stamp';

type LearningPageState = {
  classes: TeacherClassSummary[];
  classesLoading: boolean;
  classError: string | null;
  assignments: StudentAssignmentSummary[];
  assignmentsLoading: boolean;
  assignmentError: string | null;
  canvasContent: CanvasCourseContentItem[];
  joinCode: string;
  joinLoading: boolean;
  joinError: string | null;
  joinSuccess: string | null;
  selectedClass: TeacherClassSummary | null;
  isLeavingClass: boolean;
};

type DashboardPayload = Pick<
  LearningPageState,
  'classes' | 'classError' | 'assignments' | 'assignmentError' | 'canvasContent'
>;

type LearningPageAction =
  | { type: 'dashboard:loading' }
  | { type: 'dashboard:loaded'; payload: DashboardPayload }
  | { type: 'dashboard:failed'; message: string }
  | { type: 'join:codeChanged'; value: string }
  | { type: 'join:started' }
  | { type: 'join:succeeded'; message: string }
  | { type: 'join:failed'; message: string }
  | { type: 'class:selected'; classSummary: TeacherClassSummary }
  | { type: 'class:dialogClosed' }
  | { type: 'class:leaveStarted' }
  | { type: 'class:leaveSucceeded'; message: string }
  | { type: 'class:leaveFailed'; message: string };

const initialLearningPageState: LearningPageState = {
  classes: [],
  classesLoading: true,
  classError: null,
  assignments: [],
  assignmentsLoading: true,
  assignmentError: null,
  canvasContent: [],
  joinCode: '',
  joinLoading: false,
  joinError: null,
  joinSuccess: null,
  selectedClass: null,
  isLeavingClass: false,
};

function learningPageReducer(
  state: LearningPageState,
  action: LearningPageAction,
): LearningPageState {
  switch (action.type) {
    case 'dashboard:loading':
      return {
        ...state,
        classesLoading: true,
        assignmentsLoading: true,
      };
    case 'dashboard:loaded':
      return {
        ...state,
        ...action.payload,
        classesLoading: false,
        assignmentsLoading: false,
      };
    case 'dashboard:failed':
      return {
        ...state,
        classes: [],
        assignments: [],
        canvasContent: [],
        classError: action.message,
        assignmentError: action.message,
        classesLoading: false,
        assignmentsLoading: false,
      };
    case 'join:codeChanged':
      return {
        ...state,
        joinCode: action.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6),
        joinError: null,
        joinSuccess: null,
      };
    case 'join:started':
      return {
        ...state,
        joinLoading: true,
        joinError: null,
        joinSuccess: null,
      };
    case 'join:succeeded':
      return {
        ...state,
        joinCode: '',
        joinLoading: false,
        joinSuccess: action.message,
      };
    case 'join:failed':
      return {
        ...state,
        joinLoading: false,
        joinError: action.message,
      };
    case 'class:selected':
      return {
        ...state,
        selectedClass: action.classSummary,
      };
    case 'class:dialogClosed':
      return {
        ...state,
        selectedClass: null,
      };
    case 'class:leaveStarted':
      return {
        ...state,
        isLeavingClass: true,
        joinError: null,
        joinSuccess: null,
      };
    case 'class:leaveSucceeded':
      return {
        ...state,
        selectedClass: null,
        isLeavingClass: false,
        joinSuccess: action.message,
      };
    case 'class:leaveFailed':
      return {
        ...state,
        isLeavingClass: false,
        joinError: action.message,
      };
    default:
      return state;
  }
}

export function AppLearningPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { refreshUser } = useAuth();
  const [state, dispatch] = useReducer(learningPageReducer, initialLearningPageState);

  const loadDashboardData = useCallback(async () => {
    dispatch({ type: 'dashboard:loading' });
    try {
      const [classesResult, assignmentsResult] = await Promise.allSettled([
        getStudentClasses(),
        getStudentAssignments(),
      ]);

      let classIds: string[] = [];
      let classes: TeacherClassSummary[] = [];
      let classError: string | null = null;
      let assignments: StudentAssignmentSummary[] = [];
      let assignmentError: string | null = null;

      if (classesResult.status === 'fulfilled') {
        classes = classesResult.value;
        classIds = classesResult.value.map((classSummary) => classSummary.id);
      } else {
        classError = classesResult.reason instanceof Error
          ? classesResult.reason.message
          : 'Failed to load classes.';
      }

      if (assignmentsResult.status === 'fulfilled') {
        assignments = assignmentsResult.value;
        if (!classIds.length) {
          classIds = assignmentsResult.value.flatMap((assignment) => (
            assignment.classId ? [assignment.classId] : []
          ));
        }
      } else {
        assignmentError = assignmentsResult.reason instanceof Error
          ? assignmentsResult.reason.message
          : 'Failed to load assignments.';
      }

      const uniqueClassIds = [...new Set(classIds)];
      const contentResults = await Promise.all(
        uniqueClassIds.map((classId) =>
          getStudentCanvasContent(classId).catch(() => [] as CanvasCourseContentItem[])
        ),
      );

      dispatch({
        type: 'dashboard:loaded',
        payload: {
          classes,
          classError,
          assignments,
          assignmentError,
          canvasContent: contentResults.flat(),
        },
      });
    } catch (error) {
      dispatch({
        type: 'dashboard:failed',
        message: error instanceof Error ? error.message : 'Failed to load classes.',
      });
    }
  }, []);

  useEffect(() => {
    void loadDashboardData();
  }, [loadDashboardData]);

  const handleJoinClass = async () => {
    if (state.joinCode.length !== 6) {
      dispatch({ type: 'join:failed', message: 'Enter the 6-character class code your teacher shared.' });
      return;
    }

    dispatch({ type: 'join:started' });

    try {
      const result = await joinClassByCode(state.joinCode);
      if (result.membershipId) {
        await setActiveMembership(result.membershipId);
      }
      await Promise.all([refreshUser(), loadDashboardData()]);
      dispatch({
        type: 'join:succeeded',
        message: result.alreadyEnrolled
          ? `You are already enrolled in ${result.class.name}.`
          : `Joined ${result.class.name}. New assignments will appear here when available.`,
      });
    } catch (error) {
      dispatch({
        type: 'join:failed',
        message: error instanceof Error ? error.message : 'Failed to join class. Please try again.',
      });
    }
  };

  const handleLeaveClass = async () => {
    if (!state.selectedClass) return;

    dispatch({ type: 'class:leaveStarted' });

    try {
      const leftClass = await leaveStudentClass(state.selectedClass.id);
      await Promise.all([refreshUser(), loadDashboardData()]);
      dispatch({ type: 'class:leaveSucceeded', message: `Left ${leftClass.name}.` });
    } catch (error) {
      dispatch({
        type: 'class:leaveFailed',
        message: error instanceof Error ? error.message : 'Failed to leave class. Please try again.',
      });
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <LearningDashboardHeader t={t} />

      <JoinClassPanel
        joinCode={state.joinCode}
        joinLoading={state.joinLoading}
        joinError={state.joinError}
        joinSuccess={state.joinSuccess}
        onJoinCodeChange={(value) => dispatch({ type: 'join:codeChanged', value })}
        onJoinClass={handleJoinClass}
      />

      <ClassesAssignmentsSection
        assignments={state.assignments}
        assignmentsLoading={state.assignmentsLoading}
        assignmentError={state.assignmentError}
        classes={state.classes}
        classesLoading={state.classesLoading}
        classError={state.classError}
        onLaunchAssignment={(assignmentId) => navigate(`/app/assignments/${assignmentId}`)}
        onRetry={loadDashboardData}
        onSelectClass={(classSummary) => dispatch({ type: 'class:selected', classSummary })}
      />

      <FreePracticeSection t={t} />

      <CanvasModulesSection
        canvasContent={state.canvasContent}
        onLaunchAssignment={(assignmentId) => navigate(`/app/assignments/${assignmentId}`)}
      />

      <LeaveClassDialog
        isLeavingClass={state.isLeavingClass}
        selectedClass={state.selectedClass}
        onCancel={() => dispatch({ type: 'class:dialogClosed' })}
        onLeaveClass={handleLeaveClass}
      />
    </div>
  );
}

type TranslationFn = (key: string) => string;

function LearningDashboardHeader({ t }: { t: TranslationFn }) {
  return (
    <header className="flex items-start gap-4">
      <div className="flex size-12 items-center justify-center rounded-xl border-3 border-foreground bg-primary text-primary-foreground shadow-stamp-sm">
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
          {t('app.dashboard.subtitle') || 'Your learning hub - pick up where you left off'}
        </p>
      </div>
    </header>
  );
}

type JoinClassPanelProps = {
  joinCode: string;
  joinLoading: boolean;
  joinError: string | null;
  joinSuccess: string | null;
  onJoinCodeChange: (value: string) => void;
  onJoinClass: () => void;
};

function JoinClassPanel({
  joinCode,
  joinLoading,
  joinError,
  joinSuccess,
  onJoinCodeChange,
  onJoinClass,
}: JoinClassPanelProps) {
  return (
    <section className={`${SURFACE_CLASS} p-5`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl border-2 border-foreground bg-primary/10 text-primary">
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
              onChange={(event) => onJoinCodeChange(event.target.value)}
              placeholder="ABC123"
              maxLength={6}
              className="text-center font-mono text-lg tracking-[0.28em] uppercase"
              aria-label="Class join code"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void onJoinClass();
                }
              }}
            />
            <Button
              type="button"
              onClick={() => {
                void onJoinClass();
              }}
              disabled={joinLoading || joinCode.length !== 6}
              className="sm:min-w-[170px]"
            >
              {joinLoading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Joining…
                </>
              ) : (
                <>
                  Join class
                  <ArrowRight className="ml-2 size-4" />
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
              <CheckCircle2 className="size-4" />
              <AlertTitle>Class connected</AlertTitle>
              <AlertDescription>{joinSuccess}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </div>
    </section>
  );
}

type ClassesAssignmentsSectionProps = {
  assignments: StudentAssignmentSummary[];
  assignmentsLoading: boolean;
  assignmentError: string | null;
  classes: TeacherClassSummary[];
  classesLoading: boolean;
  classError: string | null;
  onLaunchAssignment: (assignmentId: string) => void;
  onRetry: () => Promise<void>;
  onSelectClass: (classSummary: TeacherClassSummary) => void;
};

function ClassesAssignmentsSection({
  assignments,
  assignmentsLoading,
  assignmentError,
  classes,
  classesLoading,
  classError,
  onLaunchAssignment,
  onRetry,
  onSelectClass,
}: ClassesAssignmentsSectionProps) {
  return (
    <section className={`${SURFACE_CLASS} p-6`}>
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

      <ClassesPanel
        classes={classes}
        classesLoading={classesLoading}
        classError={classError}
        onRetry={onRetry}
        onSelectClass={onSelectClass}
      />

      <AssignmentsPanel
        assignments={assignments}
        assignmentsLoading={assignmentsLoading}
        assignmentError={assignmentError}
        classesCount={classes.length}
        onLaunchAssignment={onLaunchAssignment}
        onRetry={onRetry}
      />
    </section>
  );
}

type ClassesPanelProps = {
  classes: TeacherClassSummary[];
  classesLoading: boolean;
  classError: string | null;
  onRetry: () => Promise<void>;
  onSelectClass: (classSummary: TeacherClassSummary) => void;
};

function ClassesPanel({
  classes,
  classesLoading,
  classError,
  onRetry,
  onSelectClass,
}: ClassesPanelProps) {
  if (classesLoading) {
    return (
      <div className="mt-5 flex items-center gap-3 rounded-2xl border-2 border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading classes…
      </div>
    );
  }

  if (classError) {
    return (
      <Alert variant="destructive" className="mt-5">
        <AlertTitle>Couldn&apos;t load your classes</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>{classError}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void onRetry();
            }}
            className="self-start"
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!classes.length) {
    return (
      <div className="mt-5 rounded-2xl border-2 border-dashed border-border bg-secondary/30 p-5 text-sm text-muted-foreground">
        You&apos;re not enrolled in any classes yet. Join a classroom with your teacher&apos;s code above and it will appear here.
      </div>
    );
  }

  return (
    <div className="mt-5">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Classes you are in
      </p>
      <div className="flex flex-wrap gap-2">
        {classes.map((classSummary) => (
          <button
            type="button"
            key={classSummary.id}
            onClick={() => onSelectClass(classSummary)}
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
  );
}

type AssignmentsPanelProps = {
  assignments: StudentAssignmentSummary[];
  assignmentsLoading: boolean;
  assignmentError: string | null;
  classesCount: number;
  onLaunchAssignment: (assignmentId: string) => void;
  onRetry: () => Promise<void>;
};

function AssignmentsPanel({
  assignments,
  assignmentsLoading,
  assignmentError,
  classesCount,
  onLaunchAssignment,
  onRetry,
}: AssignmentsPanelProps) {
  if (assignmentsLoading) {
    return (
      <div className="mt-6 flex items-center gap-3 rounded-2xl border-2 border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading assignments…
      </div>
    );
  }

  if (assignmentError) {
    return (
      <Alert variant="destructive" className="mt-6">
        <AlertTitle>Couldn&apos;t load your assignments</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>{assignmentError}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void onRetry();
            }}
            className="self-start"
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!assignments.length) {
    return (
      <div className="mt-6 rounded-3xl border-3 border-dashed border-border bg-secondary/40 p-8 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border-2 border-foreground bg-card">
          <GraduationCap size={24} strokeWidth={2.5} />
        </div>
        <h3 className="mt-4 text-xl font-display font-bold text-foreground">No school assignments yet</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {classesCount > 0
            ? 'You are enrolled in classes. Assignments will show up here when your teacher publishes them.'
            : 'When a teacher publishes an assignment for your class, it will show up here.'}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      {assignments.map((assignment) => (
        <div key={assignment.id} className="rounded-2xl border-2 border-border bg-secondary/40 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={assignment.status === 'published' ? 'success' : 'outline'} size="sm">
              {assignment.status}
            </Badge>
          </div>
          <h3 className="mt-4 text-xl font-display font-bold text-foreground">{assignment.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {assignment.className || 'Your class'} {assignment.dueAt ? `· Due ${assignment.dueAt}` : ''}
          </p>
          <p className="mt-3 text-sm text-foreground/80">
            {assignment.description || 'Assignment details will be shown on the launch page.'}
          </p>
          <Button className="mt-5" onClick={() => onLaunchAssignment(assignment.id)}>
            Launch assignment
          </Button>
        </div>
      ))}
    </div>
  );
}

function FreePracticeSection({ t }: { t: TranslationFn }) {
  return (
    <section className={`${SURFACE_CLASS} p-6`}>
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
          title={t('app.dashboard.card.chat.title') || 'Chat with Lingu'}
          description={t('app.dashboard.card.chat.description') || 'Practice conversation through free talking'}
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
  );
}

type CanvasModulesSectionProps = {
  canvasContent: CanvasCourseContentItem[];
  onLaunchAssignment: (assignmentId: string) => void;
};

function CanvasModulesSection({ canvasContent, onLaunchAssignment }: CanvasModulesSectionProps) {
  if (!canvasContent.length) return null;

  return (
    <section className={`${SURFACE_CLASS} p-6`}>
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
            canvasContent.reduce<Array<[string, string]>>((entries, item) => {
              if (item.lingualAssignmentId) {
                entries.push([item.canvasItemId, item.lingualAssignmentId]);
              }
              return entries;
            }, []),
          )}
          onLaunchAssignment={onLaunchAssignment}
        />
      </div>
    </section>
  );
}

type LeaveClassDialogProps = {
  isLeavingClass: boolean;
  selectedClass: TeacherClassSummary | null;
  onCancel: () => void;
  onLeaveClass: () => void;
};

function LeaveClassDialog({
  isLeavingClass,
  selectedClass,
  onCancel,
  onLeaveClass,
}: LeaveClassDialogProps) {
  return (
    <Dialog
      open={Boolean(selectedClass)}
      onOpenChange={(open) => {
        if (!open && !isLeavingClass) {
          onCancel();
        }
      }}
    >
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
            onClick={onCancel}
            disabled={isLeavingClass}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              void onLeaveClass();
            }}
            loading={isLeavingClass}
          >
            Leave classroom
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
