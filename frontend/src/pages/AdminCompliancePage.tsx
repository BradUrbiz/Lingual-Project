import { useCallback, useEffect, useReducer, useState } from 'react';
import type { ElementType } from 'react';
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
type ComplianceFilterParams = { consentStatus?: string; search?: string; classId?: string };

const ADMIN_COMPLIANCE_TABS: { id: TabId; label: string; icon: ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: ShieldCheck },
  { id: 'roster', label: 'Student Roster', icon: Users },
  { id: 'packets', label: 'Guardian Packets', icon: Mail },
];

const CONSENT_FILTER_OPTIONS = [
  { value: '', label: 'All students' },
  { value: 'voice_allowed', label: 'Voice allowed' },
  { value: 'voice_blocked', label: 'Voice blocked' },
  { value: 'guardian_action_required', label: 'Guardian action required' },
  { value: 'unknown_consent', label: 'Unknown consent' },
];

type BulkConsentValue = 'unchanged' | ConsentStatus;
type BulkTextAllowedValue = 'unchanged' | 'allowed' | 'blocked';
type BulkRetentionValue = 'unchanged' | 'standard_school' | 'no_raw_audio';

type BulkFormState = {
  voiceConsentStatus: BulkConsentValue;
  textAllowed: BulkTextAllowedValue;
  retentionPolicyId: BulkRetentionValue;
  reason: string;
};

const DEFAULT_BULK_FORM: BulkFormState = {
  voiceConsentStatus: 'unchanged',
  textAllowed: 'unchanged',
  retentionPolicyId: 'unchanged',
  reason: '',
};

const SELECT_STYLE = 'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm';

function buildBulkUpdates(form: BulkFormState): UpdateStudentCompliancePayload {
  const updates: UpdateStudentCompliancePayload = {};
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
  if (!value) return '-';
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
  icon: ElementType;
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

type RosterState = {
  consentFilter: string;
  searchQuery: string;
  classFilter: string;
  selectedUids: Set<string>;
  bulkForm: BulkFormState;
  saving: boolean;
  bulkError: string | null;
  bulkSuccess: string | null;
};

type RosterAction =
  | { type: 'filter:consentChanged'; value: string }
  | { type: 'filter:searchChanged'; value: string }
  | { type: 'filter:classChanged'; value: string }
  | { type: 'selection:studentToggled'; uid: string }
  | { type: 'selection:allToggled'; studentUids: string[] }
  | { type: 'selection:cleared' }
  | { type: 'bulkForm:changed'; patch: Partial<BulkFormState> }
  | { type: 'bulkSave:started' }
  | { type: 'bulkSave:succeeded'; message: string }
  | { type: 'bulkSave:failed'; message: string };

const INITIAL_ROSTER_STATE: RosterState = {
  consentFilter: '',
  searchQuery: '',
  classFilter: '',
  selectedUids: new Set(),
  bulkForm: DEFAULT_BULK_FORM,
  saving: false,
  bulkError: null,
  bulkSuccess: null,
};

function rosterReducer(state: RosterState, action: RosterAction): RosterState {
  switch (action.type) {
    case 'filter:consentChanged':
      return { ...state, consentFilter: action.value };
    case 'filter:searchChanged':
      return { ...state, searchQuery: action.value };
    case 'filter:classChanged':
      return { ...state, classFilter: action.value };
    case 'selection:studentToggled': {
      const selectedUids = new Set(state.selectedUids);
      if (selectedUids.has(action.uid)) selectedUids.delete(action.uid);
      else selectedUids.add(action.uid);
      return { ...state, selectedUids };
    }
    case 'selection:allToggled':
      return {
        ...state,
        selectedUids:
          state.selectedUids.size === action.studentUids.length
            ? new Set()
            : new Set(action.studentUids),
      };
    case 'selection:cleared':
      return { ...state, selectedUids: new Set() };
    case 'bulkForm:changed':
      return { ...state, bulkForm: { ...state.bulkForm, ...action.patch } };
    case 'bulkSave:started':
      return {
        ...state,
        saving: true,
        bulkError: null,
        bulkSuccess: null,
      };
    case 'bulkSave:succeeded':
      return {
        ...state,
        selectedUids: new Set(),
        bulkForm: DEFAULT_BULK_FORM,
        saving: false,
        bulkSuccess: action.message,
      };
    case 'bulkSave:failed':
      return {
        ...state,
        saving: false,
        bulkError: action.message,
      };
    default:
      return state;
  }
}

function RosterSection({
  roster,
  onReload,
}: {
  roster: OrgComplianceRosterData;
  onReload: (params?: ComplianceFilterParams) => void;
}) {
  const [state, dispatch] = useReducer(rosterReducer, INITIAL_ROSTER_STATE);
  const bulkUpdates = buildBulkUpdates(state.bulkForm);
  const hasBulkChanges = Object.keys(bulkUpdates).length > 0;
  const allSelected =
    roster.students.length > 0 && state.selectedUids.size === roster.students.length;
  const classOptions = Array.from(
    new Map(
      roster.students.flatMap((student) =>
        student.classIds.map((id, index) => [id, student.classNames[index] || id] as [string, string]),
      ),
    ),
  );

  const applyFilters = useCallback((overrides: ComplianceFilterParams = {}) => {
    const nextConsentFilter = overrides.consentStatus ?? state.consentFilter;
    const nextSearchQuery = overrides.search ?? state.searchQuery;
    const nextClassFilter = overrides.classId ?? state.classFilter;
    onReload({
      consentStatus: nextConsentFilter || undefined,
      search: nextSearchQuery || undefined,
      classId: nextClassFilter || undefined,
    });
  }, [state.classFilter, state.consentFilter, state.searchQuery, onReload]);

  const handleBulkSave = async () => {
    if (!hasBulkChanges || state.selectedUids.size === 0) return;
    dispatch({ type: 'bulkSave:started' });
    try {
      const result = await bulkUpdateOrgCompliance({
        studentUids: Array.from(state.selectedUids),
        updates: bulkUpdates,
        reason: state.bulkForm.reason.trim() || undefined,
      });
      dispatch({
        type: 'bulkSave:succeeded',
        message: `Updated ${result.updatedCount} student records.`,
      });
      onReload();
    } catch (err) {
      dispatch({
        type: 'bulkSave:failed',
        message: err instanceof Error ? err.message : 'Failed to update.',
      });
    }
  };

  return (
    <div className="space-y-4">
      <RosterFilters
        classFilter={state.classFilter}
        classOptions={classOptions}
        consentFilter={state.consentFilter}
        searchQuery={state.searchQuery}
        onApplyFilters={applyFilters}
        onClassFilterChange={(value) => {
          dispatch({ type: 'filter:classChanged', value });
          applyFilters({ classId: value });
        }}
        onConsentFilterChange={(value) => {
          dispatch({ type: 'filter:consentChanged', value });
          applyFilters({ consentStatus: value });
        }}
        onSearchQueryChange={(value) => dispatch({ type: 'filter:searchChanged', value })}
      />

      {state.selectedUids.size > 0 ? (
        <BulkUpdatePanel
          bulkError={state.bulkError}
          bulkForm={state.bulkForm}
          bulkSuccess={state.bulkSuccess}
          hasBulkChanges={hasBulkChanges}
          saving={state.saving}
          selectedCount={state.selectedUids.size}
          onBulkFormChange={(patch) => dispatch({ type: 'bulkForm:changed', patch })}
          onClearSelection={() => dispatch({ type: 'selection:cleared' })}
          onSave={handleBulkSave}
        />
      ) : null}

      <StudentRosterList
        allSelected={allSelected}
        roster={roster}
        selectedUids={state.selectedUids}
        onToggleAll={() => {
          dispatch({
            type: 'selection:allToggled',
            studentUids: roster.students.map((student) => student.uid),
          });
        }}
        onToggleStudent={(uid) => dispatch({ type: 'selection:studentToggled', uid })}
      />
    </div>
  );
}

type RosterFiltersProps = {
  classFilter: string;
  classOptions: Array<[string, string]>;
  consentFilter: string;
  searchQuery: string;
  onApplyFilters: (overrides?: ComplianceFilterParams) => void;
  onClassFilterChange: (value: string) => void;
  onConsentFilterChange: (value: string) => void;
  onSearchQueryChange: (value: string) => void;
};

function RosterFilters({
  classFilter,
  classOptions,
  consentFilter,
  searchQuery,
  onApplyFilters,
  onClassFilterChange,
  onConsentFilterChange,
  onSearchQueryChange,
}: RosterFiltersProps) {
  return (
    <div className="flex flex-wrap gap-3">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
        <Input
          placeholder="Search by name or UID..."
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && onApplyFilters()}
          className="pl-10"
        />
      </div>
      <select
        aria-label="Filter by consent status"
        value={consentFilter}
        onChange={(event) => onConsentFilterChange(event.target.value)}
        className={SELECT_STYLE}
      >
        {CONSENT_FILTER_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {classOptions.length > 1 ? (
        <select
          aria-label="Filter by class"
          value={classFilter}
          onChange={(event) => onClassFilterChange(event.target.value)}
          className={SELECT_STYLE}
        >
          <option value="">All classes</option>
          {classOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

type BulkUpdatePanelProps = {
  bulkError: string | null;
  bulkForm: BulkFormState;
  bulkSuccess: string | null;
  hasBulkChanges: boolean;
  saving: boolean;
  selectedCount: number;
  onBulkFormChange: (patch: Partial<BulkFormState>) => void;
  onClearSelection: () => void;
  onSave: () => void;
};

function BulkUpdatePanel({
  bulkError,
  bulkForm,
  bulkSuccess,
  hasBulkChanges,
  saving,
  selectedCount,
  onBulkFormChange,
  onClearSelection,
  onSave,
}: BulkUpdatePanelProps) {
  return (
    <Card className="border-blue-200 bg-blue-50/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-800">
          Bulk update - {selectedCount} student{selectedCount !== 1 ? 's' : ''} selected
        </h3>
        <button type="button" onClick={onClearSelection} className="text-xs text-gray-500 hover:text-gray-700">
          Clear selection
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="space-y-1 text-xs font-medium text-gray-600">
          <span>Voice consent</span>
          <select
            value={bulkForm.voiceConsentStatus}
            onChange={(event) => onBulkFormChange({ voiceConsentStatus: event.target.value as BulkConsentValue })}
            className={`${SELECT_STYLE} w-full`}
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
            onChange={(event) => onBulkFormChange({ textAllowed: event.target.value as BulkTextAllowedValue })}
            className={`${SELECT_STYLE} w-full`}
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
            onChange={(event) => onBulkFormChange({ retentionPolicyId: event.target.value as BulkRetentionValue })}
            className={`${SELECT_STYLE} w-full`}
          >
            <option value="unchanged">Leave unchanged</option>
            <option value="standard_school">Standard school retention</option>
            <option value="no_raw_audio">No raw audio retention</option>
          </select>
        </label>
        <div className="space-y-1 text-xs font-medium text-gray-600">
          <span>Reason (optional)</span>
          <Input
            aria-label="Bulk update reason"
            value={bulkForm.reason}
            onChange={(event) => onBulkFormChange({ reason: event.target.value })}
            placeholder="e.g. pilot cleanup"
            className="text-sm"
          />
        </div>
      </div>
      {bulkError ? <p className="mt-2 text-xs text-red-600">{bulkError}</p> : null}
      {bulkSuccess ? <p className="mt-2 text-xs text-green-700">{bulkSuccess}</p> : null}
      <div className="mt-3 flex items-center gap-3">
        <Button
          size="sm"
          onClick={() => void onSave()}
          disabled={!hasBulkChanges || saving}
        >
          {saving ? <Loader2 className="mr-2 size-3 animate-spin" /> : null}
          Apply to {selectedCount} student{selectedCount !== 1 ? 's' : ''}
        </Button>
        <p className="text-xs text-gray-500">
          Creates audit events per student with scope &quot;org&quot;.
        </p>
      </div>
    </Card>
  );
}

type StudentRosterListProps = {
  allSelected: boolean;
  roster: OrgComplianceRosterData;
  selectedUids: Set<string>;
  onToggleAll: () => void;
  onToggleStudent: (uid: string) => void;
};

function StudentRosterList({
  allSelected,
  roster,
  selectedUids,
  onToggleAll,
  onToggleStudent,
}: StudentRosterListProps) {
  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{roster.students.length} students</p>
        {roster.students.length > 0 ? (
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={onToggleAll}
              className="size-4 rounded border-gray-300"
            />
            Select all
          </label>
        ) : null}
      </div>

      {roster.students.length === 0 ? (
        <Card className="p-8 text-center text-gray-500">
          No students match the current filters.
        </Card>
      ) : (
        <div className="space-y-2">
          {roster.students.map((student) => (
            <StudentRosterCard
              key={student.uid}
              selected={selectedUids.has(student.uid)}
              student={student}
              onToggle={() => onToggleStudent(student.uid)}
            />
          ))}
        </div>
      )}
    </>
  );
}

type StudentRosterCardProps = {
  selected: boolean;
  student: OrgComplianceRosterData['students'][number];
  onToggle: () => void;
};

function StudentRosterCard({ selected, student, onToggle }: StudentRosterCardProps) {
  return (
    <Card
      className={`p-4 transition ${
        selected ? 'ring-2 ring-blue-300 bg-blue-50/30' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          aria-label={`Select ${student.displayName}`}
          title={`Select ${student.displayName}`}
          checked={selected}
          onChange={onToggle}
          className="mt-1 size-4 rounded border-gray-300"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{student.displayName}</p>
              <p className="text-xs text-gray-400 truncate">{student.uid}</p>
              {student.classNames.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {student.classNames.map((name, index) => (
                    <Badge
                      key={student.classIds[index]}
                      className="bg-gray-100 text-gray-700 text-xs"
                    >
                      {name}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-right">
              {student.compliance.voiceAllowed ? (
                <Badge className="bg-green-100 text-green-800">Voice OK</Badge>
              ) : (
                <Badge className="bg-red-100 text-red-800">Voice Blocked</Badge>
              )}
            </div>
          </div>
          {student.blockedReasons.length > 0 ? (
            <div className="mt-2 text-xs text-red-600">
              {student.blockedReasons.map((reason) => (
                <p key={reason}>{reason}</p>
              ))}
            </div>
          ) : null}
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500 sm:grid-cols-3">
            <span>
              Voice: <strong>{student.compliance.voiceConsentStatus}</strong>
            </span>
            <span>
              Text: <strong>{student.compliance.textAllowed ? 'allowed' : 'blocked'}</strong>
            </span>
            <span>
              Retention: <strong>{student.compliance.retentionPolicyId}</strong>
            </span>
          </div>
        </div>
      </div>
    </Card>
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
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
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
              type="button"
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
                      <Mail className="size-4 text-gray-400" />
                      <span className="text-sm font-medium">
                        {packet.contactChannel}: {packet.contactDestinationHint || '-'}
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
                    {packet.reminderCount > 0 ? (
                      <p className="mt-1 text-xs text-gray-500">
                        {packet.reminderCount} reminder{packet.reminderCount !== 1 ? 's' : ''}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-2 flex gap-4 text-xs text-gray-500">
                  <span>Issued: {formatTimestamp(packet.issuedAt)}</span>
                  {packet.expiresAt ? <span>Expires: {formatTimestamp(packet.expiresAt)}</span> : null}
                  {packet.actedAt ? <span>Responded: {formatTimestamp(packet.actedAt)}</span> : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

type AdminComplianceState = {
  activeTab: TabId;
  loading: boolean;
  exporting: boolean;
  error: string | null;
  roster: OrgComplianceRosterData | null;
  packetsData: OrgGuardianPacketsData | null;
};

type AdminComplianceAction =
  | { type: 'tab:set'; activeTab: TabId }
  | { type: 'init:started' }
  | { type: 'init:blocked' }
  | { type: 'init:finished' }
  | { type: 'roster:loaded'; roster: OrgComplianceRosterData }
  | { type: 'roster:failed'; message: string }
  | { type: 'packets:loaded'; packetsData: OrgGuardianPacketsData }
  | { type: 'export:started' }
  | { type: 'export:failed'; message: string }
  | { type: 'export:finished' };

const INITIAL_ADMIN_COMPLIANCE_STATE: AdminComplianceState = {
  activeTab: 'overview',
  loading: true,
  exporting: false,
  error: null,
  roster: null,
  packetsData: null,
};

function adminComplianceReducer(
  state: AdminComplianceState,
  action: AdminComplianceAction,
): AdminComplianceState {
  switch (action.type) {
    case 'tab:set':
      return { ...state, activeTab: action.activeTab };
    case 'init:started':
      return { ...state, loading: true, error: null };
    case 'init:blocked':
      return { ...state, roster: null, packetsData: null, loading: false };
    case 'init:finished':
      return { ...state, loading: false };
    case 'roster:loaded':
      return { ...state, roster: action.roster };
    case 'roster:failed':
      return { ...state, error: action.message };
    case 'packets:loaded':
      return { ...state, packetsData: action.packetsData };
    case 'export:started':
      return { ...state, exporting: true };
    case 'export:failed':
      return { ...state, error: action.message, exporting: false };
    case 'export:finished':
      return { ...state, exporting: false };
    default:
      return state;
  }
}

export function AdminCompliancePage() {
  const navigate = useNavigate();
  const { activeMembership } = useMembership();
  const [state, dispatch] = useReducer(
    adminComplianceReducer,
    INITIAL_ADMIN_COMPLIANCE_STATE,
  );
  const isAdmin = activeMembership?.roles?.includes('school_admin') ?? false;

  const loadRoster = useCallback(async (params?: ComplianceFilterParams) => {
    try {
      const data = await getOrgComplianceRoster(params);
      dispatch({ type: 'roster:loaded', roster: data });
    } catch (err) {
      console.error('Failed to load compliance roster:', err);
      dispatch({ type: 'roster:failed', message: 'Failed to load compliance data.' });
    }
  }, []);

  const loadPackets = useCallback(async (statusFilter?: string) => {
    try {
      const data = await getOrgGuardianPackets(statusFilter);
      dispatch({ type: 'packets:loaded', packetsData: data });
    } catch (err) {
      console.error('Failed to load guardian packets:', err);
    }
  }, []);

  useEffect(() => {
    let isActive = true;

    const init = async () => {
      if (!isAdmin) {
        if (isActive) dispatch({ type: 'init:blocked' });
        return;
      }

      dispatch({ type: 'init:started' });
      await Promise.all([loadRoster(), loadPackets()]);
      if (isActive) dispatch({ type: 'init:finished' });
    };
    void init();

    return () => {
      isActive = false;
    };
  }, [isAdmin, loadRoster, loadPackets]);

  const handleExportAudit = async () => {
    dispatch({ type: 'export:started' });
    try {
      const blob = await exportOrgComplianceAudit();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `org_compliance_audit_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      dispatch({ type: 'export:finished' });
    } catch (err) {
      console.error('Failed to export audit:', err);
      dispatch({ type: 'export:failed', message: 'Failed to export audit data.' });
    }
  };

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

  return (
    <div className="mx-auto max-w-5xl p-6">
      <AdminComplianceHeader
        exporting={state.exporting}
        onBack={() => navigate('/app/teacher')}
        onExportAudit={handleExportAudit}
        onOpenDeletionRequests={() => navigate('/app/admin/deletion-requests')}
      />

      <AdminComplianceTabs
        activeTab={state.activeTab}
        onTabChange={(activeTab) => dispatch({ type: 'tab:set', activeTab })}
      />

      {state.error ? (
        <Alert className="mb-4">
          <AlertTriangle className="size-4" />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <AdminComplianceTabContent
        activeTab={state.activeTab}
        loading={state.loading}
        packetsData={state.packetsData}
        roster={state.roster}
        onLoadPackets={loadPackets}
        onLoadRoster={loadRoster}
      />
    </div>
  );
}

type AdminComplianceHeaderProps = {
  exporting: boolean;
  onBack: () => void;
  onExportAudit: () => void;
  onOpenDeletionRequests: () => void;
};

function AdminComplianceHeader({
  exporting,
  onBack,
  onExportAudit,
  onOpenDeletionRequests,
}: AdminComplianceHeaderProps) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold">School Compliance</h1>
          <p className="text-sm text-gray-500">
            Organization-wide consent, privacy, and guardian packet management
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onExportAudit} disabled={exporting}>
          {exporting ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Download className="mr-2 size-4" />
          )}
          Export Audit
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenDeletionRequests}>
          <FileCheck2 className="mr-2 size-4" />
          Deletion Requests
        </Button>
      </div>
    </div>
  );
}

type AdminComplianceTabsProps = {
  activeTab: TabId;
  onTabChange: (activeTab: TabId) => void;
};

function AdminComplianceTabs({ activeTab, onTabChange }: AdminComplianceTabsProps) {
  return (
    <div className="mb-6 flex gap-1 rounded-lg bg-gray-100 p-1">
      {ADMIN_COMPLIANCE_TABS.map(({ id, label, icon: Icon }) => (
        <button
          type="button"
          key={id}
          onClick={() => onTabChange(id)}
          className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition ${
            activeTab === id
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <Icon className="size-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

type AdminComplianceTabContentProps = {
  activeTab: TabId;
  loading: boolean;
  packetsData: OrgGuardianPacketsData | null;
  roster: OrgComplianceRosterData | null;
  onLoadPackets: (statusFilter?: string) => void;
  onLoadRoster: (params?: ComplianceFilterParams) => void;
};

function AdminComplianceTabContent({
  activeTab,
  loading,
  packetsData,
  roster,
  onLoadPackets,
  onLoadRoster,
}: AdminComplianceTabContentProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <>
      {activeTab === 'overview' && roster ? (
        <OverviewSection packetsData={packetsData} roster={roster} />
      ) : null}

      {activeTab === 'roster' && roster ? (
        <RosterSection roster={roster} onReload={onLoadRoster} />
      ) : null}

      {activeTab === 'packets' && packetsData ? (
        <GuardianPacketsSection packetsData={packetsData} onFilterChange={onLoadPackets} />
      ) : null}
    </>
  );
}

function OverviewSection({
  packetsData,
  roster,
}: {
  packetsData: OrgGuardianPacketsData | null;
  roster: OrgComplianceRosterData;
}) {
  return (
    <div className="space-y-6">
      <SummarySection summary={roster.summary} />
      <QuickInsightsCard summary={roster.summary} />
      {packetsData && packetsData.totalCount > 0 ? (
        <GuardianPacketsOverview packetsData={packetsData} />
      ) : null}
    </div>
  );
}

function QuickInsightsCard({ summary }: { summary: OrgComplianceSummary }) {
  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-medium text-gray-700">Quick insights</h3>
      <div className="space-y-2 text-sm">
        {summary.guardianActionRequiredCount > 0 ? (
          <div className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="size-4" />
            <span>
              {summary.guardianActionRequiredCount} student
              {summary.guardianActionRequiredCount !== 1 ? 's' : ''} need guardian consent
              before using voice features.
            </span>
          </div>
        ) : null}
        {summary.unknownConsentCount > 0 ? (
          <div className="flex items-center gap-2 text-gray-600">
            <AlertTriangle className="size-4" />
            <span>
              {summary.unknownConsentCount} student
              {summary.unknownConsentCount !== 1 ? 's have' : ' has'} unknown consent status -
              review recommended.
            </span>
          </div>
        ) : null}
        {summary.rawAudioRestrictedCount > 0 ? (
          <div className="flex items-center gap-2 text-gray-600">
            <ShieldCheck className="size-4" />
            <span>
              {summary.rawAudioRestrictedCount} student
              {summary.rawAudioRestrictedCount !== 1 ? 's have' : ' has'} raw audio storage
              restricted.
            </span>
          </div>
        ) : null}
        {summary.studentCount > 0 &&
        summary.guardianActionRequiredCount === 0 &&
        summary.unknownConsentCount === 0 ? (
          <div className="flex items-center gap-2 text-green-700">
            <ShieldCheck className="size-4" />
            <span>All students have resolved consent status. No action required.</span>
          </div>
        ) : null}
        {summary.studentCount === 0 ? (
          <p className="text-gray-500">
            No student compliance records found. Records are created when students are enrolled and
            consent settings are configured.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function GuardianPacketsOverview({ packetsData }: { packetsData: OrgGuardianPacketsData }) {
  return (
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
  );
}
