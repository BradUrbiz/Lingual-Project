import { useState } from 'react';
import type { WizardAction } from './wizardReducer';
import type { WizardSubmitPayload } from '@/types/schoolRequest';

export interface WizardStep4Props {
  state: Partial<WizardSubmitPayload>;
  dispatch: (action: WizardAction) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitError: string | null;
}

function SectionHeader({ title, onEdit, editLabel }: { title: string; onEdit: () => void; editLabel: string }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-sm font-semibold">{title}</h3>
      <button type="button" onClick={onEdit}
              className="text-xs text-foreground/70 underline hover:text-foreground"
              aria-label={editLabel}>
        Edit
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="col-span-2">{value || <span className="text-muted-foreground">-</span>}</dd>
    </div>
  );
}

export function WizardStep4Review({
  state, dispatch, onSubmit, submitting, submitError,
}: WizardStep4Props) {
  const [pending, setPending] = useState('');
  const preInvites = state.preInvitedTeachers ?? [];

  function commitPending() {
    const v = pending.trim().toLowerCase();
    if (!v) return;
    setPending('');
    dispatch({
      type: 'SET_PRE_INVITE_TEACHERS',
      emails: [...preInvites, v],
    });
  }

  function removeInvite(email: string) {
    dispatch({
      type: 'SET_PRE_INVITE_TEACHERS',
      emails: preInvites.filter((e) => e !== email),
    });
  }

  return (
    <div className="space-y-6">
      <section>
        <SectionHeader title="Organization"
                       onEdit={() => dispatch({ type: 'GOTO_STEP', step: 1 })}
                       editLabel="Edit Organization" />
        <dl>
          <Row label="Name" value={state.schoolName} />
          <Row label="Website" value={state.websiteUrl} />
          <Row label="Location" value={
            [state.location?.country, state.location?.state, state.location?.county]
              .filter(Boolean).join(', ')
          } />
          <Row label="Type" value={state.schoolType} />
          <Row label="Public / Private" value={state.publicPrivate} />
          <Row label="Grade size" value={state.gradeSize} />
          <Row label="Email domains" value={(state.officialEmailDomains ?? []).join(', ')} />
        </dl>
      </section>

      <section>
        <SectionHeader title="Admin"
                       onEdit={() => dispatch({ type: 'GOTO_STEP', step: 2 })}
                       editLabel="Edit Admin" />
        <dl>
          <Row label="Name" value={state.adminIdentity?.fullName} />
          <Row label="Email" value={state.adminIdentity?.schoolEmail} />
          <Row label="Role" value={state.adminIdentity?.roleTitle} />
          <Row label="Authorized" value={state.adminIdentity?.authorizationAttested ? 'Confirmed' : '-'} />
        </dl>
      </section>

      <section>
        <SectionHeader title="Integration & curriculum"
                       onEdit={() => dispatch({ type: 'GOTO_STEP', step: 3 })}
                       editLabel="Edit Integration" />
        <dl>
          <Row label="Canvas URL" value={state.integration?.canvasUrl} />
          <Row label="Integration types"
               value={(state.integration?.canvasIntegrationTypes ?? []).join(', ')} />
          <Row label="Grade ranges" value={(state.curriculum?.gradeRanges ?? []).join(', ')} />
          <Row label="Languages" value={(state.curriculum?.languagesTaught ?? []).join(', ')} />
          <Row label="Frameworks" value={(state.curriculum?.courseFrameworks ?? []).join(', ')} />
        </dl>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Pre-invite teachers (optional)</h3>
        <p className="mb-2 text-xs text-muted-foreground">
          These addresses will receive an invitation email automatically once Lingual approves your school.
        </p>
        <div className="flex flex-wrap gap-1.5 rounded-md border p-2">
          {preInvites.map((email) => (
            <span key={email} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
              {email}
              <button type="button" onClick={() => removeInvite(email)}
                      aria-label={`Remove ${email}`} className="text-muted-foreground hover:text-foreground">
                ×
              </button>
            </span>
          ))}
          <input
            type="email"
            aria-label="Teacher email"
            className="flex-1 min-w-[140px] border-0 bg-transparent text-sm outline-none"
            placeholder="teacher@school.edu"
            value={pending}
            onChange={(e) => setPending(e.target.value)}
            onBlur={commitPending}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                commitPending();
              }
            }}
          />
        </div>
      </section>

      {submitError && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {submitError}
        </div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="w-full rounded-md border-2 border-foreground bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-60"
      >
        {submitting ? 'Submitting…' : 'Submit for Lingual approval'}
      </button>
    </div>
  );
}
