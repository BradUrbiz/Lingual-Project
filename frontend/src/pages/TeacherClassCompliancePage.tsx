import { useEffect, useReducer, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  FileCheck2,
  Loader2,
  ShieldCheck,
  type LucideIcon,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  bulkUpdateClassCompliance,
  downloadClassComplianceAuditExport,
  getClassComplianceRoster,
} from '@/api/teacher';
import { Alert, AlertDescription, Badge, Button, Card, Input } from '@/components/ui';
import { OnboardingHint } from '@/components/ui/OnboardingHint';
import type { ClassComplianceRosterData, ConsentStatus, UpdateStudentCompliancePayload } from '@/types';

type BulkConsentValue = 'unchanged' | ConsentStatus;
type BulkTextAllowedValue = 'unchanged' | 'allowed' | 'blocked';
type BulkRetentionValue = 'unchanged' | 'standard_school' | 'no_raw_audio';

const DEFAULT_BULK_FORM = {
  voiceConsentStatus: 'unchanged' as BulkConsentValue,
  textAllowed: 'unchanged' as BulkTextAllowedValue,
  retentionPolicyId: 'unchanged' as BulkRetentionValue,
  reason: '',
};

type BulkForm = typeof DEFAULT_BULK_FORM;
type ComplianceStat = {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  accent: string;
};

type ClassComplianceState = {
  loading: boolean;
  saving: boolean;
  exporting: boolean;
  error: string | null;
  bulkError: string | null;
  statusMessage: string | null;
  roster: ClassComplianceRosterData | null;
  selectedStudentUids: Set<string>;
  bulkForm: BulkForm;
};

type ClassComplianceAction =
  | { type: 'invalid-class' }
  | { type: 'load-start' }
  | { type: 'load-success'; roster: ClassComplianceRosterData }
  | { type: 'load-error'; error: string }
  | { type: 'toggle-student'; studentUid: string }
  | { type: 'toggle-all-students'; studentUids: string[]; allSelected: boolean }
  | { type: 'patch-bulk-form'; patch: Partial<BulkForm> }
  | { type: 'save-start' }
  | { type: 'save-success'; message: string }
  | { type: 'save-error'; error: string }
  | { type: 'export-start' }
  | { type: 'export-success'; message: string }
  | { type: 'export-error'; error: string };

const initialClassComplianceState: ClassComplianceState = {
  loading: true,
  saving: false,
  exporting: false,
  error: null,
  bulkError: null,
  statusMessage: null,
  roster: null,
  selectedStudentUids: new Set(),
  bulkForm: DEFAULT_BULK_FORM,
};

function classComplianceReducer(
  state: ClassComplianceState,
  action: ClassComplianceAction
): ClassComplianceState {
  switch (action.type) {
    case 'invalid-class':
      return { ...state, loading: false, error: 'Class id is required.' };
    case 'load-start':
      return { ...state, loading: true };
    case 'load-success':
      return { ...state, roster: action.roster, error: null, loading: false };
    case 'load-error':
      return { ...state, error: action.error, loading: false };
    case 'toggle-student': {
      const selectedStudentUids = new Set(state.selectedStudentUids);
      if (selectedStudentUids.has(action.studentUid)) {
        selectedStudentUids.delete(action.studentUid);
      } else {
        selectedStudentUids.add(action.studentUid);
      }
      return { ...state, selectedStudentUids };
    }
    case 'toggle-all-students':
      return {
        ...state,
        selectedStudentUids: action.allSelected ? new Set() : new Set(action.studentUids),
      };
    case 'patch-bulk-form':
      return { ...state, bulkForm: { ...state.bulkForm, ...action.patch } };
    case 'save-start':
      return { ...state, saving: true, bulkError: null, statusMessage: null };
    case 'save-success':
      return {
        ...state,
        saving: false,
        statusMessage: action.message,
        selectedStudentUids: new Set(),
        bulkForm: DEFAULT_BULK_FORM,
      };
    case 'save-error':
      return { ...state, saving: false, bulkError: action.error };
    case 'export-start':
      return { ...state, exporting: true, bulkError: null, statusMessage: null };
    case 'export-success':
      return { ...state, exporting: false, statusMessage: action.message };
    case 'export-error':
      return { ...state, exporting: false, bulkError: action.error };
    default:
      return state;
  }
}

function ComplianceStatsGrid({ stats }: { stats: ComplianceStat[] }) {
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

type BulkConsentUpdatesCardProps = {
  selectedCount: number;
  bulkForm: BulkForm;
  saving: boolean;
  hasBulkChanges: boolean;
  onBulkFormChange: (patch: Partial<BulkForm>) => void;
  onSave: () => void;
};

function BulkConsentUpdatesCard({
  selectedCount,
  bulkForm,
  saving,
  hasBulkChanges,
  onBulkFormChange,
  onSave,
}: BulkConsentUpdatesCardProps) {
  return (
    <Card className="border-3 border-foreground p-6 shadow-stamp">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">Bulk consent updates</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Apply one consent or retention change to the selected students in this class.
          </p>
        </div>
        <Badge variant="outline" size="sm">
          {selectedCount} selected
        </Badge>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm font-medium text-foreground">
          <span>Voice consent</span>
          <select
            value={bulkForm.voiceConsentStatus}
            onChange={(event) => onBulkFormChange({ voiceConsentStatus: event.target.value as BulkConsentValue })}
            className="w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none"
          >
            <option value="unchanged">Leave unchanged</option>
            <option value="unknown">Unknown</option>
            <option value="granted">Granted</option>
            <option value="revoked">Revoked</option>
          </select>
        </label>

        <label className="space-y-2 text-sm font-medium text-foreground">
          <span>Text launch</span>
          <select
            value={bulkForm.textAllowed}
            onChange={(event) => onBulkFormChange({ textAllowed: event.target.value as BulkTextAllowedValue })}
            className="w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none"
          >
            <option value="unchanged">Leave unchanged</option>
            <option value="allowed">Allow text</option>
            <option value="blocked">Block text</option>
          </select>
        </label>

        <label className="space-y-2 text-sm font-medium text-foreground sm:col-span-2">
          <span>Retention policy</span>
          <select
            value={bulkForm.retentionPolicyId}
            onChange={(event) => onBulkFormChange({ retentionPolicyId: event.target.value as BulkRetentionValue })}
            className="w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none"
          >
            <option value="unchanged">Leave unchanged</option>
            <option value="standard_school">Standard school retention</option>
            <option value="no_raw_audio">No raw audio retention</option>
          </select>
        </label>

        <div className="space-y-2 text-sm font-medium text-foreground sm:col-span-2">
          <span>Reason (optional)</span>
          <Input
            aria-label="Bulk update reason"
            value={bulkForm.reason}
            onChange={(event) => onBulkFormChange({ reason: event.target.value })}
            placeholder="Pilot cleanup, counselor request, notice reconciliation..."
          />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          onClick={onSave}
          loading={saving}
          disabled={selectedCount === 0 || !hasBulkChanges}
        >
          Apply to selected students
        </Button>
        <p className="text-sm text-muted-foreground">
          Bulk updates are limited to active students in this class and create audit events per student.
        </p>
      </div>
    </Card>
  );
}

type ComplianceRosterCardProps = {
  roster: ClassComplianceRosterData;
  classId: string | undefined;
  selectedStudentUids: Set<string>;
  allSelected: boolean;
  onToggleAllStudents: () => void;
  onToggleStudent: (studentUid: string) => void;
  onOpenStudent: (studentUid: string) => void;
};

function ComplianceRosterCard({
  roster,
  classId,
  selectedStudentUids,
  allSelected,
  onToggleAllStudents,
  onToggleStudent,
  onOpenStudent,
}: ComplianceRosterCardProps) {
  return (
    <Card className="border-3 border-foreground p-6 shadow-stamp">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">Class compliance roster</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review who is voice-eligible, who needs guardian action, and who is under restricted retention.
          </p>
        </div>
        <label className="flex items-center gap-3 rounded-2xl border-2 border-border bg-secondary/40 px-4 py-3 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onToggleAllStudents}
            className="size-4 rounded border-border"
          />
          Select all
        </label>
      </div>

      <div className="mt-6 space-y-3">
        {roster.students.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
            No active students are enrolled in this class.
          </div>
        ) : (
          roster.students.map((student) => (
            <div key={student.uid} className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex gap-3">
                  <input
                    type="checkbox"
                    aria-label={`Select ${student.displayName}`}
                    checked={selectedStudentUids.has(student.uid)}
                    onChange={() => onToggleStudent(student.uid)}
                    className="mt-1 size-4 rounded border-border"
                  />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{student.displayName}</p>
                      {student.studentNumber ? (
                        <Badge variant="secondary" size="sm">
                          {student.studentNumber}
                        </Badge>
                      ) : null}
                      {student.guardianContactRequired ? (
                        <Badge variant="outline" size="sm">
                          Guardian contact required
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant={student.compliance.voiceAllowed ? 'success' : 'outline'} size="sm">
                        Voice {student.compliance.voiceAllowed ? 'allowed' : 'blocked'}
                      </Badge>
                      <Badge variant={student.compliance.textAllowed ? 'accent' : 'outline'} size="sm">
                        Text {student.compliance.textAllowed ? 'allowed' : 'blocked'}
                      </Badge>
                      <Badge variant="secondary" size="sm">
                        Voice {student.compliance.voiceConsentStatus}
                      </Badge>
                      <Badge variant="outline" size="sm">
                        {student.compliance.retentionPolicy.label}
                      </Badge>
                      <Badge variant={student.guardianPacket ? 'outline' : 'secondary'} size="sm">
                        Packet {student.guardianPacket?.status || 'none'}
                      </Badge>
                      {student.guardianPacket?.expiresAt ? (
                        <Badge variant="secondary" size="sm">
                          expires {formatGuardianPacketTimestamp(student.guardianPacket.expiresAt)}
                        </Badge>
                      ) : null}
                    </div>
                    {student.blockedReasons.length > 0 ? (
                      <p className="mt-3 text-sm text-muted-foreground">
                        {student.blockedReasons.join(' ')}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenStudent(student.uid)}
                    disabled={!classId}
                  >
                    Open detail
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function formatGuardianPacketTimestamp(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function buildBulkUpdates(form: typeof DEFAULT_BULK_FORM): UpdateStudentCompliancePayload {
  const updates: UpdateStudentCompliancePayload = {};
  if (form.voiceConsentStatus !== 'unchanged') {
    updates.voiceConsentStatus = form.voiceConsentStatus;
  }
  if (form.textAllowed === 'allowed') {
    updates.textAllowed = true;
  } else if (form.textAllowed === 'blocked') {
    updates.textAllowed = false;
  }
  if (form.retentionPolicyId !== 'unchanged') {
    updates.retentionPolicyId = form.retentionPolicyId;
  }
  return updates;
}

export function TeacherClassCompliancePage() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(classComplianceReducer, initialClassComplianceState);
  const {
    loading,
    saving,
    exporting,
    error,
    bulkError,
    statusMessage,
    roster,
    selectedStudentUids,
    bulkForm,
  } = state;

  const reloadRoster = async () => {
    if (!classId) {
      return;
    }
    try {
      const data = await getClassComplianceRoster(classId);
      dispatch({ type: 'load-success', roster: data });
    } catch {
      // Keep the current screen state when a background refresh fails.
    }
  };

  useEffect(() => {
    let isActive = true;

    if (!classId) {
      dispatch({ type: 'invalid-class' });
      return;
    }

    const load = async () => {
      dispatch({ type: 'load-start' });
      try {
        const data = await getClassComplianceRoster(classId);
        if (!isActive) return;
        dispatch({ type: 'load-success', roster: data });
      } catch (err) {
        if (!isActive) return;
        dispatch({
          type: 'load-error',
          error: err instanceof Error ? err.message : 'Failed to load class compliance.',
        });
      }
    };

    void load();
    return () => {
      isActive = false;
    };
  }, [classId]);

  const selectedCount = selectedStudentUids.size;
  const bulkUpdates = buildBulkUpdates(bulkForm);
  const hasBulkChanges = Object.keys(bulkUpdates).length > 0;
  const allSelected = Boolean(roster && roster.students.length > 0 && selectedCount === roster.students.length);

  const toggleStudent = (studentUid: string) => {
    dispatch({ type: 'toggle-student', studentUid });
  };

  const toggleAllStudents = () => {
    if (!roster) return;
    dispatch({
      type: 'toggle-all-students',
      allSelected,
      studentUids: roster.students.map((student) => student.uid),
    });
  };

  const handleBulkSave = async () => {
    if (!classId || !hasBulkChanges || selectedCount === 0) return;
    dispatch({ type: 'save-start' });
    try {
      const result = await bulkUpdateClassCompliance(classId, {
        studentUids: Array.from(selectedStudentUids),
        updates: bulkUpdates,
        reason: bulkForm.reason.trim() || undefined,
      });
      dispatch({ type: 'save-success', message: `Updated ${result.updatedCount} student records.` });
      await reloadRoster();
    } catch (err) {
      dispatch({
        type: 'save-error',
        error: err instanceof Error ? err.message : 'Failed to update selected students.',
      });
    }
  };

  const handleExport = async () => {
    if (!classId) return;
    dispatch({ type: 'export-start' });
    try {
      await downloadClassComplianceAuditExport(classId);
      dispatch({ type: 'export-success', message: 'Audit export downloaded.' });
    } catch (err) {
      dispatch({
        type: 'export-error',
        error: err instanceof Error ? err.message : 'Failed to export audit log.',
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

  if (!roster) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{error || 'Class compliance is unavailable.'}</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => navigate('/app/teacher')}>
          Back to dashboard
        </Button>
      </div>
    );
  }

  const stats = [
    { label: 'Students', value: roster.summary.studentCount, icon: Users, accent: 'bg-primary/10 text-primary' },
    { label: 'Voice allowed', value: roster.summary.voiceAllowedCount, icon: ShieldCheck, accent: 'bg-success/15 text-success' },
    { label: 'Voice blocked', value: roster.summary.voiceBlockedCount, icon: AlertTriangle, accent: 'bg-destructive/10 text-destructive' },
    { label: 'Guardian action', value: roster.summary.guardianActionRequiredCount, icon: UserCheck, accent: 'bg-accent/20 text-accent-foreground' },
    { label: 'Unknown consent', value: roster.summary.unknownConsentCount, icon: FileCheck2, accent: 'bg-secondary text-foreground' },
    { label: 'No raw audio', value: roster.summary.rawAudioRestrictedCount, icon: Download, accent: 'bg-primary/5 text-foreground' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Button
            variant="outline"
            size="sm"
            className="mb-4"
            onClick={() => navigate(`/app/teacher/classes/${classId}/analytics`)}
          >
            <ArrowLeft size={16} className="mr-2" />
            Back to class analytics
          </Button>
          <h1 className="text-3xl font-display font-bold text-foreground">{roster.class.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Class-scoped consent operations and audit export for beta pilot support.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => void handleExport()} loading={exporting}>
            <Download size={16} className="mr-2" />
            Export audit CSV
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {roster.limitations.map((message) => (
        <Alert key={message}>
          <AlertTriangle className="size-4" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ))}

      {bulkError ? (
        <Alert variant="destructive">
          <AlertDescription>{bulkError}</AlertDescription>
        </Alert>
      ) : null}

      {statusMessage ? (
        <Alert>
          <ShieldCheck className="size-4" />
          <AlertDescription>{statusMessage}</AlertDescription>
        </Alert>
      ) : null}

      <ComplianceStatsGrid stats={stats} />

      {roster && (
        <OnboardingHint
          show={roster.summary.unknownConsentCount > 0 || roster.summary.guardianActionRequiredCount > 0}
          message="Review consent status for students before enabling voice practice."
        />
      )}

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <BulkConsentUpdatesCard
          selectedCount={selectedCount}
          bulkForm={bulkForm}
          saving={saving}
          hasBulkChanges={hasBulkChanges}
          onBulkFormChange={(patch) => dispatch({ type: 'patch-bulk-form', patch })}
          onSave={() => void handleBulkSave()}
        />
        <ComplianceRosterCard
          roster={roster}
          classId={classId}
          selectedStudentUids={selectedStudentUids}
          allSelected={allSelected}
          onToggleAllStudents={toggleAllStudents}
          onToggleStudent={toggleStudent}
          onOpenStudent={(studentUid) => navigate(`/app/teacher/classes/${classId}/students/${studentUid}/analytics`)}
        />
      </div>
    </div>
  );
}
