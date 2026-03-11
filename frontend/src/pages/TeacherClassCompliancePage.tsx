import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  FileCheck2,
  Loader2,
  ShieldCheck,
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

type BulkMinorValue = 'unchanged' | 'minor' | 'adult';
type BulkConsentValue = 'unchanged' | ConsentStatus;
type BulkTextAllowedValue = 'unchanged' | 'allowed' | 'blocked';
type BulkRetentionValue = 'unchanged' | 'standard_school' | 'no_raw_audio';

const DEFAULT_BULK_FORM = {
  isMinor: 'unchanged' as BulkMinorValue,
  guardianConsentStatus: 'unchanged' as BulkConsentValue,
  voiceConsentStatus: 'unchanged' as BulkConsentValue,
  textAllowed: 'unchanged' as BulkTextAllowedValue,
  retentionPolicyId: 'unchanged' as BulkRetentionValue,
  reason: '',
};

function formatGuardianPacketTimestamp(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function buildBulkUpdates(form: typeof DEFAULT_BULK_FORM): UpdateStudentCompliancePayload {
  const updates: UpdateStudentCompliancePayload = {};
  if (form.isMinor === 'minor') {
    updates.isMinor = true;
  } else if (form.isMinor === 'adult') {
    updates.isMinor = false;
  }
  if (form.guardianConsentStatus !== 'unchanged') {
    updates.guardianConsentStatus = form.guardianConsentStatus;
  }
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [roster, setRoster] = useState<ClassComplianceRosterData | null>(null);
  const [selectedStudentUids, setSelectedStudentUids] = useState<Set<string>>(new Set());
  const [bulkForm, setBulkForm] = useState(DEFAULT_BULK_FORM);

  const reloadRoster = async () => {
    if (!classId) {
      return;
    }
    try {
      const data = await getClassComplianceRoster(classId);
      setRoster(data);
      setError(null);
    } catch {
      // Keep the current screen state when a background refresh fails.
    }
  };

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
        const data = await getClassComplianceRoster(classId);
        if (!isActive) return;
        setRoster(data);
        setError(null);
      } catch (err) {
        if (!isActive) return;
        setError(err instanceof Error ? err.message : 'Failed to load class compliance.');
      } finally {
        if (isActive) setLoading(false);
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
    setSelectedStudentUids((current) => {
      const next = new Set(current);
      if (next.has(studentUid)) {
        next.delete(studentUid);
      } else {
        next.add(studentUid);
      }
      return next;
    });
  };

  const toggleAllStudents = () => {
    if (!roster) return;
    if (allSelected) {
      setSelectedStudentUids(new Set());
      return;
    }
    setSelectedStudentUids(new Set(roster.students.map((student) => student.uid)));
  };

  const handleBulkSave = async () => {
    if (!classId || !hasBulkChanges || selectedCount === 0) return;
    setSaving(true);
    setBulkError(null);
    setStatusMessage(null);
    try {
      const result = await bulkUpdateClassCompliance(classId, {
        studentUids: Array.from(selectedStudentUids),
        updates: bulkUpdates,
        reason: bulkForm.reason.trim() || undefined,
      });
      setStatusMessage(`Updated ${result.updatedCount} student records.`);
      setSelectedStudentUids(new Set());
      setBulkForm(DEFAULT_BULK_FORM);
      await reloadRoster();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Failed to update selected students.');
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    if (!classId) return;
    setExporting(true);
    setBulkError(null);
    setStatusMessage(null);
    try {
      await downloadClassComplianceAuditExport(classId);
      setStatusMessage('Audit export downloaded.');
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Failed to export audit log.');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
          <AlertTriangle className="h-4 w-4" />
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
          <ShieldCheck className="h-4 w-4" />
          <AlertDescription>{statusMessage}</AlertDescription>
        </Alert>
      ) : null}

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

      {roster && (
        <OnboardingHint
          show={roster.summary.unknownConsentCount > 0 || roster.summary.guardianActionRequiredCount > 0}
          message="Review consent status for students before enabling voice practice."
        />
      )}

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
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
              <span>Student status</span>
              <select
                value={bulkForm.isMinor}
                onChange={(event) => setBulkForm((current) => ({ ...current, isMinor: event.target.value as BulkMinorValue }))}
                className="w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none"
              >
                <option value="unchanged">Leave unchanged</option>
                <option value="minor">Set to minor</option>
                <option value="adult">Set to adult</option>
              </select>
            </label>

            <label className="space-y-2 text-sm font-medium text-foreground">
              <span>Guardian consent</span>
              <select
                value={bulkForm.guardianConsentStatus}
                onChange={(event) => setBulkForm((current) => ({ ...current, guardianConsentStatus: event.target.value as BulkConsentValue }))}
                className="w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none"
              >
                <option value="unchanged">Leave unchanged</option>
                <option value="unknown">Unknown</option>
                <option value="granted">Granted</option>
                <option value="revoked">Revoked</option>
                <option value="not_required">Not required</option>
              </select>
            </label>

            <label className="space-y-2 text-sm font-medium text-foreground">
              <span>Voice consent</span>
              <select
                value={bulkForm.voiceConsentStatus}
                onChange={(event) => setBulkForm((current) => ({ ...current, voiceConsentStatus: event.target.value as BulkConsentValue }))}
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
                onChange={(event) => setBulkForm((current) => ({ ...current, textAllowed: event.target.value as BulkTextAllowedValue }))}
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
                onChange={(event) => setBulkForm((current) => ({ ...current, retentionPolicyId: event.target.value as BulkRetentionValue }))}
                className="w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-sm text-foreground focus:border-foreground focus:outline-none"
              >
                <option value="unchanged">Leave unchanged</option>
                <option value="standard_school">Standard school retention</option>
                <option value="no_raw_audio">No raw audio retention</option>
              </select>
            </label>

            <label className="space-y-2 text-sm font-medium text-foreground sm:col-span-2">
              <span>Reason (optional)</span>
              <Input
                value={bulkForm.reason}
                onChange={(event) => setBulkForm((current) => ({ ...current, reason: event.target.value }))}
                placeholder="Pilot cleanup, counselor request, notice reconciliation..."
              />
            </label>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void handleBulkSave()}
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
                onChange={toggleAllStudents}
                className="h-4 w-4 rounded border-border"
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
                        checked={selectedStudentUids.has(student.uid)}
                        onChange={() => toggleStudent(student.uid)}
                        className="mt-1 h-4 w-4 rounded border-border"
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
                            Guardian {student.compliance.guardianConsentStatus}
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
                        onClick={() => navigate(`/app/teacher/classes/${classId}/students/${student.uid}/analytics`)}
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
      </div>
    </div>
  );
}
