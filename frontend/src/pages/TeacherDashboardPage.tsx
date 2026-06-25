import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { TEACHER_JOIN_ORG_ROUTE } from '@/lib/homeRoutes';
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ClipboardCopy,
  Filter,
  GraduationCap,
  Loader2,
  Plus,
  RefreshCw,
  School,
  ShieldCheck,
  Trash2,
  Link as LinkIcon,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@/components/ui';
import {
  getTeacherDashboard,
  createTeacherClass,
  generateClassJoinCode,
  getClassJoinCode,
  deactivateClassJoinCode,
  getClassRoster,
  removeStudentFromClass,
  getClassCanvasRosterGap,
} from '@/api/teacher';
import {
  generateTeacherInviteCode,
  getTeacherInviteCode,
  deactivateTeacherInviteCode,
} from '@/api/schoolRequests';
import type { TeacherInviteCodeData } from '@/api/schoolRequests';
import { PendingTeacherRequestsSection } from '@/components/teacher/PendingTeacherRequestsSection';
import { getLtiPlatform, registerLtiPlatform, deleteLtiPlatform } from '@/api/lti';
import type { LtiPlatformConfig } from '@/api/lti';
import { useMembership } from '@/contexts/MembershipContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { LEARNING_LOCALES } from '@/lib/learningLocales';
import { OnboardingHint } from '@/components/ui/OnboardingHint';
import type {
  ClassJoinCodeData,
  ClassRosterStudent,
  CreateTeacherClassPayload,
  TeacherDashboardData,
  CanvasRosterGapEntry,
  CanvasRosterGapSummary,
} from '@/types';

const DEFAULT_CLASS_FORM: CreateTeacherClassPayload = {
  name: '',
  term: '',
  subject: '',
  gradeBand: '',
  learningLocale: 'ko-KR',
};

type LtiPlatformForm = {
  issuer: string;
  clientId: string;
  deploymentId: string;
  authLoginUrl: string;
  authTokenUrl: string;
  keySetUrl: string;
};

const DEFAULT_LTI_FORM: LtiPlatformForm = {
  issuer: '',
  clientId: '',
  deploymentId: '',
  authLoginUrl: '',
  authTokenUrl: '',
  keySetUrl: '',
};

const EMPTY_DASHBOARD_SUMMARY = {
  classCount: 0,
  studentCount: 0,
  speakingMinutes: 0,
  assignmentCount: 0,
};

type DashboardClassSummary = TeacherDashboardData['classes'][number];
type DashboardSetupChecklistItem = TeacherDashboardData['setupChecklist'][number];
type DashboardAlert = TeacherDashboardData['alerts'][number];
type DashboardStat = {
  labelKey: string;
  value: number;
  icon: typeof BookOpen;
  accent: string;
};

type TeacherDashboardState = {
  loading: boolean;
  savingClass: boolean;
  error: string | null;
  dashboard?: TeacherDashboardData;
  isCreateDialogOpen: boolean;
  classForm: CreateTeacherClassPayload;
  classFilter: string;
  joinCodeClassId: string | null;
  joinCodeData: ClassJoinCodeData | null;
  joinCodeLoading: boolean;
  joinCodeCopied: boolean;
  rosterClassId: string | null;
  roster: ClassRosterStudent[];
  rosterLoading: boolean;
  removingUid: string | null;
  canvasRosterGap: CanvasRosterGapEntry[];
  canvasRosterSummary: CanvasRosterGapSummary | null;
  teacherInviteCode: TeacherInviteCodeData | null;
  teacherInviteCodeLoading: boolean;
  teacherInviteCodeCopied: boolean;
  ltiPlatform: LtiPlatformConfig | null;
  ltiLoading: boolean;
  ltiSaving: boolean;
  ltiForm: LtiPlatformForm;
};

type UpdateClassFieldAction<
  K extends keyof CreateTeacherClassPayload = keyof CreateTeacherClassPayload,
> = {
  type: 'updateClassField';
  field: K;
  value: CreateTeacherClassPayload[K];
};

type TeacherDashboardAction =
  | { type: 'patch'; patch: Partial<TeacherDashboardState> }
  | UpdateClassFieldAction
  | { type: 'updateLtiField'; field: keyof LtiPlatformForm; value: string }
  | { type: 'removeRosterStudent'; studentUid: string };

const initialTeacherDashboardState: TeacherDashboardState = {
  loading: true,
  savingClass: false,
  error: null,
  dashboard: undefined,
  isCreateDialogOpen: false,
  classForm: DEFAULT_CLASS_FORM,
  classFilter: '',
  joinCodeClassId: null,
  joinCodeData: null,
  joinCodeLoading: false,
  joinCodeCopied: false,
  rosterClassId: null,
  roster: [],
  rosterLoading: false,
  removingUid: null,
  canvasRosterGap: [],
  canvasRosterSummary: null,
  teacherInviteCode: null,
  teacherInviteCodeLoading: false,
  teacherInviteCodeCopied: false,
  ltiPlatform: null,
  ltiLoading: false,
  ltiSaving: false,
  ltiForm: DEFAULT_LTI_FORM,
};

function teacherDashboardReducer(
  state: TeacherDashboardState,
  action: TeacherDashboardAction
): TeacherDashboardState {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.patch };
    case 'updateClassField':
      return {
        ...state,
        classForm: {
          ...state.classForm,
          [action.field]: action.value,
        },
      };
    case 'updateLtiField':
      return {
        ...state,
        ltiForm: {
          ...state.ltiForm,
          [action.field]: action.value,
        },
      };
    case 'removeRosterStudent':
      return {
        ...state,
        roster: state.roster.filter((student) => student.uid !== action.studentUid),
      };
    default:
      return state;
  }
}

function useTeacherDashboardController() {
  const navigate = useNavigate();
  const { hasRole } = useMembership();
  const isSchoolAdmin = hasRole('school_admin');
  const [state, dispatch] = useReducer(teacherDashboardReducer, initialTeacherDashboardState);
  const activeRosterClassIdRef = useRef<string | null>(null);
  const {
    loading,
    savingClass,
    error,
    dashboard,
    isCreateDialogOpen,
    classForm,
    classFilter,
    joinCodeClassId,
    joinCodeData,
    joinCodeLoading,
    joinCodeCopied,
    rosterClassId,
    roster,
    rosterLoading,
    removingUid,
    canvasRosterGap,
    canvasRosterSummary,
    teacherInviteCode,
    teacherInviteCodeLoading,
    teacherInviteCodeCopied,
    ltiPlatform,
    ltiLoading,
    ltiSaving,
    ltiForm,
  } = state;

  const loadDashboard = useCallback(async () => {
    try {
      const nextDashboard = await getTeacherDashboard();
      dispatch({ type: 'patch', patch: { dashboard: nextDashboard, error: null } });
    } catch (err) {
      dispatch({
        type: 'patch',
        patch: { error: err instanceof Error ? err.message : 'Failed to load teacher dashboard.' },
      });
    } finally {
      dispatch({ type: 'patch', patch: { loading: false } });
    }
  }, []);

  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-initialize-state -- dashboard starts empty and is populated by an async dashboard fetch.
    loadDashboard();
  }, [loadDashboard]);

  const updateClassField = <K extends keyof CreateTeacherClassPayload>(
    field: K,
    value: CreateTeacherClassPayload[K]
  ) => {
    dispatch({ type: 'updateClassField', field, value });
  };

  const handleCreateClass = async () => {
    dispatch({ type: 'patch', patch: { savingClass: true, error: null } });

    try {
      await createTeacherClass(classForm);
      dispatch({
        type: 'patch',
        patch: { isCreateDialogOpen: false, classForm: DEFAULT_CLASS_FORM },
      });
      await loadDashboard();
    } catch (err) {
      dispatch({
        type: 'patch',
        patch: { error: err instanceof Error ? err.message : 'Failed to create class.' },
      });
    } finally {
      dispatch({ type: 'patch', patch: { savingClass: false } });
    }
  };

  const openJoinCodeDialog = async (classId: string) => {
    dispatch({
      type: 'patch',
      patch: {
        joinCodeClassId: classId,
        joinCodeData: null,
        joinCodeLoading: true,
        joinCodeCopied: false,
      },
    });

    try {
      const data = await getClassJoinCode(classId);
      dispatch({ type: 'patch', patch: { joinCodeData: data } });
    } catch {
      dispatch({ type: 'patch', patch: { joinCodeData: null } });
    } finally {
      dispatch({ type: 'patch', patch: { joinCodeLoading: false } });
    }
  };

  const handleGenerateCode = async () => {
    if (!joinCodeClassId) return;
    dispatch({ type: 'patch', patch: { joinCodeLoading: true } });

    try {
      const data = await generateClassJoinCode(joinCodeClassId);
      dispatch({ type: 'patch', patch: { joinCodeData: data } });
    } catch (err) {
      dispatch({
        type: 'patch',
        patch: { error: err instanceof Error ? err.message : 'Failed to generate join code.' },
      });
    } finally {
      dispatch({ type: 'patch', patch: { joinCodeLoading: false } });
    }
  };

  const handleDeactivateCode = async () => {
    if (!joinCodeClassId) return;
    dispatch({ type: 'patch', patch: { joinCodeLoading: true } });

    try {
      await deactivateClassJoinCode(joinCodeClassId);
      dispatch({ type: 'patch', patch: { joinCodeData: null } });
    } catch (err) {
      dispatch({
        type: 'patch',
        patch: { error: err instanceof Error ? err.message : 'Failed to deactivate join code.' },
      });
    } finally {
      dispatch({ type: 'patch', patch: { joinCodeLoading: false } });
    }
  };

  const handleCopyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    dispatch({ type: 'patch', patch: { joinCodeCopied: true } });
    setTimeout(() => dispatch({ type: 'patch', patch: { joinCodeCopied: false } }), 2000);
  };

  const openRosterDialog = async (classId: string) => {
    activeRosterClassIdRef.current = classId;
    dispatch({
      type: 'patch',
      patch: {
        rosterClassId: classId,
        roster: [],
        canvasRosterGap: [],
        canvasRosterSummary: null,
        rosterLoading: true,
      },
    });

    try {
      if (activeRosterClassIdRef.current !== classId) return;
      const [students, gapResponse] = await Promise.all([
        getClassRoster(classId),
        getClassCanvasRosterGap(classId),
      ]);

      if (activeRosterClassIdRef.current === classId) {
        dispatch({
          type: 'patch',
          patch: {
            roster: students,
            canvasRosterGap: gapResponse.gap,
            canvasRosterSummary: gapResponse.summary,
          },
        });
      }
    } catch (err) {
      if (activeRosterClassIdRef.current === classId) {
        dispatch({
          type: 'patch',
          patch: { error: err instanceof Error ? err.message : 'Failed to load roster.' },
        });
      }
    } finally {
      if (activeRosterClassIdRef.current === classId) {
        dispatch({ type: 'patch', patch: { rosterLoading: false } });
      }
    }
  };

  const handleRemoveStudent = async (studentUid: string) => {
    if (!rosterClassId) return;
    dispatch({ type: 'patch', patch: { removingUid: studentUid } });

    try {
      await removeStudentFromClass(rosterClassId, studentUid);
      dispatch({ type: 'removeRosterStudent', studentUid });
      await loadDashboard();
    } catch (err) {
      dispatch({
        type: 'patch',
        patch: { error: err instanceof Error ? err.message : 'Failed to remove student.' },
      });
    } finally {
      dispatch({ type: 'patch', patch: { removingUid: null } });
    }
  };

  const loadTeamData = useCallback(async () => {
    if (!isSchoolAdmin) return;
    dispatch({ type: 'patch', patch: { teacherInviteCodeLoading: true } });

    try {
      const code = await getTeacherInviteCode();
      dispatch({ type: 'patch', patch: { teacherInviteCode: code } });
    } catch {
      dispatch({ type: 'patch', patch: { teacherInviteCode: null } });
    } finally {
      dispatch({ type: 'patch', patch: { teacherInviteCodeLoading: false } });
    }

    dispatch({ type: 'patch', patch: { ltiLoading: true } });
    try {
      const platform = await getLtiPlatform();
      dispatch({ type: 'patch', patch: { ltiPlatform: platform } });
    } catch {
      dispatch({ type: 'patch', patch: { ltiPlatform: null } });
    } finally {
      dispatch({ type: 'patch', patch: { ltiLoading: false } });
    }
  }, [isSchoolAdmin]);

  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-derived-state -- teacherInviteCodeLoading is an async request flag reused by load, generate, and refresh actions.
    loadTeamData();
  }, [loadTeamData]);

  const handleGenerateTeacherInviteCode = async () => {
    dispatch({ type: 'patch', patch: { teacherInviteCodeLoading: true } });

    try {
      const data = await generateTeacherInviteCode();
      dispatch({ type: 'patch', patch: { teacherInviteCode: data } });
    } catch (err) {
      dispatch({
        type: 'patch',
        patch: {
          error: err instanceof Error ? err.message : 'Failed to generate teacher invite code.',
        },
      });
    } finally {
      dispatch({ type: 'patch', patch: { teacherInviteCodeLoading: false } });
    }
  };

  const handleDeactivateTeacherInviteCode = async () => {
    dispatch({ type: 'patch', patch: { teacherInviteCodeLoading: true } });

    try {
      await deactivateTeacherInviteCode();
      dispatch({ type: 'patch', patch: { teacherInviteCode: null } });
    } catch (err) {
      dispatch({
        type: 'patch',
        patch: {
          error: err instanceof Error ? err.message : 'Failed to deactivate teacher invite code.',
        },
      });
    } finally {
      dispatch({ type: 'patch', patch: { teacherInviteCodeLoading: false } });
    }
  };

  const handleCopyTeacherInviteCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    dispatch({ type: 'patch', patch: { teacherInviteCodeCopied: true } });
    setTimeout(
      () => dispatch({ type: 'patch', patch: { teacherInviteCodeCopied: false } }),
      2000
    );
  };

  const handleRegisterLtiPlatform = async () => {
    dispatch({ type: 'patch', patch: { ltiSaving: true, error: null } });

    try {
      await registerLtiPlatform(ltiForm);
      const platform = await getLtiPlatform();
      dispatch({ type: 'patch', patch: { ltiPlatform: platform, ltiForm: DEFAULT_LTI_FORM } });
    } catch (err) {
      dispatch({
        type: 'patch',
        patch: { error: err instanceof Error ? err.message : 'Failed to register LTI platform.' },
      });
    } finally {
      dispatch({ type: 'patch', patch: { ltiSaving: false } });
    }
  };

  const handleRemoveLtiPlatform = async () => {
    dispatch({ type: 'patch', patch: { ltiSaving: true, error: null } });

    try {
      await deleteLtiPlatform();
      dispatch({ type: 'patch', patch: { ltiPlatform: null } });
    } catch (err) {
      dispatch({
        type: 'patch',
        patch: { error: err instanceof Error ? err.message : 'Failed to remove LTI platform.' },
      });
    } finally {
      dispatch({ type: 'patch', patch: { ltiSaving: false } });
    }
  };

  const filteredClasses = useMemo(() => {
    if (!dashboard || !classFilter) return dashboard?.classes ?? [];
    return dashboard.classes.filter((classSummary) => classSummary.id === classFilter);
  }, [dashboard, classFilter]);

  const filteredSummary = useMemo(() => {
    if (!dashboard || !classFilter) return dashboard?.summary ?? EMPTY_DASHBOARD_SUMMARY;
    const studentCount = filteredClasses.reduce((sum, classSummary) => {
      return sum + classSummary.studentCount;
    }, 0);
    const assignmentCount = filteredClasses.reduce((sum, classSummary) => {
      return sum + (classSummary.assignmentCount ?? 0);
    }, 0);
    return {
      classCount: filteredClasses.length,
      studentCount,
      speakingMinutes: dashboard.summary.speakingMinutes,
      assignmentCount,
    };
  }, [dashboard, classFilter, filteredClasses]);

  const stats = useMemo<DashboardStat[]>(
    () => [
      {
        labelKey: 'teacher.dashboard.stat.classes',
        value: filteredSummary.classCount,
        icon: BookOpen,
        accent: 'bg-primary/10 text-primary',
      },
      {
        labelKey: 'teacher.dashboard.stat.students',
        value: filteredSummary.studentCount,
        icon: Users,
        accent: 'bg-success/15 text-success',
      },
      {
        labelKey: 'teacher.dashboard.stat.speakingMinutes',
        value: filteredSummary.speakingMinutes,
        icon: CalendarClock,
        accent: 'bg-accent/20 text-accent-foreground',
      },
      {
        labelKey: 'teacher.dashboard.stat.assignments',
        value: filteredSummary.assignmentCount,
        icon: GraduationCap,
        accent: 'bg-secondary text-foreground',
      },
    ],
    [filteredSummary]
  );

  const openCreateDialog = () => {
    dispatch({ type: 'patch', patch: { isCreateDialogOpen: true } });
  };

  const closeCreateDialog = () => {
    dispatch({ type: 'patch', patch: { isCreateDialogOpen: false } });
  };

  const handleCreateDialogOpenChange = (open: boolean) => {
    dispatch({ type: 'patch', patch: { isCreateDialogOpen: open } });
  };

  const setClassFilter = (nextClassFilter: string) => {
    dispatch({ type: 'patch', patch: { classFilter: nextClassFilter } });
  };

  const closeJoinCodeDialog = () => {
    dispatch({ type: 'patch', patch: { joinCodeClassId: null } });
  };

  const closeRosterDialog = () => {
    activeRosterClassIdRef.current = null;
    dispatch({ type: 'patch', patch: { rosterClassId: null } });
  };

  const openInviteFromRoster = () => {
    const classId = rosterClassId;
    closeRosterDialog();
    if (classId) void openJoinCodeDialog(classId);
  };

  const updateLtiField = (field: keyof LtiPlatformForm, value: string) => {
    dispatch({ type: 'updateLtiField', field, value });
  };

  return {
    loading,
    savingClass,
    error,
    dashboard,
    isSchoolAdmin,
    isCreateDialogOpen,
    classForm,
    classFilter,
    filteredClasses,
    stats,
    joinCodeClassId,
    joinCodeData,
    joinCodeLoading,
    joinCodeCopied,
    rosterClassId,
    roster,
    rosterLoading,
    removingUid,
    canvasRosterGap,
    canvasRosterSummary,
    teacherInviteCode,
    teacherInviteCodeLoading,
    teacherInviteCodeCopied,
    ltiPlatform,
    ltiLoading,
    ltiSaving,
    ltiForm,
    goToTeacherJoin: () => navigate(TEACHER_JOIN_ORG_ROUTE),
    openCreateDialog,
    closeCreateDialog,
    handleCreateDialogOpenChange,
    setClassFilter,
    clearClassFilter: () => setClassFilter(''),
    updateClassField,
    handleCreateClass,
    openJoinCodeDialog,
    closeJoinCodeDialog,
    handleGenerateCode,
    handleDeactivateCode,
    handleCopyCode,
    openRosterDialog,
    closeRosterDialog,
    openInviteFromRoster,
    handleRemoveStudent,
    openClassAnalytics: (classId: string) => navigate(`/app/teacher/classes/${classId}/analytics`),
    openClassAssignments: (classId: string) =>
      navigate(`/app/teacher/classes/${classId}/assignments`),
    openClassCanvasConnect: (classId: string) =>
      navigate(`/app/teacher/classes/${classId}/canvas/connect`),
    handleGenerateTeacherInviteCode,
    handleDeactivateTeacherInviteCode,
    handleCopyTeacherInviteCode,
    handleRegisterLtiPlatform,
    handleRemoveLtiPlatform,
    updateLtiField,
  };
}

type TeacherDashboardController = ReturnType<typeof useTeacherDashboardController>;

export function TeacherDashboardPage() {
  const controller = useTeacherDashboardController();
  return <TeacherDashboardView controller={controller} />;
}

function TeacherDashboardView({ controller }: { controller: TeacherDashboardController }) {
  const { dashboard } = controller;

  if (controller.loading) {
    return <TeacherDashboardLoading />;
  }

  if (!dashboard) {
    return (
      <TeacherDashboardUnavailable
        error={controller.error}
        onGoToTeacherJoin={controller.goToTeacherJoin}
      />
    );
  }

  return (
    <div className="space-y-6">
      <TeacherDashboardHeader
        organizationName={dashboard.organizationName}
        onCreateClass={controller.openCreateDialog}
      />
      <DashboardErrorAlert error={controller.error} />
      <DashboardAlerts alerts={dashboard.alerts} />
      <ClassFilterBar
        classes={dashboard.classes}
        value={controller.classFilter}
        onChange={controller.setClassFilter}
        onClear={controller.clearClassFilter}
      />
      <StatsGrid stats={controller.stats} />
      <TeacherDashboardHints dashboard={dashboard} />
      {controller.isSchoolAdmin && <PendingTeacherRequestsSection />}
      <SetupAndClassesSection controller={controller} />
      {controller.isSchoolAdmin && <TeacherInviteCodeSection controller={controller} />}
      {controller.isSchoolAdmin && <LtiConfigurationCard controller={controller} />}
      <CreateClassDialog controller={controller} />
      <JoinCodeDialog controller={controller} />
      <RosterDialog controller={controller} />
    </div>
  );
}

function TeacherDashboardLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Loader2 className="size-8 animate-spin text-primary" />
    </div>
  );
}

function TeacherDashboardUnavailable({
  error,
  onGoToTeacherJoin,
}: {
  error: string | null;
  onGoToTeacherJoin: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="space-y-4">
      <Alert variant="destructive">
        <AlertDescription>{error || t('teacher.dashboard.unavailable')}</AlertDescription>
      </Alert>
      <Button variant="outline" onClick={onGoToTeacherJoin}>
        {t('teacher.dashboard.goToTeacherJoin')}
      </Button>
    </div>
  );
}

function TeacherDashboardHeader({
  organizationName,
  onCreateClass,
}: {
  organizationName?: string;
  onCreateClass: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border-2 border-border bg-secondary px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <School size={14} />
          {t('teacher.dashboard.badge')}
        </div>
        <h1 className="text-3xl font-display font-bold text-foreground">
          {organizationName || t('teacher.dashboard.workspacePlaceholder')}
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          {t('teacher.dashboard.subtitle')}
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button onClick={onCreateClass}>
          <Plus size={16} className="mr-2" />
          {t('teacher.dashboard.createClass')}
        </Button>
      </div>
    </div>
  );
}

function DashboardErrorAlert({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

function DashboardAlerts({ alerts }: { alerts: DashboardAlert[] }) {
  if (alerts.length === 0) return null;

  return (
    <div className="grid gap-3">
      {alerts.map((message) => (
        <Alert key={message}>
          <AlertTriangle className="size-4" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

function ClassFilterBar({
  classes,
  value,
  onChange,
  onClear,
}: {
  classes: DashboardClassSummary[];
  value: string;
  onChange: (classId: string) => void;
  onClear: () => void;
}) {
  const { t } = useLanguage();
  if (classes.length <= 1) return null;

  return (
    <div className="flex items-center gap-3">
      <Filter size={16} className="text-muted-foreground" />
      <label htmlFor="dashboard-class-filter" className="text-sm font-medium text-muted-foreground">
        {t('teacher.dashboard.filterLabel')}
      </label>
      <select
        id="dashboard-class-filter"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-xl border-2 border-border bg-card px-3 text-sm text-foreground focus:border-primary focus:outline-none"
      >
        <option value="">{t('teacher.dashboard.filterAll')}</option>
        {classes.map((classSummary) => (
          <option key={classSummary.id} value={classSummary.id}>
            {classSummary.name}
          </option>
        ))}
      </select>
      {value && (
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {t('teacher.dashboard.filterClear')}
        </button>
      )}
    </div>
  );
}

function StatsGrid({ stats }: { stats: DashboardStat[] }) {
  const { t } = useLanguage();
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card key={stat.labelKey} className="border-3 border-foreground p-5 shadow-stamp">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-foreground ${stat.accent}`}
              >
                <Icon size={22} strokeWidth={2.5} />
              </div>
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {t('teacher.dashboard.beta')}
              </span>
            </div>
            <p className="text-3xl font-display font-bold text-foreground">{stat.value}</p>
            <p className="mt-1 text-sm font-medium text-muted-foreground">{t(stat.labelKey)}</p>
          </Card>
        );
      })}
    </div>
  );
}

function TeacherDashboardHints({ dashboard }: { dashboard: TeacherDashboardData }) {
  const { t } = useLanguage();
  return (
    <>
      <OnboardingHint
        show={dashboard.classes.length === 0}
        message={t('teacher.dashboard.hint.createClass')}
        ctaLabel={t('teacher.dashboard.hint.createClassCta')}
        ctaTo="/app/teacher"
      />
      <OnboardingHint
        show={dashboard.classes.length > 0 && dashboard.summary.studentCount === 0}
        message={t('teacher.dashboard.hint.inviteStudents')}
        ctaLabel={t('teacher.dashboard.hint.inviteStudentsCta')}
        ctaTo={`/app/teacher/classes/${dashboard.classes[0]?.id}/analytics`}
      />
      <OnboardingHint
        show={
          dashboard.classes.length > 0 &&
          dashboard.summary.studentCount > 0 &&
          dashboard.summary.assignmentCount === 0
        }
        message={t('teacher.dashboard.hint.createAssignment')}
        ctaLabel={t('teacher.dashboard.hint.createAssignmentCta')}
        ctaTo={`/app/teacher/classes/${dashboard.classes[0]?.id}/assignments`}
      />
    </>
  );
}

function SetupAndClassesSection({ controller }: { controller: TeacherDashboardController }) {
  const { dashboard } = controller;
  if (!dashboard) return null;

  return (
    <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <SetupChecklistCard items={dashboard.setupChecklist} />
      <ClassesCard controller={controller} />
    </div>
  );
}

function SetupChecklistCard({ items }: { items: DashboardSetupChecklistItem[] }) {
  const { t } = useLanguage();
  return (
    <Card className="border-3 border-foreground p-6 shadow-stamp">
      <h2 className="text-xl font-display font-bold text-foreground">{t('teacher.dashboard.setup.title')}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {t('teacher.dashboard.setup.subtitle')}
      </p>
      <div className="mt-6 space-y-4">
        {items.map((item) => (
          <div key={item.id} className="rounded-2xl border-2 border-border bg-secondary/60 p-4">
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 flex size-8 items-center justify-center rounded-full border-2 ${
                  item.completed
                    ? 'border-success bg-success/15 text-success'
                    : 'border-border bg-card text-muted-foreground'
                }`}
              >
                <CheckCircle2 size={18} strokeWidth={2.5} />
              </div>
              <div>
                <p className="font-semibold text-foreground">{item.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ClassesCard({ controller }: { controller: TeacherDashboardController }) {
  const { t } = useLanguage();
  return (
    <Card className="border-3 border-foreground p-6 shadow-stamp">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">{t('teacher.dashboard.classes.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('teacher.dashboard.classes.subtitle')}
          </p>
        </div>
        <Button size="sm" onClick={controller.openCreateDialog}>
          <Plus size={16} className="mr-2" />
          {t('teacher.dashboard.classes.newClass')}
        </Button>
      </div>

      {controller.filteredClasses.length === 0 ? (
        <EmptyClassesState onCreateClass={controller.openCreateDialog} />
      ) : (
        <div className="mt-6 grid gap-4">
          {controller.filteredClasses.map((classSummary) => (
            <ClassSummaryCard
              key={classSummary.id}
              classSummary={classSummary}
              onOpenAnalytics={controller.openClassAnalytics}
              onOpenJoinCode={controller.openJoinCodeDialog}
              onOpenRoster={controller.openRosterDialog}
              onOpenAssignments={controller.openClassAssignments}
              onOpenCanvas={controller.openClassCanvasConnect}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function EmptyClassesState({ onCreateClass }: { onCreateClass: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="mt-6 rounded-3xl border-3 border-dashed border-border bg-secondary/40 p-8 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border-2 border-foreground bg-card">
        <BookOpen size={24} strokeWidth={2.5} />
      </div>
      <h3 className="mt-4 text-xl font-display font-bold text-foreground">{t('teacher.dashboard.classes.empty.title')}</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        {t('teacher.dashboard.classes.empty.subtitle')}
      </p>
      <Button className="mt-5" onClick={onCreateClass}>
        {t('teacher.dashboard.classes.empty.cta')}
      </Button>
    </div>
  );
}

function ClassSummaryCard({
  classSummary,
  onOpenAnalytics,
  onOpenJoinCode,
  onOpenRoster,
  onOpenAssignments,
  onOpenCanvas,
}: {
  classSummary: DashboardClassSummary;
  onOpenAnalytics: (classId: string) => void;
  onOpenJoinCode: (classId: string) => void;
  onOpenRoster: (classId: string) => void;
  onOpenAssignments: (classId: string) => void;
  onOpenCanvas: (classId: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="w-full rounded-2xl border-2 border-border bg-secondary/50 p-5 transition-colors hover:border-primary hover:bg-secondary">
      <button
        type="button"
        onClick={() => onOpenAnalytics(classSummary.id)}
        aria-label={t('teacher.dashboard.class.analyticsAriaLabel').replace('{name}', classSummary.name)}
        className="block w-full cursor-pointer rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-lg font-display font-bold text-foreground">{classSummary.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {classSummary.subject || t('teacher.dashboard.class.subjectTbd')}
              {classSummary.term ? ` · ${classSummary.term}` : ''}
              {classSummary.gradeBand ? ` · ${t('teacher.dashboard.class.grades').replace('{band}', classSummary.gradeBand)}` : ''}
            </p>
          </div>
          <div className="grid gap-3 sm:w-[420px] sm:grid-cols-3">
            <ClassMetric label={t('teacher.dashboard.class.metricStudents')} value={classSummary.studentCount} />
            <ClassMetric label={t('teacher.dashboard.class.metricLanguage')} value={classSummary.learningLocale} />
            <ClassMetric label={t('teacher.dashboard.class.metricAssignments')} value={classSummary.assignmentCount ?? 0} />
          </div>
        </div>
      </button>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOpenJoinCode(classSummary.id)}
        >
          <UserPlus size={14} className="mr-1.5" />
          {t('teacher.dashboard.class.inviteStudents')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOpenRoster(classSummary.id)}
        >
          <Users size={14} className="mr-1.5" />
          {t('teacher.dashboard.class.roster')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOpenAssignments(classSummary.id)}
        >
          {t('teacher.dashboard.class.buildAssignments')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={classSummary.canvasLinked ? 'group' : undefined}
          aria-label={
            classSummary.canvasLinked
              ? t('teacher.dashboard.class.canvasLinkedLabel')
              : t('teacher.dashboard.class.connectCanvasLabel')
          }
          onClick={() => onOpenCanvas(classSummary.id)}
        >
          {classSummary.canvasLinked ? (
            <>
              <CheckCircle2
                size={14}
                className="mr-1.5 group-hover:hidden group-focus-visible:hidden"
              />
              <RefreshCw
                size={14}
                className="mr-1.5 hidden group-hover:inline group-focus-visible:inline"
              />
              <span className="group-hover:hidden group-focus-visible:hidden">{t('teacher.dashboard.class.canvasLinked')}</span>
              <span className="hidden group-hover:inline group-focus-visible:inline">
                {t('teacher.dashboard.class.resyncCanvas')}
              </span>
            </>
          ) : (
            <>
              <LinkIcon size={14} className="mr-1.5" />
              {t('teacher.dashboard.class.canvas')}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function ClassMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}

function TeacherInviteCodeSection({ controller }: { controller: TeacherDashboardController }) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <TeacherInviteCodeCard controller={controller} />
    </div>
  );
}

function TeacherInviteCodeCard({ controller }: { controller: TeacherDashboardController }) {
  const { t } = useLanguage();
  const code = controller.teacherInviteCode;

  return (
    <Card className="border-3 border-foreground p-6 shadow-stamp">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-2xl border-2 border-foreground bg-primary/10 text-primary">
          <ShieldCheck size={20} strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">{t('teacher.dashboard.invite.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('teacher.dashboard.invite.subtitle')}</p>
        </div>
      </div>

      {controller.teacherInviteCodeLoading ? (
        <InlineLoader />
      ) : code?.active && code.inviteCode ? (
        <div className="space-y-4">
          <div className="flex items-center justify-center gap-3 rounded-2xl border-2 border-border bg-secondary/60 p-6">
            <span className="font-mono text-4xl font-bold tracking-[0.4em] text-foreground">
              {code.inviteCode}
            </span>
            <button
              type="button"
              onClick={() => controller.handleCopyTeacherInviteCode(code.inviteCode)}
              className="rounded-lg border border-border bg-card p-2 text-muted-foreground transition-colors hover:text-foreground"
              title={t('teacher.dashboard.invite.copyTitle')}
            >
              <ClipboardCopy size={18} />
            </button>
          </div>
          {controller.teacherInviteCodeCopied && (
            <p className="text-center text-sm font-medium text-success">{t('teacher.dashboard.invite.copied')}</p>
          )}
          <p className="text-center text-sm text-muted-foreground">
            {t('teacher.dashboard.invite.instructions')}
          </p>
          <div className="flex justify-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={controller.handleDeactivateTeacherInviteCode}
              disabled={controller.teacherInviteCodeLoading}
            >
              {t('teacher.dashboard.invite.deactivate')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 py-4 text-center">
          <p className="text-muted-foreground">
            {code && !code.active ? t('teacher.dashboard.invite.deactivated') : t('teacher.dashboard.invite.noActive')}
          </p>
          <Button
            onClick={controller.handleGenerateTeacherInviteCode}
            disabled={controller.teacherInviteCodeLoading}
          >
            {code && !code.active ? t('teacher.dashboard.invite.regenerate') : t('teacher.dashboard.invite.generate')}
          </Button>
        </div>
      )}
    </Card>
  );
}

function LtiConfigurationCard({ controller }: { controller: TeacherDashboardController }) {
  const { t } = useLanguage();
  return (
    <Card className="border-3 border-foreground p-6 shadow-stamp">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-2xl border-2 border-foreground bg-primary/10 text-primary">
          <LinkIcon size={20} strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">{t('teacher.dashboard.lti.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('teacher.dashboard.lti.subtitle')}
          </p>
        </div>
      </div>

      {controller.ltiLoading ? (
        <InlineLoader />
      ) : controller.ltiPlatform ? (
        <div className="space-y-5">
          <LtiRegisteredPlatform platform={controller.ltiPlatform} />
          <LtiUrlsPanel />
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={controller.handleRemoveLtiPlatform}
              loading={controller.ltiSaving}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 size={14} className="mr-1.5" />
              {t('teacher.dashboard.lti.removePlatform')}
            </Button>
          </div>
        </div>
      ) : (
        <LtiRegistrationForm controller={controller} />
      )}
    </Card>
  );
}

function LtiRegisteredPlatform({ platform }: { platform: LtiPlatformConfig }) {
  const { t } = useLanguage();
  return (
    <div className="space-y-3 rounded-2xl border-2 border-border bg-secondary/40 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {t('teacher.dashboard.lti.registered.title')}
      </h3>
      <div className="grid gap-2 text-sm">
        <LtiPlatformDetailRow label={t('teacher.dashboard.lti.registered.issuer')} value={platform.issuer} />
        <LtiPlatformDetailRow label={t('teacher.dashboard.lti.registered.clientId')} value={platform.clientId} />
        <LtiPlatformDetailRow label={t('teacher.dashboard.lti.registered.deploymentId')} value={platform.deploymentId} />
      </div>
    </div>
  );
}

function LtiUrlsPanel() {
  const { t } = useLanguage();
  const origin = window.location.origin;

  return (
    <div className="space-y-3 rounded-2xl border-2 border-border bg-secondary/40 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {t('teacher.dashboard.lti.urls.title')}
      </h3>
      <p className="text-xs text-muted-foreground">
        {t('teacher.dashboard.lti.urls.subtitle')}
      </p>
      <div className="grid gap-2 text-sm">
        <LtiPlatformDetailRow label={t('teacher.dashboard.lti.urls.loginUrl')} value={`${origin}/lti/login`} />
        <LtiPlatformDetailRow label={t('teacher.dashboard.lti.urls.launchUrl')} value={`${origin}/lti/callback`} />
        <LtiPlatformDetailRow label={t('teacher.dashboard.lti.urls.jwksUrl')} value={`${origin}/lti/jwks`} />
        <LtiPlatformDetailRow label={t('teacher.dashboard.lti.urls.redirectUri')} value={`${origin}/lti/callback`} />
      </div>
    </div>
  );
}

function LtiPlatformDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="max-w-[300px] truncate font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}

function LtiRegistrationForm({ controller }: { controller: TeacherDashboardController }) {
  const { t } = useLanguage();
  const form = controller.ltiForm;
  const isDisabled =
    !form.issuer ||
    !form.clientId ||
    !form.deploymentId ||
    !form.authLoginUrl ||
    !form.authTokenUrl ||
    !form.keySetUrl;

  return (
    <div className="space-y-4">
      <div className="mb-4">
        <LtiUrlsPanel />
      </div>
      <h3 className="text-base font-display font-bold text-foreground">{t('teacher.dashboard.lti.form.title')}</h3>
      <p className="text-sm text-muted-foreground">
        {t('teacher.dashboard.lti.form.subtitle')}
      </p>
      <div className="grid gap-3">
        <Input
          label={t('teacher.dashboard.lti.form.issuer')}
          value={form.issuer}
          onChange={(event) => controller.updateLtiField('issuer', event.target.value)}
          placeholder="https://canvas.instructure.com"
        />
        <Input
          label={t('teacher.dashboard.lti.form.clientId')}
          value={form.clientId}
          onChange={(event) => controller.updateLtiField('clientId', event.target.value)}
          placeholder="10000000000001"
        />
        <Input
          label={t('teacher.dashboard.lti.form.deploymentId')}
          value={form.deploymentId}
          onChange={(event) => controller.updateLtiField('deploymentId', event.target.value)}
          placeholder="1"
        />
        <Input
          label={t('teacher.dashboard.lti.form.authLoginUrl')}
          value={form.authLoginUrl}
          onChange={(event) => controller.updateLtiField('authLoginUrl', event.target.value)}
          placeholder="https://canvas.instructure.com/api/lti/authorize_redirect"
        />
        <Input
          label={t('teacher.dashboard.lti.form.authTokenUrl')}
          value={form.authTokenUrl}
          onChange={(event) => controller.updateLtiField('authTokenUrl', event.target.value)}
          placeholder="https://canvas.instructure.com/login/oauth2/token"
        />
        <Input
          label={t('teacher.dashboard.lti.form.keySetUrl')}
          value={form.keySetUrl}
          onChange={(event) => controller.updateLtiField('keySetUrl', event.target.value)}
          placeholder="https://canvas.instructure.com/api/lti/security/jwks"
        />
      </div>
      <Button
        onClick={controller.handleRegisterLtiPlatform}
        loading={controller.ltiSaving}
        disabled={isDisabled}
      >
        {t('teacher.dashboard.lti.form.register')}
      </Button>
    </div>
  );
}

function CreateClassDialog({ controller }: { controller: TeacherDashboardController }) {
  const { t } = useLanguage();
  return (
    <Dialog
      open={controller.isCreateDialogOpen}
      onOpenChange={controller.handleCreateDialogOpenChange}
    >
      <DialogContent className="border-3 border-foreground shadow-stamp">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{t('teacher.dashboard.createDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('teacher.dashboard.createDialog.subtitle')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <Input
            label={t('teacher.dashboard.createDialog.className')}
            value={controller.classForm.name}
            onChange={(event) => controller.updateClassField('name', event.target.value)}
            placeholder={t('teacher.dashboard.createDialog.classNamePlaceholder')}
          />
          <Input
            label={t('teacher.dashboard.createDialog.term')}
            value={controller.classForm.term}
            onChange={(event) => controller.updateClassField('term', event.target.value)}
            placeholder={t('teacher.dashboard.createDialog.termPlaceholder')}
          />
          <Input
            label={t('teacher.dashboard.createDialog.subject')}
            value={controller.classForm.subject}
            onChange={(event) => controller.updateClassField('subject', event.target.value)}
            placeholder={t('teacher.dashboard.createDialog.subjectPlaceholder')}
          />
          <Input
            label={t('teacher.dashboard.createDialog.gradeBand')}
            value={controller.classForm.gradeBand}
            onChange={(event) => controller.updateClassField('gradeBand', event.target.value)}
            placeholder={t('teacher.dashboard.createDialog.gradeBandPlaceholder')}
          />
          <div className="space-y-2">
            <label htmlFor="teacher-class-locale" className="text-base font-semibold text-foreground">
              {t('teacher.dashboard.createDialog.practiceLanguage')}
            </label>
            <select
              id="teacher-class-locale"
              value={controller.classForm.learningLocale}
              onChange={(event) => controller.updateClassField('learningLocale', event.target.value)}
              className="h-12 w-full rounded-xl border-3 border-border bg-card px-4 text-base text-foreground focus:border-primary focus:outline-none"
            >
              {LEARNING_LOCALES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={controller.closeCreateDialog}>
            {t('teacher.dashboard.createDialog.cancel')}
          </Button>
          <Button onClick={controller.handleCreateClass} loading={controller.savingClass}>
            {t('teacher.dashboard.createDialog.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JoinCodeDialog({ controller }: { controller: TeacherDashboardController }) {
  const { t } = useLanguage();
  return (
    <Dialog
      open={controller.joinCodeClassId !== null}
      onOpenChange={(open) => {
        if (!open) controller.closeJoinCodeDialog();
      }}
    >
      <DialogContent className="border-3 border-foreground shadow-stamp">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{t('teacher.dashboard.joinDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('teacher.dashboard.joinDialog.subtitle')}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {controller.joinCodeLoading ? (
            <InlineLoader />
          ) : controller.joinCodeData?.active ? (
            <ActiveJoinCode controller={controller} />
          ) : (
            <div className="space-y-4 py-4 text-center">
              <p className="text-muted-foreground">{t('teacher.dashboard.joinDialog.noActive')}</p>
              <Button onClick={controller.handleGenerateCode}>{t('teacher.dashboard.joinDialog.generate')}</Button>
            </div>
          )}
        </div>

        <DialogFooter>
          {controller.joinCodeData?.active && (
            <Button
              variant="outline"
              onClick={controller.handleDeactivateCode}
              disabled={controller.joinCodeLoading}
            >
              {t('teacher.dashboard.joinDialog.deactivate')}
            </Button>
          )}
          {controller.joinCodeData?.active && (
            <Button onClick={controller.handleGenerateCode} disabled={controller.joinCodeLoading}>
              {t('teacher.dashboard.joinDialog.regenerate')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActiveJoinCode({ controller }: { controller: TeacherDashboardController }) {
  const { t } = useLanguage();
  const code = controller.joinCodeData;
  if (!code?.active) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-3 rounded-2xl border-2 border-border bg-secondary/60 p-6">
        <span className="font-mono text-4xl font-bold tracking-[0.4em] text-foreground">
          {code.joinCode}
        </span>
        <button
          type="button"
          onClick={() => controller.handleCopyCode(code.joinCode)}
          className="rounded-lg border border-border bg-card p-2 text-muted-foreground transition-colors hover:text-foreground"
          title={t('teacher.dashboard.joinDialog.copyTitle')}
        >
          <ClipboardCopy size={18} />
        </button>
      </div>
      {controller.joinCodeCopied && (
        <p className="text-center text-sm font-medium text-success">{t('teacher.dashboard.joinDialog.copied')}</p>
      )}
      <p className="text-center text-sm text-muted-foreground">
        {t('teacher.dashboard.joinDialog.instructions')}
      </p>
    </div>
  );
}

function RosterDialog({ controller }: { controller: TeacherDashboardController }) {
  const { t } = useLanguage();
  return (
    <Dialog
      open={controller.rosterClassId !== null}
      onOpenChange={(open) => {
        if (!open) controller.closeRosterDialog();
      }}
    >
      <DialogContent className="border-3 border-foreground shadow-stamp sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{t('teacher.dashboard.roster.title')}</DialogTitle>
          <DialogDescription>
            {controller.roster.length} student{controller.roster.length !== 1 ? 's' : ''} enrolled
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[400px] overflow-y-auto py-2">
          {controller.rosterLoading ? (
            <InlineLoader />
          ) : controller.roster.length === 0 ? (
            <EmptyRosterState onInviteStudents={controller.openInviteFromRoster} />
          ) : (
            <div className="space-y-2">
              {controller.roster.map((student, index) => (
                <RosterStudentRow
                  key={student.uid || `row-${index}`}
                  student={student}
                  removingUid={controller.removingUid}
                  onRemove={controller.handleRemoveStudent}
                />
              ))}
            </div>
          )}
          {controller.canvasRosterSummary && (
            <CanvasRosterGapSection
              gap={controller.canvasRosterGap}
              summary={controller.canvasRosterSummary}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmptyRosterState({ onInviteStudents }: { onInviteStudents: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="py-8 text-center">
      <Users className="mx-auto size-10 text-muted-foreground" />
      <p className="mt-3 text-muted-foreground">{t('teacher.dashboard.roster.emptyTitle')}</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onInviteStudents}>
        <UserPlus size={14} className="mr-1.5" />
        {t('teacher.dashboard.roster.inviteStudents')}
      </Button>
    </div>
  );
}

function RosterStudentRow({
  student,
  removingUid,
  onRemove,
}: {
  student: ClassRosterStudent;
  removingUid: string | null;
  onRemove: (studentUid: string) => void;
}) {
  const { t } = useLanguage();
  const joinedLabel =
    student.joinSource === 'join_code'
      ? t('teacher.dashboard.roster.joinedViaCode')
      : student.joinSource === 'lti'
        ? t('teacher.dashboard.roster.joinedViaLti')
        : student.joinSource === 'canvas_legacy'
          ? t('teacher.dashboard.roster.legacyCanvas')
          : student.joinSource || t('teacher.dashboard.roster.enrolled');
  const enrolledSuffix = student.enrolledAt
    ? ` · ${new Date(student.enrolledAt).toLocaleDateString()}`
    : '';
  const subtitle = `${joinedLabel}${enrolledSuffix}`;

  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/40 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium text-foreground">{student.displayName}</p>
          {student.isOnCanvasRoster === true && (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
              {t('teacher.dashboard.roster.onCanvas')}
            </span>
          )}
          {student.isOnCanvasRoster === false && (
            <span className="rounded-full border border-muted bg-muted/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('teacher.dashboard.roster.notOnCanvas')}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {student.uid && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onRemove(student.uid)}
          disabled={removingUid === student.uid}
          className="text-destructive hover:text-destructive"
        >
          {removingUid === student.uid ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 size={14} />
          )}
        </Button>
      )}
    </div>
  );
}

function CanvasRosterGapSection({
  gap,
  summary,
}: {
  gap: CanvasRosterGapEntry[];
  summary: CanvasRosterGapSummary;
}) {
  const { t } = useLanguage();
  return (
    <div className="mt-6 space-y-2 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{t('teacher.dashboard.canvas.gap.title')}</h3>
        <span className="text-xs text-muted-foreground">
          {t('teacher.dashboard.canvas.gap.summary')
            .replace('{joined}', String(summary.joined))
            .replace('{total}', String(summary.canvas_total))}
        </span>
      </div>
      {gap.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('teacher.dashboard.canvas.gap.allJoined')}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {t('teacher.dashboard.canvas.gap.shareCode')}
          </p>
          <ul className="space-y-1">
            {gap.map((entry) => (
              <li
                key={entry.canvas_email}
                className="flex items-center justify-between rounded-lg border border-dashed border-border px-3 py-2 text-sm"
              >
                <span className="truncate">{entry.canvas_name || entry.canvas_email}</span>
                <span className="truncate text-xs text-muted-foreground">{entry.canvas_email}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function InlineLoader() {
  return (
    <div className="flex justify-center py-8">
      <Loader2 className="size-6 animate-spin text-primary" />
    </div>
  );
}
