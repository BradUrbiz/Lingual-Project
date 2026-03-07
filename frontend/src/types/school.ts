export type OrganizationType = 'school' | 'district' | 'program';
export type SchoolRole = 'school_admin' | 'teacher' | 'student';
export type MembershipStatus = 'active' | 'invited' | 'inactive';

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
