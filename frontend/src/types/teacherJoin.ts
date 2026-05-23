export type TeacherJoinRequestStatus = 'pending' | 'approved' | 'declined' | 'cancelled';
export type TeacherJoinRequestSource = 'invite_code' | 'search';

export interface TeacherJoinRequest {
  requestId: string;
  orgId: string;
  orgName: string;
  status: TeacherJoinRequestStatus;
  source?: TeacherJoinRequestSource;
  declineReason?: string;
}

export interface PendingTeacherRequestRow {
  requestId: string;
  uid: string;
  name: string;
  email: string;
  source: TeacherJoinRequestSource;
  status: TeacherJoinRequestStatus;
  requestedAt: string | null;
}

export interface OrgSearchResult {
  id: string;
  name: string;
  city?: string;
  state?: string;
  school_type?: string;
}
