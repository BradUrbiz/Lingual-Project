import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TEACHER_JOIN_ORG_ROUTE } from '@/lib/homeRoutes';
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  Check,
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
  X,
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
  listTeacherInvitations,
  approveTeacherInvitation,
  rejectTeacherInvitation,
} from '@/api/schoolRequests';
import type { TeacherInviteCodeData } from '@/api/schoolRequests';
import { getLtiPlatform, registerLtiPlatform, deleteLtiPlatform } from '@/api/lti';
import type { LtiPlatformConfig } from '@/api/lti';
import { useMembership } from '@/contexts/MembershipContext';
import { LEARNING_LOCALES } from '@/lib/learningLocales';
import { OnboardingHint } from '@/components/ui/OnboardingHint';
import type {
  ClassJoinCodeData,
  ClassRosterStudent,
  CreateTeacherClassPayload,
  TeacherDashboardData,
  TeacherInvitation,
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

export function TeacherDashboardPage() {
  const navigate = useNavigate();
  const { hasRole } = useMembership();
  const isSchoolAdmin = hasRole('school_admin');

  const [loading, setLoading] = useState(true);
  const [savingClass, setSavingClass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<TeacherDashboardData | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [classForm, setClassForm] = useState<CreateTeacherClassPayload>(DEFAULT_CLASS_FORM);
  const [classFilter, setClassFilter] = useState('');

  // Join code state
  const [joinCodeClassId, setJoinCodeClassId] = useState<string | null>(null);
  const [joinCodeData, setJoinCodeData] = useState<ClassJoinCodeData | null>(null);
  const [joinCodeLoading, setJoinCodeLoading] = useState(false);
  const [joinCodeCopied, setJoinCodeCopied] = useState(false);

  // Roster state
  const [rosterClassId, setRosterClassId] = useState<string | null>(null);
  const [roster, setRoster] = useState<ClassRosterStudent[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [removingUid, setRemovingUid] = useState<string | null>(null);

  // Canvas roster gap state
  const [canvasRosterGap, setCanvasRosterGap] = useState<CanvasRosterGapEntry[]>([]);
  const [canvasRosterSummary, setCanvasRosterSummary] =
    useState<CanvasRosterGapSummary | null>(null);

  // Tracks the class whose roster is currently being fetched, so an
  // in-flight fetch for class A doesn't overwrite state after the teacher
  // has already switched to class B.
  const activeRosterClassIdRef = useRef<string | null>(null);

  // Team section state (school_admin only)
  const [teacherInviteCode, setTeacherInviteCode] = useState<TeacherInviteCodeData | null>(null);
  const [teacherInviteCodeLoading, setTeacherInviteCodeLoading] = useState(false);
  const [teacherInviteCodeCopied, setTeacherInviteCodeCopied] = useState(false);
  const [pendingInvitations, setPendingInvitations] = useState<TeacherInvitation[]>([]);
  const [pendingInvitationsLoading, setPendingInvitationsLoading] = useState(false);
  const [processingInvitationId, setProcessingInvitationId] = useState<string | null>(null);

  // LTI configuration state (school_admin only)
  const [ltiPlatform, setLtiPlatform] = useState<LtiPlatformConfig | null>(null);
  const [ltiLoading, setLtiLoading] = useState(false);
  const [ltiSaving, setLtiSaving] = useState(false);
  const [ltiForm, setLtiForm] = useState({
    issuer: '',
    clientId: '',
    deploymentId: '',
    authLoginUrl: '',
    authTokenUrl: '',
    keySetUrl: '',
  });

  const loadDashboard = async () => {
    try {
      const nextDashboard = await getTeacherDashboard();
      setDashboard(nextDashboard);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load teacher dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const updateClassField = <K extends keyof CreateTeacherClassPayload>(
    field: K,
    value: CreateTeacherClassPayload[K]
  ) => {
    setClassForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleCreateClass = async () => {
    setSavingClass(true);
    setError(null);

    try {
      await createTeacherClass(classForm);
      setIsCreateDialogOpen(false);
      setClassForm(DEFAULT_CLASS_FORM);
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create class.');
    } finally {
      setSavingClass(false);
    }
  };

  // ── Join code handlers ──────────────────────────────────────────────

  const openJoinCodeDialog = async (classId: string) => {
    setJoinCodeClassId(classId);
    setJoinCodeData(null);
    setJoinCodeLoading(true);
    setJoinCodeCopied(false);
    try {
      const data = await getClassJoinCode(classId);
      setJoinCodeData(data);
    } catch {
      // No active code — that's fine, user can generate one
      setJoinCodeData(null);
    } finally {
      setJoinCodeLoading(false);
    }
  };

  const handleGenerateCode = async () => {
    if (!joinCodeClassId) return;
    setJoinCodeLoading(true);
    try {
      const data = await generateClassJoinCode(joinCodeClassId);
      setJoinCodeData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate join code.');
    } finally {
      setJoinCodeLoading(false);
    }
  };

  const handleDeactivateCode = async () => {
    if (!joinCodeClassId) return;
    setJoinCodeLoading(true);
    try {
      await deactivateClassJoinCode(joinCodeClassId);
      setJoinCodeData(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deactivate join code.');
    } finally {
      setJoinCodeLoading(false);
    }
  };

  const handleCopyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setJoinCodeCopied(true);
    setTimeout(() => setJoinCodeCopied(false), 2000);
  };

  // ── Roster handlers ───────────────────────────────────────────────

  const openRosterDialog = async (classId: string) => {
    activeRosterClassIdRef.current = classId;
    setRosterClassId(classId);
    setRoster([]);
    setCanvasRosterGap([]);
    setCanvasRosterSummary(null);
    setRosterLoading(true);
    try {
      const [students, gapResponse] = await Promise.all([
        getClassRoster(classId),
        getClassCanvasRosterGap(classId),
      ]);
      // Bail if the teacher clicked a different class's roster button
      // before this fetch resolved — applying stale data would show
      // class A's roster under class B's dialog title.
      if (activeRosterClassIdRef.current !== classId) return;
      setRoster(students);
      setCanvasRosterGap(gapResponse.gap);
      setCanvasRosterSummary(gapResponse.summary);
    } catch (err) {
      if (activeRosterClassIdRef.current !== classId) return;
      setError(err instanceof Error ? err.message : 'Failed to load roster.');
    } finally {
      if (activeRosterClassIdRef.current === classId) {
        setRosterLoading(false);
      }
    }
  };

  const handleRemoveStudent = async (studentUid: string) => {
    if (!rosterClassId) return;
    setRemovingUid(studentUid);
    try {
      await removeStudentFromClass(rosterClassId, studentUid);
      setRoster((prev) => prev.filter((s) => s.uid !== studentUid));
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove student.');
    } finally {
      setRemovingUid(null);
    }
  };

  // ── Team section handlers (school_admin only) ──────────────────────

  const loadTeamData = useCallback(async () => {
    if (!isSchoolAdmin) return;
    setTeacherInviteCodeLoading(true);
    setPendingInvitationsLoading(true);
    try {
      const code = await getTeacherInviteCode();
      setTeacherInviteCode(code);
    } catch {
      setTeacherInviteCode(null);
    } finally {
      setTeacherInviteCodeLoading(false);
    }
    try {
      const invitations = await listTeacherInvitations('pending');
      setPendingInvitations(invitations);
    } catch {
      setPendingInvitations([]);
    } finally {
      setPendingInvitationsLoading(false);
    }
    // Load LTI platform config
    setLtiLoading(true);
    try {
      const platform = await getLtiPlatform();
      setLtiPlatform(platform);
    } catch {
      setLtiPlatform(null);
    } finally {
      setLtiLoading(false);
    }
  }, [isSchoolAdmin]);

  useEffect(() => {
    loadTeamData();
  }, [loadTeamData]);

  const handleGenerateTeacherInviteCode = async () => {
    setTeacherInviteCodeLoading(true);
    try {
      const data = await generateTeacherInviteCode();
      setTeacherInviteCode(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate teacher invite code.');
    } finally {
      setTeacherInviteCodeLoading(false);
    }
  };

  const handleDeactivateTeacherInviteCode = async () => {
    setTeacherInviteCodeLoading(true);
    try {
      await deactivateTeacherInviteCode();
      setTeacherInviteCode(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deactivate teacher invite code.');
    } finally {
      setTeacherInviteCodeLoading(false);
    }
  };

  const handleCopyTeacherInviteCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setTeacherInviteCodeCopied(true);
    setTimeout(() => setTeacherInviteCodeCopied(false), 2000);
  };

  const handleRegisterLtiPlatform = async () => {
    setLtiSaving(true);
    setError(null);
    try {
      await registerLtiPlatform(ltiForm);
      const platform = await getLtiPlatform();
      setLtiPlatform(platform);
      setLtiForm({ issuer: '', clientId: '', deploymentId: '', authLoginUrl: '', authTokenUrl: '', keySetUrl: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register LTI platform.');
    } finally {
      setLtiSaving(false);
    }
  };

  const handleRemoveLtiPlatform = async () => {
    setLtiSaving(true);
    setError(null);
    try {
      await deleteLtiPlatform();
      setLtiPlatform(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove LTI platform.');
    } finally {
      setLtiSaving(false);
    }
  };

  const handleApproveInvitation = async (invitationId: string) => {
    setProcessingInvitationId(invitationId);
    try {
      await approveTeacherInvitation(invitationId);
      setPendingInvitations((prev) => prev.filter((inv) => inv.id !== invitationId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve invitation.');
    } finally {
      setProcessingInvitationId(null);
    }
  };

  const handleRejectInvitation = async (invitationId: string) => {
    setProcessingInvitationId(invitationId);
    try {
      await rejectTeacherInvitation(invitationId);
      setPendingInvitations((prev) => prev.filter((inv) => inv.id !== invitationId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject invitation.');
    } finally {
      setProcessingInvitationId(null);
    }
  };

  const filteredClasses = useMemo(() => {
    if (!dashboard || !classFilter) return dashboard?.classes ?? [];
    return dashboard.classes.filter((c) => c.id === classFilter);
  }, [dashboard, classFilter]);

  const filteredSummary = useMemo(() => {
    if (!dashboard || !classFilter) return dashboard?.summary ?? { classCount: 0, studentCount: 0, speakingMinutes: 0, assignmentCount: 0 };
    const studentCount = filteredClasses.reduce((sum, c) => sum + c.studentCount, 0);
    const assignmentCount = filteredClasses.reduce((sum, c) => sum + (c.assignmentCount ?? 0), 0);
    return {
      classCount: filteredClasses.length,
      studentCount,
      speakingMinutes: dashboard.summary.speakingMinutes,
      assignmentCount,
    };
  }, [dashboard, classFilter, filteredClasses]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{error || 'Teacher dashboard is unavailable.'}</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => navigate(TEACHER_JOIN_ORG_ROUTE)}>
          Go to teacher join
        </Button>
      </div>
    );
  }

  const stats = [
    {
      label: 'Classes',
      value: filteredSummary.classCount,
      icon: BookOpen,
      accent: 'bg-primary/10 text-primary',
    },
    {
      label: 'Students',
      value: filteredSummary.studentCount,
      icon: Users,
      accent: 'bg-success/15 text-success',
    },
    {
      label: 'Speaking minutes',
      value: filteredSummary.speakingMinutes,
      icon: CalendarClock,
      accent: 'bg-accent/20 text-accent-foreground',
    },
    {
      label: 'Assignments',
      value: filteredSummary.assignmentCount,
      icon: GraduationCap,
      accent: 'bg-secondary text-foreground',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border-2 border-border bg-secondary px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <School size={14} />
            School integration
          </div>
          <h1 className="text-3xl font-display font-bold text-foreground">
            {dashboard.organizationName || 'Teacher workspace'}
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Manage your classes, create speaking assignments, and track student progress.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <Plus size={16} className="mr-2" />
            Create class
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {dashboard.alerts.length > 0 && (
        <div className="grid gap-3">
          {dashboard.alerts.map((message) => (
            <Alert key={message}>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {dashboard.classes.length > 1 && (
        <div className="flex items-center gap-3">
          <Filter size={16} className="text-muted-foreground" />
          <label htmlFor="dashboard-class-filter" className="text-sm font-medium text-muted-foreground">
            Class
          </label>
          <select
            id="dashboard-class-filter"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="h-9 rounded-xl border-2 border-border bg-card px-3 text-sm text-foreground focus:border-primary focus:outline-none"
          >
            <option value="">All classes</option>
            {dashboard.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {classFilter && (
            <button
              onClick={() => setClassFilter('')}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="border-3 border-foreground p-5 shadow-stamp">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-foreground ${stat.accent}`}>
                <stat.icon size={22} strokeWidth={2.5} />
              </div>
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Beta
              </span>
            </div>
            <p className="text-3xl font-display font-bold text-foreground">{stat.value}</p>
            <p className="mt-1 text-sm font-medium text-muted-foreground">{stat.label}</p>
          </Card>
        ))}
      </div>

      {dashboard && (
        <>
          <OnboardingHint
            show={dashboard.classes.length === 0}
            message="Create your first class to get started."
            ctaLabel="Create Class"
            ctaTo="/app/teacher"
          />
          <OnboardingHint
            show={dashboard.classes.length > 0 && dashboard.summary.studentCount === 0}
            message="Invite students to your class using a join code."
            ctaLabel="Go to Class"
            ctaTo={`/app/teacher/classes/${dashboard.classes[0]?.id}/analytics`}
          />
          <OnboardingHint
            show={dashboard.classes.length > 0 && dashboard.summary.studentCount > 0 && dashboard.summary.assignmentCount === 0}
            message="Create your first assignment from a class page."
            ctaLabel="Go to Class"
            ctaTo={`/app/teacher/classes/${dashboard.classes[0]?.id}/assignments`}
          />
        </>
      )}

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="border-3 border-foreground p-6 shadow-stamp">
          <h2 className="text-xl font-display font-bold text-foreground">Setup checklist</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Phase 1 is complete when the school workspace, first class, and first student path all exist on the
            real data model.
          </p>
          <div className="mt-6 space-y-4">
            {dashboard.setupChecklist.map((item) => (
              <div key={item.id} className="rounded-2xl border-2 border-border bg-secondary/60 p-4">
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full border-2 ${
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

        <Card className="border-3 border-foreground p-6 shadow-stamp">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-display font-bold text-foreground">Classes</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Your active classes and their student rosters.
              </p>
            </div>
            <Button size="sm" onClick={() => setIsCreateDialogOpen(true)}>
              <Plus size={16} className="mr-2" />
              New class
            </Button>
          </div>

          {filteredClasses.length === 0 ? (
            <div className="mt-6 rounded-3xl border-3 border-dashed border-border bg-secondary/40 p-8 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-foreground bg-card">
                <BookOpen size={24} strokeWidth={2.5} />
              </div>
              <h3 className="mt-4 text-xl font-display font-bold text-foreground">No classes yet</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Create the first class so assignments, roster imports, and assignment-aware practice can anchor to a
                real school object.
              </p>
              <Button className="mt-5" onClick={() => setIsCreateDialogOpen(true)}>
                Create first class
              </Button>
            </div>
          ) : (
            <div className="mt-6 grid gap-4">
              {filteredClasses.map((classSummary) => {
                const goToClass = () =>
                  navigate(`/app/teacher/classes/${classSummary.id}/analytics`);
                return (
                  <div
                    key={classSummary.id}
                    role="button"
                    tabIndex={0}
                    onClick={goToClass}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        goToClass();
                      }
                    }}
                    aria-label={`Open ${classSummary.name} analytics`}
                    className="cursor-pointer rounded-2xl border-2 border-border bg-secondary/50 p-5 transition-colors hover:border-primary hover:bg-secondary focus:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h3 className="text-lg font-display font-bold text-foreground">{classSummary.name}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {classSummary.subject || 'Subject TBD'}
                          {classSummary.term ? ` · ${classSummary.term}` : ''}
                          {classSummary.gradeBand ? ` · Grades ${classSummary.gradeBand}` : ''}
                        </p>
                      </div>
                      <div className="grid gap-3 sm:w-[420px] sm:grid-cols-3">
                        <div className="rounded-xl border border-border bg-card px-3 py-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            Students
                          </p>
                          <p className="mt-1 text-lg font-bold text-foreground">{classSummary.studentCount}</p>
                        </div>
                        <div className="rounded-xl border border-border bg-card px-3 py-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            Language
                          </p>
                          <p className="mt-1 text-lg font-bold text-foreground">{classSummary.learningLocale}</p>
                        </div>
                        <div className="rounded-xl border border-border bg-card px-3 py-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            Assignments
                          </p>
                          <p className="mt-1 text-lg font-bold text-foreground">{classSummary.assignmentCount ?? 0}</p>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          openJoinCodeDialog(classSummary.id);
                        }}
                      >
                        <UserPlus size={14} className="mr-1.5" />
                        Invite students
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          openRosterDialog(classSummary.id);
                        }}
                      >
                        <Users size={14} className="mr-1.5" />
                        Roster
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(`/app/teacher/classes/${classSummary.id}/assignments`);
                        }}
                      >
                        Build assignments
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className={classSummary.canvasLinked ? 'group' : undefined}
                        aria-label={
                          classSummary.canvasLinked
                            ? 'Canvas linked — click to manage or resync'
                            : 'Connect Canvas'
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(`/app/teacher/classes/${classSummary.id}/canvas/connect`);
                        }}
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
                            <span className="group-hover:hidden group-focus-visible:hidden">
                              Canvas Linked
                            </span>
                            <span className="hidden group-hover:inline group-focus-visible:inline">
                              Resync Canvas
                            </span>
                          </>
                        ) : (
                          <>
                            <LinkIcon size={14} className="mr-1.5" />
                            Canvas
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* ── Team section (school_admin only) ─────────────────────────── */}
      {isSchoolAdmin && (
        <div className="grid gap-6 xl:grid-cols-2">
          {/* Teacher Invite Code card */}
          <Card className="border-3 border-foreground p-6 shadow-stamp">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border-2 border-foreground bg-primary/10 text-primary">
                <ShieldCheck size={20} strokeWidth={2.5} />
              </div>
              <div>
                <h2 className="text-xl font-display font-bold text-foreground">Teacher Invite Code</h2>
                <p className="text-sm text-muted-foreground">Share with teachers to join your school.</p>
              </div>
            </div>

            {teacherInviteCodeLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : teacherInviteCode?.active && teacherInviteCode.inviteCode ? (
              <div className="space-y-4">
                <div className="flex items-center justify-center gap-3 rounded-2xl border-2 border-border bg-secondary/60 p-6">
                  <span className="font-mono text-4xl font-bold tracking-[0.4em] text-foreground">
                    {teacherInviteCode.inviteCode}
                  </span>
                  <button
                    onClick={() => handleCopyTeacherInviteCode(teacherInviteCode.inviteCode)}
                    className="rounded-lg border border-border bg-card p-2 text-muted-foreground hover:text-foreground transition-colors"
                    title="Copy code"
                  >
                    <ClipboardCopy size={18} />
                  </button>
                </div>
                {teacherInviteCodeCopied && (
                  <p className="text-center text-sm text-success font-medium">Copied to clipboard!</p>
                )}
                <p className="text-center text-sm text-muted-foreground">
                  Teachers go to <strong>l1ngual.com/app/join-school</strong> and enter this code.
                </p>
                <div className="flex justify-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDeactivateTeacherInviteCode}
                    disabled={teacherInviteCodeLoading}
                  >
                    Deactivate
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center space-y-4 py-4">
                <p className="text-muted-foreground">
                  {teacherInviteCode && !teacherInviteCode.active
                    ? 'The invite code has been deactivated.'
                    : 'No active teacher invite code.'}
                </p>
                <Button onClick={handleGenerateTeacherInviteCode} disabled={teacherInviteCodeLoading}>
                  {teacherInviteCode && !teacherInviteCode.active ? 'Regenerate' : 'Generate Invite Code'}
                </Button>
              </div>
            )}
          </Card>

          {/* Pending Teacher Invitations card */}
          <Card className="border-3 border-foreground p-6 shadow-stamp">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border-2 border-foreground bg-success/15 text-success">
                <UserPlus size={20} strokeWidth={2.5} />
              </div>
              <div>
                <h2 className="text-xl font-display font-bold text-foreground">Pending Teacher Invitations</h2>
                <p className="text-sm text-muted-foreground">Review requests from teachers to join your school.</p>
              </div>
            </div>

            {pendingInvitationsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : pendingInvitations.length === 0 ? (
              <div className="text-center py-8">
                <Users className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-3 text-muted-foreground">No pending invitations.</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {pendingInvitations.map((invitation) => (
                  <div
                    key={invitation.id}
                    className="flex items-center justify-between rounded-xl border border-border bg-secondary/40 px-4 py-3"
                  >
                    <div>
                      <p className="font-medium text-foreground">{invitation.name || 'Unknown'}</p>
                      <p className="text-xs text-muted-foreground">
                        {invitation.email || 'No email'}
                        {invitation.createdAt
                          ? ` · Submitted ${new Date(invitation.createdAt).toLocaleDateString()}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleApproveInvitation(invitation.id)}
                        disabled={processingInvitationId === invitation.id}
                        className="bg-success hover:bg-success/90 text-white"
                      >
                        {processingInvitationId === invitation.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check size={14} className="mr-1" />
                        )}
                        Approve
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRejectInvitation(invitation.id)}
                        disabled={processingInvitationId === invitation.id}
                      >
                        {processingInvitationId === invitation.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <X size={14} className="mr-1" />
                        )}
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── LTI Configuration (school_admin only) ──────────────────── */}
      {isSchoolAdmin && (
        <Card className="border-3 border-foreground p-6 shadow-stamp">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border-2 border-foreground bg-primary/10 text-primary">
              <LinkIcon size={20} strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-xl font-display font-bold text-foreground">LTI 1.3 Configuration</h2>
              <p className="text-sm text-muted-foreground">
                Connect Canvas via LTI 1.3 for single sign-on and deep linking.
              </p>
            </div>
          </div>

          {ltiLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : ltiPlatform ? (
            <div className="space-y-5">
              <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4 space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Registered Platform
                </h3>
                <div className="grid gap-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-muted-foreground">Issuer</span>
                    <span className="text-foreground font-mono text-xs truncate max-w-[300px]">{ltiPlatform.issuer}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-muted-foreground">Client ID</span>
                    <span className="text-foreground font-mono text-xs truncate max-w-[300px]">{ltiPlatform.clientId}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-muted-foreground">Deployment ID</span>
                    <span className="text-foreground font-mono text-xs truncate max-w-[300px]">{ltiPlatform.deploymentId}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4 space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Your Lingual LTI URLs
                </h3>
                <p className="text-xs text-muted-foreground">
                  Enter these in your Canvas Developer Key / LTI tool configuration.
                </p>
                <div className="grid gap-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-muted-foreground">Login URL</span>
                    <span className="text-foreground font-mono text-xs truncate max-w-[300px]">
                      {window.location.origin}/lti/login
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-muted-foreground">Launch URL</span>
                    <span className="text-foreground font-mono text-xs truncate max-w-[300px]">
                      {window.location.origin}/lti/callback
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-muted-foreground">JWKS URL</span>
                    <span className="text-foreground font-mono text-xs truncate max-w-[300px]">
                      {window.location.origin}/lti/jwks
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-muted-foreground">Redirect URI</span>
                    <span className="text-foreground font-mono text-xs truncate max-w-[300px]">
                      {window.location.origin}/lti/callback
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRemoveLtiPlatform}
                  loading={ltiSaving}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 size={14} className="mr-1.5" />
                  Remove LTI Platform
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4 space-y-3 mb-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Your Lingual LTI URLs
                </h3>
                <p className="text-xs text-muted-foreground">
                  Enter these in your Canvas Developer Key / LTI tool configuration.
                </p>
                <div className="grid gap-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-muted-foreground">Login URL</span>
                    <span className="text-foreground font-mono text-xs truncate max-w-[300px]">
                      {window.location.origin}/lti/login
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-muted-foreground">Launch URL</span>
                    <span className="text-foreground font-mono text-xs truncate max-w-[300px]">
                      {window.location.origin}/lti/callback
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-muted-foreground">JWKS URL</span>
                    <span className="text-foreground font-mono text-xs truncate max-w-[300px]">
                      {window.location.origin}/lti/jwks
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-muted-foreground">Redirect URI</span>
                    <span className="text-foreground font-mono text-xs truncate max-w-[300px]">
                      {window.location.origin}/lti/callback
                    </span>
                  </div>
                </div>
              </div>

              <h3 className="text-base font-display font-bold text-foreground">Register Canvas Platform</h3>
              <p className="text-sm text-muted-foreground">
                Enter the LTI 1.3 configuration values from your Canvas Developer Key.
              </p>
              <div className="grid gap-3">
                <Input
                  label="Issuer"
                  value={ltiForm.issuer}
                  onChange={(e) => setLtiForm((f) => ({ ...f, issuer: e.target.value }))}
                  placeholder="https://canvas.instructure.com"
                />
                <Input
                  label="Client ID"
                  value={ltiForm.clientId}
                  onChange={(e) => setLtiForm((f) => ({ ...f, clientId: e.target.value }))}
                  placeholder="10000000000001"
                />
                <Input
                  label="Deployment ID"
                  value={ltiForm.deploymentId}
                  onChange={(e) => setLtiForm((f) => ({ ...f, deploymentId: e.target.value }))}
                  placeholder="1"
                />
                <Input
                  label="Auth Login URL"
                  value={ltiForm.authLoginUrl}
                  onChange={(e) => setLtiForm((f) => ({ ...f, authLoginUrl: e.target.value }))}
                  placeholder="https://canvas.instructure.com/api/lti/authorize_redirect"
                />
                <Input
                  label="Auth Token URL"
                  value={ltiForm.authTokenUrl}
                  onChange={(e) => setLtiForm((f) => ({ ...f, authTokenUrl: e.target.value }))}
                  placeholder="https://canvas.instructure.com/login/oauth2/token"
                />
                <Input
                  label="Key Set URL"
                  value={ltiForm.keySetUrl}
                  onChange={(e) => setLtiForm((f) => ({ ...f, keySetUrl: e.target.value }))}
                  placeholder="https://canvas.instructure.com/api/lti/security/jwks"
                />
              </div>
              <Button
                onClick={handleRegisterLtiPlatform}
                loading={ltiSaving}
                disabled={!ltiForm.issuer || !ltiForm.clientId || !ltiForm.deploymentId || !ltiForm.authLoginUrl || !ltiForm.authTokenUrl || !ltiForm.keySetUrl}
              >
                Register Platform
              </Button>
            </div>
          )}
        </Card>
      )}

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="border-3 border-foreground shadow-stamp">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Create class</DialogTitle>
            <DialogDescription>
              Set up a new class for your students. You can invite students after creating it.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <Input
              label="Class name"
              value={classForm.name}
              onChange={(event) => updateClassField('name', event.target.value)}
              placeholder="French 1 - Period 2"
            />
            <Input
              label="Term"
              value={classForm.term}
              onChange={(event) => updateClassField('term', event.target.value)}
              placeholder="Fall 2026"
            />
            <Input
              label="Subject"
              value={classForm.subject}
              onChange={(event) => updateClassField('subject', event.target.value)}
              placeholder="French"
            />
            <Input
              label="Grade band"
              value={classForm.gradeBand}
              onChange={(event) => updateClassField('gradeBand', event.target.value)}
              placeholder="9-10"
            />
            <div className="space-y-2">
              <label htmlFor="teacher-class-locale" className="text-base font-semibold text-foreground">
                Practice language
              </label>
              <select
                id="teacher-class-locale"
                value={classForm.learningLocale}
                onChange={(event) => updateClassField('learningLocale', event.target.value)}
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
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateClass} loading={savingClass}>
              Create class
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Join code dialog */}
      <Dialog open={joinCodeClassId !== null} onOpenChange={(open) => { if (!open) setJoinCodeClassId(null); }}>
        <DialogContent className="border-3 border-foreground shadow-stamp">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Invite students</DialogTitle>
            <DialogDescription>
              Share this code with students. They enter it at the join page to enroll in your class.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {joinCodeLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : joinCodeData?.active ? (
              <div className="space-y-4">
                <div className="flex items-center justify-center gap-3 rounded-2xl border-2 border-border bg-secondary/60 p-6">
                  <span className="font-mono text-4xl font-bold tracking-[0.4em] text-foreground">
                    {joinCodeData.joinCode}
                  </span>
                  <button
                    onClick={() => handleCopyCode(joinCodeData.joinCode)}
                    className="rounded-lg border border-border bg-card p-2 text-muted-foreground hover:text-foreground transition-colors"
                    title="Copy code"
                  >
                    <ClipboardCopy size={18} />
                  </button>
                </div>
                {joinCodeCopied && (
                  <p className="text-center text-sm text-success font-medium">Copied to clipboard!</p>
                )}
                <p className="text-center text-sm text-muted-foreground">
                  Students go to <strong>l1ngual.com/app/join</strong> and enter this code.
                </p>
              </div>
            ) : (
              <div className="text-center space-y-4 py-4">
                <p className="text-muted-foreground">No active join code for this class.</p>
                <Button onClick={handleGenerateCode}>Generate join code</Button>
              </div>
            )}
          </div>

          <DialogFooter>
            {joinCodeData?.active && (
              <Button variant="outline" onClick={handleDeactivateCode} disabled={joinCodeLoading}>
                Deactivate code
              </Button>
            )}
            {joinCodeData?.active && (
              <Button onClick={handleGenerateCode} disabled={joinCodeLoading}>
                Regenerate
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Roster dialog */}
      <Dialog open={rosterClassId !== null} onOpenChange={(open) => { if (!open) setRosterClassId(null); }}>
        <DialogContent className="border-3 border-foreground shadow-stamp sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Class roster</DialogTitle>
            <DialogDescription>
              {roster.length} student{roster.length !== 1 ? 's' : ''} enrolled
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 max-h-[400px] overflow-y-auto">
            {rosterLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : roster.length === 0 ? (
              <div className="text-center py-8">
                <Users className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-3 text-muted-foreground">No students enrolled yet.</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => {
                    setRosterClassId(null);
                    if (rosterClassId) openJoinCodeDialog(rosterClassId);
                  }}
                >
                  <UserPlus size={14} className="mr-1.5" />
                  Invite students
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {roster.map((student, idx) => {
                  const key = student.uid || `row-${idx}`;
                  const joinedLabel =
                    student.joinSource === 'join_code'
                      ? 'Joined via code'
                      : student.joinSource === 'lti'
                      ? 'Joined via Canvas LTI'
                      : student.joinSource === 'canvas_legacy'
                      ? 'Legacy Canvas enrollment'
                      : student.joinSource || 'Enrolled';
                  const enrolledSuffix = student.enrolledAt
                    ? ` · ${new Date(student.enrolledAt).toLocaleDateString()}`
                    : '';
                  const subtitle = `${joinedLabel}${enrolledSuffix}`;
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between rounded-xl border border-border bg-secondary/40 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-foreground truncate">
                            {student.displayName}
                          </p>
                          {student.isOnCanvasRoster === true && (
                            <span className="rounded-full border border-emerald-500/40 bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                              On Canvas roster
                            </span>
                          )}
                          {student.isOnCanvasRoster === false && (
                            <span className="rounded-full border border-muted bg-muted/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Not on Canvas roster
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{subtitle}</p>
                      </div>
                      {student.uid && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveStudent(student.uid)}
                          disabled={removingUid === student.uid}
                          className="text-destructive hover:text-destructive"
                        >
                          {removingUid === student.uid ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {canvasRosterSummary && (
              <div className="mt-6 space-y-2 border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">
                    Canvas roster — not yet joined
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {canvasRosterSummary.joined} of {canvasRosterSummary.canvas_total}{' '}
                    Canvas students joined
                  </span>
                </div>
                {canvasRosterGap.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    All Canvas-rostered students have joined via class code.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Share the class code with these students to enroll them.
                    </p>
                    <ul className="space-y-1">
                      {canvasRosterGap.map((entry) => (
                        <li
                          key={entry.canvas_email}
                          className="flex items-center justify-between rounded-lg border border-dashed border-border px-3 py-2 text-sm"
                        >
                          <span className="truncate">{entry.canvas_name || entry.canvas_email}</span>
                          <span className="text-xs text-muted-foreground truncate">
                            {entry.canvas_email}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
