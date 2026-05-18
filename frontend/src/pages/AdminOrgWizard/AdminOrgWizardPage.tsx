import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  getSchoolRequestDraft,
  saveSchoolRequestDraft,
  submitSchoolRequest,
} from '@/api/schoolRequests';
import type { WizardSubmitPayload } from '@/types/schoolRequest';
import {
  wizardReducer,
  initialWizardState,
  type WizardStep,
} from './wizardReducer';
import { WizardProgress } from './WizardProgress';
import { WizardSidebar } from './WizardSidebar';
import {
  WizardStep1Organization,
  validateStep1,
} from './WizardStep1Organization';
import { WizardStep2Admin, validateStep2 } from './WizardStep2Admin';
import { WizardStep3Integration, validateStep3 } from './WizardStep3Integration';
import { WizardStep4Review } from './WizardStep4Review';

const STEPS = [
  { id: 1, title: 'Organization', subtitle: 'Name, website, location' },
  { id: 2, title: 'Admin', subtitle: 'Your identity & authorization' },
  { id: 3, title: 'Integration', subtitle: 'Optional — Canvas & curriculum' },
  { id: 4, title: 'Review', subtitle: 'Confirm & submit' },
];

const AUTOSAVE_DEBOUNCE_MS = 800;

function parseStep(raw: string | null): WizardStep {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  if (n < 1) return 1;
  if (n > 4) return 4;
  return n as WizardStep;
}

export function AdminOrgWizardPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const [state, dispatch] = useReducer(wizardReducer, undefined, initialWizardState);
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 1. Load the draft on mount (or prefill from auth user)
  //    Effect runs once on mount; we deliberately do not depend on `user`
  //    because re-running this on every user-context change would clobber
  //    in-progress edits with the seed payload again. Refreshes to the user
  //    happen in AdminPendingPage, not here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const draft = await getSchoolRequestDraft();
        if (cancelled) return;
        if (draft) {
          dispatch({ type: 'LOAD_DRAFT', draft });
          // Sync the URL to the loaded step so a refresh resumes here too.
          const urlStep = parseStep(params.get('step'));
          if (urlStep !== draft.currentStep) {
            const next = new URLSearchParams(params);
            next.set('step', String(draft.currentStep));
            setParams(next, { replace: true });
          }
        } else if (user) {
          // User.name is the canonical type field (see frontend/src/types/index.ts).
          // Fall back to the local-part of the email if name is empty.
          const fallbackName =
            user.name && user.name.trim().length > 0
              ? user.name
              : (user.email ? user.email.split('@')[0] : '');
          const seed: Partial<WizardSubmitPayload> = {
            adminIdentity: {
              fullName: fallbackName,
              schoolEmail: user.email ?? '',
              roleTitle: '',
              authorizationAttested: false,
            },
          };
          dispatch({
            type: 'LOAD_DRAFT',
            draft: { uid: user.uid ?? '', currentStep: 1, draftPayload: seed, updatedAt: null },
          });
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. URL step → reducer. One-way binding: URL is canonical for navigation
  //    (so browser back/forward works), the reducer is canonical for data.
  //    Only fires when the URL has an explicit ?step param — this avoids
  //    clobbering the draft's loaded step when the URL starts with no ?step.
  //    We don't depend on state.currentStep here — that would create a loop
  //    when gotoStep below pushes URL and the reducer in the same turn.
  useEffect(() => {
    const stepParam = params.get('step');
    if (!loaded || stepParam === null) return;
    const urlStep = parseStep(stepParam);
    if (urlStep !== state.currentStep) {
      dispatch({ type: 'GOTO_STEP', step: urlStep });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, loaded]);

  // 3. Autosave (debounced)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveSchoolRequestDraft({
        currentStep: state.currentStep,
        draftPayload: state.payload,
      }).catch((exc) => console.warn('[wizard] autosave failed', exc));
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state, loaded]);

  function gotoStep(step: WizardStep) {
    const next = new URLSearchParams(params);
    next.set('step', String(step));
    setParams(next, { replace: false });
    dispatch({ type: 'GOTO_STEP', step });
  }

  const validation = useMemo(() => {
    switch (state.currentStep) {
      case 1: return validateStep1(state.payload);
      case 2: return validateStep2(state.payload);
      case 3: return validateStep3(state.payload);
      default: return { ok: true, errors: {} as Record<string, string> };
    }
  }, [state.currentStep, state.payload]);

  async function handleSubmit() {
    // Cancel any pending autosave so it can't fire after submission deletes
    // the draft and recreate a phantom row.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Required fields enforced one more time at submit
      const v1 = validateStep1(state.payload);
      const v2 = validateStep2(state.payload);
      if (!v1.ok) {
        setSubmitError('Some Step 1 fields are missing. Please go back and complete them.');
        return;
      }
      if (!v2.ok) {
        setSubmitError('Please complete the admin identity and authorization in Step 2.');
        return;
      }
      await submitSchoolRequest({
        schoolName: state.payload.schoolName!,
        orgType: 'school',
        websiteUrl: state.payload.websiteUrl,
        location: state.payload.location,
        schoolType: state.payload.schoolType,
        publicPrivate: state.payload.publicPrivate,
        gradeSize: state.payload.gradeSize,
        officialEmailDomains: state.payload.officialEmailDomains,
        adminIdentity: state.payload.adminIdentity,
        integration: state.payload.integration,
        curriculum: state.payload.curriculum,
        preInvitedTeachers: state.payload.preInvitedTeachers,
      });
      navigate('/signup/admin/pending', { replace: true });
    } catch (exc) {
      const message = exc instanceof Error ? exc.message : 'Submission failed.';
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!loaded) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 px-6 py-8 md:grid-cols-[200px_1fr]">
        <aside className="hidden md:block">
          <WizardSidebar steps={STEPS} currentStep={state.currentStep} />
        </aside>
        <main className="space-y-6">
          <header className="space-y-3">
            <h1 className="text-2xl font-display font-bold">Register your school</h1>
            <WizardProgress current={state.currentStep} total={4} />
          </header>

          <section className="rounded-lg border-2 border-foreground bg-card p-6 shadow-stamp-sm">
            {state.currentStep === 1 && (
              <WizardStep1Organization state={state.payload} dispatch={dispatch} />
            )}
            {state.currentStep === 2 && (
              <WizardStep2Admin
                state={state.payload}
                orgNamePreview={state.payload.schoolName ?? ''}
                dispatch={dispatch}
              />
            )}
            {state.currentStep === 3 && (
              <WizardStep3Integration state={state.payload} dispatch={dispatch} />
            )}
            {state.currentStep === 4 && (
              <WizardStep4Review
                state={state.payload}
                dispatch={dispatch}
                onSubmit={handleSubmit}
                submitting={submitting}
                submitError={submitError}
              />
            )}
          </section>

          {state.currentStep < 4 && (
            <footer className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => gotoStep((Math.max(1, state.currentStep - 1)) as WizardStep)}
                disabled={state.currentStep === 1}
                className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => gotoStep((state.currentStep + 1) as WizardStep)}
                disabled={!validation.ok}
                className="rounded-md border-2 border-foreground bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                Save & Continue →
              </button>
            </footer>
          )}
        </main>
      </div>
    </div>
  );
}
