import type { WizardSubmitPayload } from '@/types/schoolRequest';

export interface ValidationResult {
  ok: boolean;
  errors: Record<string, string>;
}

const URL_RE = /^https?:\/\/[^\s]+$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validateStep1(state: Partial<WizardSubmitPayload>): ValidationResult {
  const errors: Record<string, string> = {};
  if (!state.schoolName || state.schoolName.trim().length < 2) {
    errors.schoolName = 'Organization name is required.';
  }
  if (!state.websiteUrl) {
    errors.websiteUrl = 'Organization website is required.';
  } else if (!URL_RE.test(state.websiteUrl)) {
    errors.websiteUrl = 'Enter a valid URL (starting with https://).';
  }
  const loc = state.location ?? { country: '', state: '' };
  if (!loc.country) errors['location.country'] = 'Country is required.';
  if (!loc.state) errors['location.state'] = 'State / Province is required.';
  if (!state.schoolType) errors.schoolType = 'School type is required.';
  if (!state.publicPrivate) errors.publicPrivate = 'Public / Private is required.';
  if (!state.gradeSize) errors.gradeSize = 'Grade size is required.';
  return { ok: Object.keys(errors).length === 0, errors };
}

export function validateStep2(state: Partial<WizardSubmitPayload>): ValidationResult {
  const errors: Record<string, string> = {};
  const ai = state.adminIdentity ?? {} as Partial<NonNullable<WizardSubmitPayload['adminIdentity']>>;
  if (!ai.fullName) errors['adminIdentity.fullName'] = 'Full name is required.';
  if (!ai.schoolEmail) {
    errors['adminIdentity.schoolEmail'] = 'School email is required.';
  } else if (!EMAIL_RE.test(ai.schoolEmail)) {
    errors['adminIdentity.schoolEmail'] = 'Enter a valid email address.';
  }
  if (!ai.roleTitle) errors['adminIdentity.roleTitle'] = 'Role / title is required.';
  if (!ai.authorizationAttested) {
    errors['adminIdentity.authorizationAttested'] =
      'You must confirm you are authorized to create this organization.';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

export function validateStep3(_state: Partial<WizardSubmitPayload>): ValidationResult {
  return { ok: true, errors: {} };
}
