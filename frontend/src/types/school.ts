export type OrganizationType = 'school' | 'district' | 'program';
export type SchoolRole = 'school_admin' | 'teacher' | 'student';
export type MembershipStatus = 'active' | 'invited' | 'inactive';
export type ConsentStatus = 'unknown' | 'granted' | 'revoked' | 'not_required';
export type GuardianConsentPacketStatus =
  | 'draft'
  | 'issued'
  | 'viewed'
  | 'granted'
  | 'revoked'
  | 'expired'
  | 'canceled';
export type GuardianConsentDeliveryMethod = 'secure_link' | 'downloadable_notice';
export type GuardianConsentContactChannel = 'email' | 'phone' | 'paper' | 'other';

export interface MembershipSummary {
  id: string;
  orgId: string | null;
  orgName: string;
  orgType?: OrganizationType | string | null;
  roles: SchoolRole[];
  status: MembershipStatus | string;
  primaryClassIds?: string[];
}

export interface TeacherClassSummary {
  id: string;
  orgId?: string | null;
  name: string;
  term?: string;
  subject?: string;
  learningLocale: string;
  teacherMembershipIds?: string[];
  gradeBand?: string;
  status: string;
  studentCount: number;
  assignmentCount?: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface SetupChecklistItem {
  id: string;
  title: string;
  description: string;
  completed: boolean;
}

export interface SchoolContextSummary {
  memberships: MembershipSummary[];
  activeMembership: MembershipSummary | null;
  activeMembershipId: string | null;
  activeOrganizationId: string | null;
  activeRoles: SchoolRole[];
  allowedClassIds: string[];
  teacherClasses: TeacherClassSummary[];
  setupChecklist: SetupChecklistItem[];
  canManageSchool: boolean;
  needsSchoolSetup: boolean;
}

export interface TeacherDashboardSummary {
  classCount: number;
  studentCount: number;
  speakingMinutes: number;
  assignmentCount: number;
}

export interface TeacherDashboardData {
  organizationName: string;
  summary: TeacherDashboardSummary;
  classes: TeacherClassSummary[];
  setupChecklist: SetupChecklistItem[];
  alerts: string[];
}

export interface RetentionPolicySummary {
  id: string;
  label: string;
  rawAudioStorageAllowed: boolean;
  rawAudioRetentionDays?: number | null;
  transcriptRetentionDays?: number | null;
  analyticsRetentionDays?: number | null;
}

export interface StudentComplianceRecord {
  id: string;
  orgId: string;
  studentUid: string;
  isMinor: boolean;
  guardianConsentStatus: ConsentStatus | string;
  voiceConsentStatus: ConsentStatus | string;
  textAllowed: boolean;
  voiceAllowed: boolean;
  retentionPolicyId: string;
  retentionPolicy: RetentionPolicySummary;
  schoolAgreementVersion?: string;
  lastVerifiedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface UpdateStudentCompliancePayload {
  isMinor?: boolean;
  guardianConsentStatus?: ConsentStatus | string;
  voiceConsentStatus?: ConsentStatus | string;
  textAllowed?: boolean;
  retentionPolicyId?: string;
  schoolAgreementVersion?: string;
}

export interface GuardianConsentPacket {
  id: string;
  orgId: string;
  classId: string;
  studentUid: string;
  noticeVersion: string;
  consentScope: string;
  contactChannel: GuardianConsentContactChannel | string;
  contactDestinationHint: string;
  deliveryMethod: GuardianConsentDeliveryMethod | string;
  status: GuardianConsentPacketStatus | string;
  tokenLastFour?: string;
  responseMethod?: string;
  evidenceRef?: string;
  reminderCount: number;
  expiresAt?: string | null;
  issuedAt?: string | null;
  lastSentAt?: string | null;
  actedAt?: string | null;
  createdByUid?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  canResend?: boolean;
  canCancel?: boolean;
  isTerminal?: boolean;
}

export interface IssueGuardianConsentPacketPayload {
  noticeVersion?: string;
  consentScope?: string;
  deliveryMethod?: GuardianConsentDeliveryMethod | string;
  contactChannel?: GuardianConsentContactChannel | string;
  contactDestinationHint?: string;
}

export interface GuardianConsentIssueResult {
  guardianPacket: GuardianConsentPacket;
  deliveryToken?: string;
}

export interface GuardianConsentPublicView {
  packet: GuardianConsentPacket;
  notice: {
    version: string;
    title: string;
    summary: string;
    bullets: string[];
  };
  student: {
    displayName: string;
  };
  class: {
    name: string;
    subject?: string;
  };
}

export interface GuardianConsentDecisionResult {
  guardianConsent: GuardianConsentPublicView;
  guardianPacket: GuardianConsentPacket;
  compliance: StudentComplianceRecord;
}

export interface ClassComplianceStudentEntry {
  uid: string;
  displayName: string;
  studentNumber?: string;
  guardianContactRequired: boolean;
  compliance: StudentComplianceRecord;
  guardianPacket?: GuardianConsentPacket | null;
  blockedReasons: string[];
}

export interface ClassComplianceRosterSummary {
  studentCount: number;
  voiceAllowedCount: number;
  voiceBlockedCount: number;
  guardianActionRequiredCount: number;
  unknownConsentCount: number;
  rawAudioRestrictedCount: number;
  textBlockedCount: number;
}

export interface ClassComplianceRosterData {
  class: TeacherClassSummary;
  summary: ClassComplianceRosterSummary;
  students: ClassComplianceStudentEntry[];
  limitations: string[];
}

export interface BulkUpdateClassCompliancePayload {
  studentUids: string[];
  updates: UpdateStudentCompliancePayload;
  reason?: string;
}

export interface BulkUpdateClassComplianceResult {
  batchId: string;
  updatedCount: number;
  studentUids: string[];
}

export interface CreateSchoolPayload {
  orgName: string;
  orgType: OrganizationType;
  className: string;
  term?: string;
  subject?: string;
  gradeBand?: string;
  learningLocale: string;
}

export interface CreateTeacherClassPayload {
  name: string;
  term?: string;
  subject?: string;
  gradeBand?: string;
  learningLocale: string;
}

export interface ClassJoinCodeData {
  joinCode: string;
  active: boolean;
  generatedAt: string | null;
}

export interface JoinClassResult {
  alreadyEnrolled: boolean;
  class: {
    id: string;
    name: string;
    subject?: string;
    learningLocale?: string;
  };
  membershipId?: string;
  enrollmentId?: string;
}

export interface ClassRosterStudent {
  uid: string;
  displayName: string;
  studentNumber?: string;
  joinSource?: string;
  enrolledAt?: string | null;
  status: string;
}

// --- Org-wide compliance (school-wide admin tooling) ---

export interface OrgComplianceSummary {
  studentCount: number;
  voiceAllowedCount: number;
  voiceBlockedCount: number;
  guardianActionRequiredCount: number;
  unknownConsentCount: number;
  rawAudioRestrictedCount: number;
  textBlockedCount: number;
}

export interface OrgComplianceStudentEntry {
  uid: string;
  displayName: string;
  classIds: string[];
  classNames: string[];
  compliance: StudentComplianceRecord;
  blockedReasons: string[];
}

export interface OrgComplianceRosterData {
  summary: OrgComplianceSummary;
  students: OrgComplianceStudentEntry[];
}

export interface OrgGuardianPacketsData {
  packets: GuardianConsentPacket[];
  statusCounts: Record<string, number>;
  totalCount: number;
}

// --- Deletion requests (Epic B) ---

export type DeletionScopeType = 'student' | 'class' | 'org';

export type DeletionRequestStatus =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'partially_completed';

export type DeletionRunStatus = 'running' | 'completed' | 'failed' | 'partially_completed';

export interface DeletionRequest {
  id: string;
  orgId: string;
  scopeType: DeletionScopeType;
  scopeId: string;
  requestedByUid: string;
  requestReason: string;
  status: DeletionRequestStatus;
  approvedByUid: string;
  reviewNotes: string;
  targetCollections: string[];
  targetStoragePrefixes: string[];
  executionSummary: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
}

export interface DeletionExecutionRun {
  id: string;
  requestId: string;
  orgId: string;
  scopeType: DeletionScopeType;
  scopeId: string;
  status: DeletionRunStatus;
  attemptNumber: number;
  firestoreCounts: {
    targeted: number;
    deleted: number;
    failed: number;
    by_collection?: Record<string, { targeted: number; deleted: number; failed: number }>;
  };
  storageCounts: { targeted: number; deleted: number; failed: number };
  errorSummary: string[];
  startedAt: string | null;
  finishedAt: string | null;
}

export interface CreateDeletionRequestPayload {
  scopeType: DeletionScopeType;
  scopeId: string;
  requestReason?: string;
}

export interface DeletionRequestDetail {
  request: DeletionRequest;
  runs: DeletionExecutionRun[];
}
