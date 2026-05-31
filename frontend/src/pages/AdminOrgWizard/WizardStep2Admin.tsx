import type { WizardAction } from './wizardReducer';
import type { WizardSubmitPayload } from '@/types/schoolRequest';
import { WizardField } from './WizardField';

export interface WizardStep2Props {
  state: Partial<WizardSubmitPayload>;
  /** Used inside the attestation copy: "I am authorized by [orgNamePreview]". */
  orgNamePreview: string;
  dispatch: (action: WizardAction) => void;
}

const ROLES = ['Teacher', 'Department chair', 'Principal', 'Vice Principal', 'IT admin', 'LMS admin', 'Other'];

function setField(dispatch: (a: WizardAction) => void, path: string, value: unknown) {
  dispatch({ type: 'SET_FIELD', path, value });
}

export function WizardStep2Admin({ state, orgNamePreview, dispatch }: WizardStep2Props) {
  const ai = state.adminIdentity ?? {
    fullName: '', schoolEmail: '', roleTitle: '', authorizationAttested: false,
  };
  return (
    <div className="space-y-5">
      <WizardField label="Your full name" required htmlFor="fullName">
        <input id="fullName" aria-label="Your full name" type="text"
               className="w-full rounded-md border px-3 py-2"
               value={ai.fullName ?? ''}
               onChange={(e) => setField(dispatch, 'adminIdentity.fullName', e.target.value)} />
      </WizardField>

      <WizardField label="Your school email" required htmlFor="schoolEmail"
                   helper="Use the email you'll log in with.">
        <input id="schoolEmail" aria-label="Your school email" type="email"
               className="w-full rounded-md border px-3 py-2"
               value={ai.schoolEmail ?? ''}
               onChange={(e) => setField(dispatch, 'adminIdentity.schoolEmail', e.target.value)} />
      </WizardField>

      <WizardField label="Your role / title" required htmlFor="roleTitle">
        <select id="roleTitle"
                className="w-full rounded-md border px-3 py-2"
                value={ai.roleTitle ?? ''}
                onChange={(e) => setField(dispatch, 'adminIdentity.roleTitle', e.target.value)}>
          <option value="" disabled>Pick one…</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </WizardField>

      <div className="rounded-md border-2 border-foreground bg-yellow-50 p-4">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={!!ai.authorizationAttested}
            aria-label="I am authorized to manage this organization"
            onChange={(e) =>
              setField(dispatch, 'adminIdentity.authorizationAttested', e.target.checked)}
          />
          <span>
            I confirm that I am <strong>authorized by {orgNamePreview || 'this organization'}</strong> to
            create and manage it on Lingual. I understand that misrepresentation may result in account
            termination and is logged for audit.
          </span>
        </label>
      </div>
    </div>
  );
}
