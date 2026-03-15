import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  Eye,
  EyeOff,
  FileCheck2,
  Loader2,
  Mail,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  bulkUpdateOrgCompliance,
  exportOrgComplianceAudit,
  getOrgComplianceRoster,
  getOrgGuardianPackets,
} from '@/api/admin';
import { Alert, AlertDescription, Badge, Button, Card, Input } from '@/components/ui';
import type {
  ConsentStatus,
  OrgComplianceRosterData,
  OrgComplianceSummary,
  OrgGuardianPacketsData,
  UpdateStudentCompliancePayload,
} from '@/types';
import { useMembership } from '@/contexts/MembershipContext';

type TabId = 'overview' | 'roster' | 'packets';

const CONSENT_FILTER_OPTIONS = [
  { value: '', label: 'All students' },
  { value: 'voice_allowed', label: 'Voice allowed' },
  { value: 'voice_blocked', label: 'Voice blocked' },
  { value: 'guardian_action_required', label: 'Guardian action required' },
  { value: 'unknown_consent', label: 'Unknown consent' },
];

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

function buildBulkUpdates(form: typeof DEFAULT_BULK_FORM): UpdateStudentCompliancePayload {
  const updates: UpdateStudentCompliancePayload = {};
  if (form.isMinor === 'minor') updates.isMinor = true;
  else if (form.isMinor === 'adult') updates.isMinor = false;
  if (form.guardianConsentStatus !== 'unchanged')
    updates.guardianConsentStatus = form.guardianConsentStatus;
  if (form.voiceConsentStatus !== 'unchanged')
    updates.voiceConsentStatus = form.voiceConsentStatus;
  if (form.textAllowed === 'allowed') updates.textAllowed = true;
  else if (form.textAllowed === 'blocked') updates.textAllowed = false;
  if (form.retentionPolicyId !== 'unchanged')
    updates.retentionPolicyId = form.retentionPolicyId;
  return updates;
}

const PACKET_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'bg-gray-100 text-gray-800' },
  issued: { label: 'Issued', color: 'bg-blue-100 text-blue-800' },
  viewed: { label: 'Viewed', color: 'bg-indigo-100 text-indigo-800' },
  granted: { label: 'Granted', color: 'bg-green-100 text-green-800' },
  revoked: { label: 'Revoked', color: 'bg-red-100 text-red-800' },
  expired: { label: 'Expired', color: 'bg-amber-100 text-amber-800' },
  canceled: { label: 'Canceled', color: 'bg-gray-100 text-gray-600' },
};

function formatTimestamp(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function MetricCard({
  label,
  value,
  icon: Icon,
  color = 'text-gray-700',
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <Icon className={`h-5 w-5 ${color}`} />
        <div>
          <p className="text-2xl font-semibold">{value}</p>
          <p className="text-sm text-gray-500">{label}</p>
        </div>
      </div>
    </Card>
  );
}

function SummarySection({ summary }: { summary: OrgComplianceSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <MetricCard label="Total students" value={summary.studentCount} icon={Users} />
      <MetricCard
        label="Voice allowed"
        value={summary.voiceAllowedCount}
        icon={Eye}
        color="text-green-600"
      />
      <MetricCard
        label="Voice blocked"
        value={summary.voiceBlockedCount}
        icon={EyeOff}
        color="text-red-600"
      />
      <MetricCard
        label="Guardian action needed"
        value={summary.guardianActionRequiredCount}
        icon={AlertTriangle}
        color="text-amber-600"
      />
    </div>
  );
}

function RosterSection({
  roster,
  onReload,
}: {
  roster: OrgComplianceRosterData;
  onReload: (params?: { consentStatus?: string; search?: string; classId?: string }) => void;
}) {
  const [consentFilter, setConsentFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set());
  const [bulkForm, setBulkForm] = useState(DEFAULT_BULK_FORM);
  const [saving, setSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSuccess, setBulkSuccess] = useState<string | null>(null);

  const bulkUpdates = buildBulkUpdates(bulkForm);
  const hasBulkChanges = Object.keys(bulkUpdates).length > 0;
  const allSelected =
    roster.students.length > 0 && selectedUids.size === roster.students.length;

  const toggleStudent = (uid: string) => {
    setSelectedUids((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelectedUids(new Set());
    else setSelectedUids(new Set(roster.students.map((s) => s.uid)));
  };

  const handleBulkSave = async () => {
    if (!hasBulkChanges || selectedUids.size === 0) return;
    setSaving(true);
    setBulkError(null);
    setBulkSuccess(null);
    try {
      const result = await bulkUpdateOrgCompliance({
        studentUids: Array.from(selectedUids),
        updates: bulkUpdates,
        reason: bulkForm.reason.trim() || undefined,
      });
      setBulkSuccess(`Updated ${result.updatedCount} student records.`);
      setSelectedUids(new Set());
      setBulkForm(DEFAULT_BULK_FORM);
      onReload();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Failed to update.');
    } finally {
      setSaving(false);
    }
  };

  // Derive unique class list from roster students
  const classOptions = Array.from(
    new Map(
      roster.students.flatMap((s) =>
        s.classIds.map((id, i) => [id, s.classNames[i] || id] as [string, string]),
      ),
    ),
  );

  const applyFilters = useCallback(() => {
    onReload({
      consentStatus: consentFilter || undefined,
      search: searchQuery || undefined,
      classId: classFilter || undefined,
    });
  }, [consentFilter, searchQuery, classFilter, onReload]);

  useEffect(() => {
    applyFilters();
  }, [consentFilter, classFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectStyle = 'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm';

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search by name or UID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            className="pl-10"
          />
        </div>
        <select
          value={consentFilter}
          onChange={(e) => setConsentFilter(e.target.value)}
          className={selectStyle}
        >
          {CONSENT_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {classOptions.length > 1 && (
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className={selectStyle}
          >
            <option value="">All classes</option>
            {classOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Bulk update panel */}
      {selectedUids.size > 0 && (
        <Card className="border-blue-200 bg-blue-50/50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-800">
              Bulk update — {selectedUids.size} student{selectedUids.size !== 1 ? 's' : ''} selected
            </h3>
            <button
              onClick={() => setSelectedUids(new Set())}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Clear selection
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1 text-xs font-medium text-gray-600">
              <span>Student status</span>
              <select
                value={bulkForm.isMinor}
                onChange={(e) =>
                  setBulkForm((f) => ({ ...f, isMinor: e.target.value as BulkMinorValue }))
                }
                className={selectStyle + ' w-full'}
              >
                <option value="unchanged">Leave unchanged</option>
                <option value="minor">Set to minor</option>
                <option value="adult">Set to adult</option>
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium text-gray-600">
              <span>Guardian consent</span>
              <select
                value={bulkForm.guardianConsentStatus}
                onChange={(e) =>
                  setBulkForm((f) => ({
                    ...f,
                    guardianConsentStatus: e.target.value as BulkConsentValue,
                  }))
                }
                className={selectStyle + ' w-full'}
              >
                <option value="unchanged">Leave unchanged</option>
                <option value="unknown">Unknown</option>
                <option value="granted">Granted</option>
                <option value="revoked">Revoked</option>
                <option value="not_required">Not required</option>
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium text-gray-600">
              <span>Voice consent</span>
              <select
                value={bulkForm.voiceConsentStatus}
                onChange={(e) =>
                  setBulkForm((f) => ({
                    ...f,
                    voiceConsentStatus: e.target.value as BulkConsentValue,
                  }))
                }
                className={selectStyle + ' w-full'}
              >
                <option value="unchanged">Leave unchanged</option>
                <option value="unknown">Unknown</option>
                <option value="granted">Granted</option>
                <option value="revoked">Revoked</option>
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium text-gray-600">
              <span>Text launch</span>
              <select
                value={bulkForm.textAllowed}
                onChange={(e) =>
                  setBulkForm((f) => ({
                    ...f,
                    textAllowed: e.target.value as BulkTextAllowedValue,
                  }))
                }
                className={selectStyle + ' w-full'}
              >
                <option value="unchanged">Leave unchanged</option>
                <option value="allowed">Allow text</option>
                <option value="blocked">Block text</option>
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium text-gray-600">
              <span>Retention policy</span>
              <select
                value={bulkForm.retentionPolicyId}
                onChange={(e) =>
                  setBulkForm((f) => ({
                    ...f,
                    retentionPolicyId: e.target.value as BulkRetentionValue,
                  }))
                }
                className={selectStyle + ' w-full'}
              >
                <option value="unchanged">Leave unchanged</option>
                <option value="standard_school">Standard school retention</option>
                <option value="no_raw_audio">No raw audio retention</option>
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium text-gray-600">
              <span>Reason (optional)</span>
              <Input
                value={bulkForm.reason}
                onChange={(e) => setBulkForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="e.g. pilot cleanup"
                className="text-sm"
              />
            </label>
          </div>
          {bulkError && (
            <p className="mt-2 text-xs text-red-600">{bulkError}</p>
          )}
          {bulkSuccess && (
            <p className="mt-2 text-xs text-green-700">{bulkSuccess}</p>
          )}
          <div className="mt-3 flex items-center gap-3">
            <Button
              size="sm"
              onClick={() => void handleBulkSave()}
              disabled={!hasBulkChanges || saving}
            >
              {saving ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
              Apply to {selectedUids.size} student{selectedUids.size !== 1 ? 's' : ''}
            </Button>
            <p className="text-xs text-gray-500">
              Creates audit events per student with scope &quot;org&quot;.
            </p>
          </div>
        </Card>
      )}

      {/* Results count + select all */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{roster.students.length} students</p>
        {roster.students.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-4 w-4 rounded border-gray-300"
            />
            Select all
          </label>
        )}
      </div>

      {/* Student list */}
      {roster.students.length === 0 ? (
        <Card className="p-8 text-center text-gray-500">
          No students match the current filters.
        </Card>
      ) : (
        <div className="space-y-2">
          {roster.students.map((student) => (
            <Card
              key={student.uid}
              className={`p-4 transition ${
                selectedUids.has(student.uid) ? 'ring-2 ring-blue-300 bg-blue-50/30' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  title={`Select ${student.displayName}`}
                  checked={selectedUids.has(student.uid)}
                  onChange={() => toggleStudent(student.uid)}
                  className="mt-1 h-4 w-4 rounded border-gray-300"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{student.displayName}</p>
                      <p className="text-xs text-gray-400 truncate">{student.uid}</p>
                      {student.classNames.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {student.classNames.map((name, i) => (
                            <Badge
                              key={student.classIds[i]}
                              className="bg-gray-100 text-gray-700 text-xs"
                            >
                              {name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-right">
                      {student.compliance.voiceAllowed ? (
                        <Badge className="bg-green-100 text-green-800">Voice OK</Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-800">Voice Blocked</Badge>
                      )}
                      {student.compliance.isMinor && (
                        <Badge className="bg-purple-100 text-purple-800">Minor</Badge>
                      )}
                      {student.compliance.guardianConsentStatus === 'unknown' &&
                        student.compliance.isMinor && (
                          <Badge className="bg-amber-100 text-amber-800">Guardian Needed</Badge>
                        )}
                    </div>
                  </div>
                  {student.blockedReasons.length > 0 && (
                    <div className="mt-2 text-xs text-red-600">
                      {student.blockedReasons.map((reason, i) => (
                        <p key={i}>{reason}</p>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500 sm:grid-cols-4">
                    <span>
                      Guardian: <strong>{student.compliance.guardianConsentStatus}</strong>
                    </span>
                    <span>
                      Voice: <strong>{student.compliance.voiceConsentStatus}</strong>
                    </span>
                    <span>
                      Text:{' '}
                      <strong>{student.compliance.textAllowed ? 'allowed' : 'blocked'}</strong>
                    </span>
                    <span>
                      Retention: <strong>{student.compliance.retentionPolicyId}</strong>
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function GuardianPacketsSection({
  packetsData,
  onFilterChange,
}: {
  packetsData: OrgGuardianPacketsData;
  onFilterChange: (status?: string) => void;
}) {
  const [statusFilter, setStatusFilter] = useState('');

  return (
    <div className="space-y-4">
      {/* Status summary bar */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => {
            setStatusFilter('');
            onFilterChange(undefined);
          }}
          className={`rounded-full px-3 py-1 text-sm transition ${
            !statusFilter ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          All ({packetsData.totalCount})
        </button>
        {Object.entries(packetsData.statusCounts).map(([status, count]) => {
          const config = PACKET_STATUS_LABELS[status] || {
            label: status,
            color: 'bg-gray-100 text-gray-800',
          };
          return (
            <button
              key={status}
              onClick={() => {
                setStatusFilter(status);
                onFilterChange(status);
              }}
              className={`rounded-full px-3 py-1 text-sm transition ${
                statusFilter === status
                  ? 'bg-gray-800 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {config.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Packet list */}
      {packetsData.packets.length === 0 ? (
        <Card className="p-8 text-center text-gray-500">
          No guardian consent packets found.
        </Card>
      ) : (
        <div className="space-y-2">
          {packetsData.packets.map((packet) => {
            const statusConfig = PACKET_STATUS_LABELS[packet.status] || {
              label: packet.status,
              color: 'bg-gray-100 text-gray-800',
            };
            return (
              <Card key={packet.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-gray-400" />
                      <span className="text-sm font-medium">
                        {packet.contactChannel}: {packet.contactDestinationHint || '—'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      Student: {packet.studentUid} · Class: {packet.classId}
                    </p>
                    <p className="text-xs text-gray-400">
                      Delivery: {packet.deliveryMethod} · Notice v{packet.noticeVersion}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge className={statusConfig.color}>{statusConfig.label}</Badge>
                    {packet.reminderCount > 0 && (
                      <p className="mt-1 text-xs text-gray-500">
                        {packet.reminderCount} reminder{packet.reminderCount !== 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex gap-4 text-xs text-gray-500">
                  <span>Issued: {formatTimestamp(packet.issuedAt)}</span>
                  {packet.expiresAt && <span>Expires: {formatTimestamp(packet.expiresAt)}</span>}
                  {packet.actedAt && <span>Responded: {formatTimestamp(packet.actedAt)}</span>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AdminCompliancePage() {
  const navigate = useNavigate();
  const { activeMembership } = useMembership();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roster, setRoster] = useState<OrgComplianceRosterData | null>(null);
  const [packetsData, setPacketsData] = useState<OrgGuardianPacketsData | null>(null);

  const loadRoster = useCallback(
    async (params?: { consentStatus?: string; search?: string; classId?: string }) => {
      try {
        const data = await getOrgComplianceRoster(params);
        setRoster(data);
      } catch (err) {
        console.error('Failed to load compliance roster:', err);
        setError('Failed to load compliance data.');
      }
    },
    [],
  );

  const loadPackets = useCallback(async (statusFilter?: string) => {
    try {
      const data = await getOrgGuardianPackets(statusFilter);
      setPacketsData(data);
    } catch (err) {
      console.error('Failed to load guardian packets:', err);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadRoster(), loadPackets()]);
      setLoading(false);
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExportAudit = async () => {
    setExporting(true);
    try {
      const blob = await exportOrgComplianceAudit();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `org_compliance_audit_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export audit:', err);
      setError('Failed to export audit data.');
    } finally {
      setExporting(false);
    }
  };

  const isAdmin = activeMembership?.roles?.includes('school_admin');

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <Alert>
          <AlertDescription>
            You must be a school administrator to access this page.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: 'Overview', icon: ShieldCheck },
    { id: 'roster', label: 'Student Roster', icon: Users },
    { id: 'packets', label: 'Guardian Packets', icon: Mail },
  ];

  return (
    <div className="mx-auto max-w-5xl p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/app/teacher')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">School Compliance</h1>
            <p className="text-sm text-gray-500">
              Organization-wide consent, privacy, and guardian packet management
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportAudit} disabled={exporting}>
            {exporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Export Audit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/app/admin/deletion-requests')}
          >
            <FileCheck2 className="mr-2 h-4 w-4" />
            Deletion Requests
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-lg bg-gray-100 p-1">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition ${
              activeTab === id
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {error && (
        <Alert className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {activeTab === 'overview' && roster && (
            <div className="space-y-6">
              <SummarySection summary={roster.summary} />

              {/* Quick insights */}
              <Card className="p-4">
                <h3 className="mb-3 text-sm font-medium text-gray-700">Quick insights</h3>
                <div className="space-y-2 text-sm">
                  {roster.summary.guardianActionRequiredCount > 0 && (
                    <div className="flex items-center gap-2 text-amber-700">
                      <AlertTriangle className="h-4 w-4" />
                      <span>
                        {roster.summary.guardianActionRequiredCount} student
                        {roster.summary.guardianActionRequiredCount !== 1 ? 's' : ''} need guardian
                        consent before using voice features.
                      </span>
                    </div>
                  )}
                  {roster.summary.unknownConsentCount > 0 && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <AlertTriangle className="h-4 w-4" />
                      <span>
                        {roster.summary.unknownConsentCount} student
                        {roster.summary.unknownConsentCount !== 1 ? 's have' : ' has'} unknown
                        consent status — review recommended.
                      </span>
                    </div>
                  )}
                  {roster.summary.rawAudioRestrictedCount > 0 && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <ShieldCheck className="h-4 w-4" />
                      <span>
                        {roster.summary.rawAudioRestrictedCount} student
                        {roster.summary.rawAudioRestrictedCount !== 1 ? 's have' : ' has'} raw audio
                        storage restricted.
                      </span>
                    </div>
                  )}
                  {roster.summary.studentCount > 0 &&
                    roster.summary.guardianActionRequiredCount === 0 &&
                    roster.summary.unknownConsentCount === 0 && (
                      <div className="flex items-center gap-2 text-green-700">
                        <ShieldCheck className="h-4 w-4" />
                        <span>
                          All students have resolved consent status. No action required.
                        </span>
                      </div>
                    )}
                  {roster.summary.studentCount === 0 && (
                    <p className="text-gray-500">
                      No student compliance records found. Records are created when students are
                      enrolled and consent settings are configured.
                    </p>
                  )}
                </div>
              </Card>

              {/* Packet summary if loaded */}
              {packetsData && packetsData.totalCount > 0 && (
                <Card className="p-4">
                  <h3 className="mb-3 text-sm font-medium text-gray-700">
                    Guardian packets overview
                  </h3>
                  <div className="flex flex-wrap gap-3">
                    {Object.entries(packetsData.statusCounts).map(([status, count]) => {
                      const config = PACKET_STATUS_LABELS[status] || {
                        label: status,
                        color: 'bg-gray-100 text-gray-800',
                      };
                      return (
                        <div key={status} className="flex items-center gap-2">
                          <Badge className={config.color}>{config.label}</Badge>
                          <span className="text-sm font-medium">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}
            </div>
          )}

          {activeTab === 'roster' && roster && (
            <RosterSection roster={roster} onReload={loadRoster} />
          )}

          {activeTab === 'packets' && packetsData && (
            <GuardianPacketsSection packetsData={packetsData} onFilterChange={loadPackets} />
          )}
        </>
      )}
    </div>
  );
}
