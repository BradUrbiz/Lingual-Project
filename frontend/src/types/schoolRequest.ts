// Plan 3 — admin wizard + school request shape.

export type SchoolType =
  | 'middle' | 'high' | 'k12' | 'university'
  | 'language_academy' | 'district' | 'other';

export type PublicPrivate = 'public' | 'private' | 'charter' | 'other';

export type GradeSize = '<50' | '50-100' | '100-200' | '200-500' | '500+';

export type CanvasIntegrationType =
  | 'lti13' | 'roster_sync' | 'grade_passback' | 'sso';

export type GradeRange =
  | 'k_2' | 'g3_5' | 'g6_8' | 'g9_12'
  | 'undergrad' | 'graduate' | 'adult_ed';

export type CourseFramework =
  | 'ap' | 'actfl' | 'cefr' | 'ib' | 'school_specific' | 'none';

export type RejectionCategory =
  | 'info_missing' | 'fraud_risk' | 'out_of_scope' | 'duplicate' | 'other';

export interface WizardLocation {
  country: string;
  state: string;
  county?: string;
}

export interface WizardAdminIdentityInput {
  fullName: string;
  schoolEmail: string;
  roleTitle: string;
  /** Client-side flag — the SERVER stamps the actual attestation record. */
  authorizationAttested: boolean;
}

export interface WizardAdminIdentityStored {
  fullName: string;
  schoolEmail: string;
  roleTitle: string;
  authorizationAttestation: {
    confirmedAt: string | null;
    ipHash: string | null;
    userAgent: string | null;
  };
}

export interface WizardIntegration {
  canvasUrl: string;
  canvasIntegrationTypes: CanvasIntegrationType[];
}

export interface WizardCurriculum {
  gradeRanges: GradeRange[];
  languagesTaught: string[];          // ISO codes like 'es', 'fr'
  courseFrameworks: CourseFramework[];
}

/** Payload sent from the wizard to POST /api/school-requests. */
export interface WizardSubmitPayload {
  schoolName: string;
  orgType: string;
  websiteUrl?: string;
  canvasInstanceUrl?: string;          // legacy thin field; kept for back-compat
  location?: WizardLocation;
  schoolType?: SchoolType;
  publicPrivate?: PublicPrivate;
  gradeSize?: GradeSize;
  officialEmailDomains?: string[];
  adminIdentity?: WizardAdminIdentityInput;
  integration?: WizardIntegration;
  curriculum?: WizardCurriculum;
  preInvitedTeachers?: string[];
}

/** Persisted draft as returned by GET /api/school-requests/draft. */
export interface WizardDraft {
  uid: string;
  currentStep: 1 | 2 | 3 | 4;
  draftPayload: Partial<WizardSubmitPayload>;
  updatedAt: string | null;
}

/** Full SchoolRequest shape — superset of the Plan 1 legacy shape. */
export interface SchoolRequest {
  id: string;
  requesterUid: string;
  requesterEmail: string;
  requesterName: string;
  schoolName: string;
  orgType: string;
  websiteUrl: string;
  canvasInstanceUrl: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewedByUid: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  rejectionCategory: RejectionCategory | null;
  createdOrgId: string | null;
  createdAt: string | null;
  cancelledAt: string | null;

  // Enriched (may be absent on legacy thin rows)
  location?: WizardLocation | null;
  schoolType?: SchoolType | null;
  publicPrivate?: PublicPrivate | null;
  gradeSize?: GradeSize | null;
  officialEmailDomains?: string[];
  adminIdentity?: WizardAdminIdentityStored | null;
  integration?: { canvasUrl: string; canvasIntegrationTypes: CanvasIntegrationType[] } | null;
  curriculum?: WizardCurriculum | null;
  preInvitedTeachers?: string[];
}
