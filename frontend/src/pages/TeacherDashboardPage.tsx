import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  School,
  Trash2,
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
} from '@/api/teacher';
import { OnboardingHint } from '@/components/ui/OnboardingHint';
import type {
  ClassJoinCodeData,
  ClassRosterStudent,
  CreateTeacherClassPayload,
  TeacherDashboardData,
} from '@/types';

const DEFAULT_CLASS_FORM: CreateTeacherClassPayload = {
  name: '',
  term: '',
  subject: '',
  gradeBand: '',
  learningLocale: 'ko-KR',
};

const LOCALE_OPTIONS = [
  { value: 'ko-KR', label: 'Korean (Korea)' },
  { value: 'es-ES', label: 'Spanish (Spain)' },
  { value: 'fr-FR', label: 'French (France)' },
];

export function TeacherDashboardPage() {
  const navigate = useNavigate();
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
    setRosterClassId(classId);
    setRoster([]);
    setRosterLoading(true);
    try {
      const students = await getClassRoster(classId);
      setRoster(students);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load roster.');
    } finally {
      setRosterLoading(false);
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
        <Button variant="outline" onClick={() => navigate('/school/setup')}>
          Go to school setup
        </Button>
      </div>
    );
  }

  const filteredClasses = useMemo(() => {
    if (!classFilter) return dashboard.classes;
    return dashboard.classes.filter((c) => c.id === classFilter);
  }, [dashboard.classes, classFilter]);

  const filteredSummary = useMemo(() => {
    if (!classFilter) return dashboard.summary;
    const studentCount = filteredClasses.reduce((sum, c) => sum + c.studentCount, 0);
    const assignmentCount = filteredClasses.reduce((sum, c) => sum + (c.assignmentCount ?? 0), 0);
    return {
      classCount: filteredClasses.length,
      studentCount,
      speakingMinutes: dashboard.summary.speakingMinutes,
      assignmentCount,
    };
  }, [dashboard.summary, classFilter, filteredClasses]);

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
            This dashboard now reads from the school domain model rather than hardcoded mock data. Classes created
            here are attached to a real organization and teacher membership context.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => navigate('/school/setup')}>
            Workspace settings
          </Button>
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
                This is the first real teacher class list for the school track.
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
              {filteredClasses.map((classSummary) => (
                <div key={classSummary.id} className="rounded-2xl border-2 border-border bg-secondary/50 p-5">
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
                      onClick={() => openJoinCodeDialog(classSummary.id)}
                    >
                      <UserPlus size={14} className="mr-1.5" />
                      Invite students
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openRosterDialog(classSummary.id)}
                    >
                      <Users size={14} className="mr-1.5" />
                      Roster
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/app/teacher/classes/${classSummary.id}/analytics`)}
                    >
                      Class analytics
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/app/teacher/classes/${classSummary.id}/assignments`)}
                    >
                      Build assignments
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="border-3 border-foreground shadow-stamp">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Create class</DialogTitle>
            <DialogDescription>
              This writes a real `classes/{'{classId}'}` record under the active organization and attaches it to the
              active teacher membership.
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
                {LOCALE_OPTIONS.map((option) => (
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
                  Students go to <strong>/app/join</strong> and enter this code.
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
                {roster.map((student) => (
                  <div
                    key={student.uid}
                    className="flex items-center justify-between rounded-xl border border-border bg-secondary/40 px-4 py-3"
                  >
                    <div>
                      <p className="font-medium text-foreground">{student.displayName}</p>
                      <p className="text-xs text-muted-foreground">
                        {student.joinSource === 'join_code' ? 'Joined via code' : student.joinSource || 'Enrolled'}
                        {student.enrolledAt ? ` · ${new Date(student.enrolledAt).toLocaleDateString()}` : ''}
                      </p>
                    </div>
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
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
