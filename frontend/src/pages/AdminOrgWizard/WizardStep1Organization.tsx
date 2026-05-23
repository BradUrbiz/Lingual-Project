import type { WizardAction } from './wizardReducer';
import type {
  WizardSubmitPayload,
  SchoolType,
  PublicPrivate,
  GradeSize,
} from '@/types/schoolRequest';
import { WizardField } from './WizardField';

export interface WizardStep1Props {
  state: Partial<WizardSubmitPayload>;
  dispatch: (action: WizardAction) => void;
}

const SCHOOL_TYPES: { value: SchoolType; label: string }[] = [
  { value: 'middle', label: 'Middle school' },
  { value: 'high', label: 'High school' },
  { value: 'k12', label: 'K-12' },
  { value: 'university', label: 'University' },
  { value: 'language_academy', label: 'Language academy' },
  { value: 'district', label: 'District' },
  { value: 'other', label: 'Other' },
];

const PUBLIC_PRIVATE: { value: PublicPrivate; label: string }[] = [
  { value: 'public', label: 'Public' },
  { value: 'private', label: 'Private' },
  { value: 'charter', label: 'Charter' },
  { value: 'other', label: 'Other' },
];

const GRADE_SIZES: GradeSize[] = ['<50', '50-100', '100-200', '200-500', '500+'];

function setField(dispatch: (a: WizardAction) => void, path: string, value: unknown) {
  dispatch({ type: 'SET_FIELD', path, value });
}

export function WizardStep1Organization({ state, dispatch }: WizardStep1Props) {
  const loc = {
    country: state.location?.country ?? '',
    state: state.location?.state ?? '',
    county: state.location?.county ?? '',
  };
  return (
    <div className="space-y-5">
      <WizardField label="Organization name" required htmlFor="schoolName">
        <input
          id="schoolName"
          type="text"
          className="w-full rounded-md border px-3 py-2"
          value={state.schoolName ?? ''}
          onChange={(e) => setField(dispatch, 'schoolName', e.target.value)}
        />
      </WizardField>

      <WizardField label="Organization website" required htmlFor="websiteUrl">
        <input
          id="websiteUrl"
          type="url"
          placeholder="https://yourschool.org"
          className="w-full rounded-md border px-3 py-2"
          value={state.websiteUrl ?? ''}
          onChange={(e) => setField(dispatch, 'websiteUrl', e.target.value)}
        />
      </WizardField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <WizardField label="Country" required htmlFor="country">
          <input id="country" type="text" placeholder="US"
                 className="w-full rounded-md border px-3 py-2"
                 value={loc.country}
                 onChange={(e) => setField(dispatch, 'location.country', e.target.value)} />
        </WizardField>
        <WizardField label="State / Province" required htmlFor="state">
          <input id="state" type="text"
                 className="w-full rounded-md border px-3 py-2"
                 value={loc.state}
                 onChange={(e) => setField(dispatch, 'location.state', e.target.value)} />
        </WizardField>
        <WizardField label="County / District" htmlFor="county">
          <input id="county" type="text"
                 className="w-full rounded-md border px-3 py-2"
                 value={loc.county ?? ''}
                 onChange={(e) => setField(dispatch, 'location.county', e.target.value)} />
        </WizardField>
      </div>

      <WizardField label="School type" required>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SCHOOL_TYPES.map(({ value, label }) => (
            <label key={value} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <input type="radio" name="schoolType" value={label}
                     checked={state.schoolType === value}
                     onChange={() => setField(dispatch, 'schoolType', value)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </WizardField>

      <WizardField label="Public / Private" required>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PUBLIC_PRIVATE.map(({ value, label }) => (
            <label key={value} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <input type="radio" name="publicPrivate" value={label}
                     checked={state.publicPrivate === value}
                     onChange={() => setField(dispatch, 'publicPrivate', value)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </WizardField>

      <WizardField label="Grade size (students per grade level)" required
                   helper="Approximate is fine — used for capacity planning only.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {GRADE_SIZES.map((v) => (
            <label key={v} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <input type="radio" name="gradeSize" value={v}
                     checked={state.gradeSize === v}
                     onChange={() => setField(dispatch, 'gradeSize', v)} />
              <span>{v}</span>
            </label>
          ))}
        </div>
      </WizardField>

      <WizardField label="Official email domain(s)"
                   helper="Comma-separated. Used later to verify teacher signups.">
        <input
          type="text"
          placeholder="@ssfs.org, @school.edu"
          className="w-full rounded-md border px-3 py-2"
          value={(state.officialEmailDomains ?? []).join(', ')}
          onChange={(e) =>
            setField(dispatch, 'officialEmailDomains',
              e.target.value
                .split(',')
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean),
            )
          }
        />
      </WizardField>
    </div>
  );
}

export interface ValidationResult {
  ok: boolean;
  errors: Record<string, string>;
}

const URL_RE = /^https?:\/\/[^\s]+$/i;

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
