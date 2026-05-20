export type OrgStatus = 'active' | 'suspended' | 'archived';

export type DeclineCategory =
  | 'info_missing'
  | 'fraud_risk'
  | 'out_of_scope'
  | 'duplicate'
  | 'other';

export interface OverviewTiles {
  pendingRequests: number;
  activeOrgs: number;
  suspendedOrgs: number;
  newRequestsLast7d: number;
}

export interface AuditEntry {
  id: string;
  actorUid: string;
  action: string;
  target: { type: string; id: string };
  targetOrgId: string | null;
  metadata: Record<string, unknown>;
  ipHash: string;
  userAgent: string;
  createdAt: string | null;
}

export interface OverviewResponse {
  tiles: OverviewTiles;
  recentActivity: AuditEntry[];
}

export interface SchoolRequestRow {
  id: string;
  schoolName: string;
  orgType?: string;
  schoolType?: string;
  status: string;
  requesterEmail?: string;
  requesterName?: string;
  createdAt?: string | null;
  country?: string;
  rejectionReason?: string;
  rejectionCategory?: DeclineCategory;
}

export interface RequestsListResponse {
  items: SchoolRequestRow[];
  nextCursor: { leadingValue: string | null; id: string } | null;
}

// SchoolRequestDetail mirrors the backend `_serialize_request` wire shape
// in `backend/routes/school_requests.py`. Plan 3 nests location, admin
// identity (with attestation), integration, and curriculum under their own
// objects; the panel must traverse those, not flat top-level keys.

export interface LocationDetail {
  country?: string;
  state?: string;
  county?: string;
}

export interface AuthorizationAttestation {
  confirmedAt: string | null;
  ipHash: string;
  userAgent: string;
}

export interface AdminIdentityDetail {
  fullName?: string;
  schoolEmail?: string;
  roleTitle?: string;
  authorizationAttestation: AuthorizationAttestation;
}

export interface IntegrationDetail {
  canvasUrl: string | null;
  canvasIntegrationTypes: string[];
}

export interface CurriculumDetail {
  gradeRanges?: string[];
  languagesTaught?: string[];
  courseFrameworks?: string[];
}

export interface SchoolRequestDetail extends SchoolRequestRow {
  requesterUid?: string;
  websiteUrl?: string;
  canvasInstanceUrl?: string;
  location?: LocationDetail;
  publicPrivate?: string;
  gradeSize?: number;
  officialEmailDomains?: string[];
  preInvitedTeachers: string[];
  adminIdentity?: AdminIdentityDetail;
  integration?: IntegrationDetail;
  curriculum?: CurriculumDetail;
}

export interface OrgSummary {
  id: string;
  name: string;
  status: OrgStatus;
  schoolType?: string;
  country?: string;
  publicOrPrivate?: string;
  memberCount: number;
  createdAt?: string | null;
  lastActivityAt?: string | null;
}

export interface OrgsListResponse {
  items: OrgSummary[];
  nextCursor: { nameLower: string; id: string } | null;
}

export interface OrgDetail {
  id: string;
  name: string;
  status: OrgStatus;
  schoolType?: string;
  country?: string;
  state?: string;
  websiteUrl?: string;
  createdAt?: string | null;
  lastActivityAt?: string | null;
  suspendedAt?: string | null;
  suspendedByUid?: string | null;
  suspendReason?: string | null;
  suspendedUntil?: string | null;
  schoolAdminContacts: Array<{
    membershipId: string;
    uid: string;
    email: string;
    name?: string;
  }>;
}

export interface MemberRow {
  membershipId: string;
  uid: string;
  email: string;
  name?: string;
  roles: string[];
  status: string;
  joinedAt?: string | null;
}

export interface MembersResponse {
  members: MemberRow[];
  studentCount: number;
}

export interface ClassRow {
  id: string;
  name?: string;
  term?: string;
  subject?: string;
  teacherMembershipIds: string[];
  createdAt?: string | null;
  lastActivityAt?: string | null;
}

export interface ClassesResponse {
  items: ClassRow[];
}

export interface OrgAuditResponse {
  items: AuditEntry[];
}

export interface SuspendPayload {
  reason: string;
  suspendedUntil?: string | null;
}

export interface DeclinePayload {
  reason: string;
  category: DeclineCategory;
  internalNote?: string;
}

export interface ApprovePayload {
  internalNote?: string;
}

export interface ApproveResponse {
  requestId: string;
  createdOrgId: string;
  membershipId: string;
  preInviteInvitationIds: string[];
}
