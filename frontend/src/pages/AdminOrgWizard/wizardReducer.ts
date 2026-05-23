import type { WizardDraft, WizardSubmitPayload } from '@/types/schoolRequest';

export type WizardStep = 1 | 2 | 3 | 4;

export interface WizardState {
  currentStep: WizardStep;
  payload: Partial<WizardSubmitPayload>;
  /** dotted-path → whether the user has interacted with that field */
  touched: Record<string, boolean>;
}

export type WizardAction =
  | { type: 'SET_FIELD'; path: string; value: unknown }
  | { type: 'GOTO_STEP'; step: number }
  | { type: 'LOAD_DRAFT'; draft: WizardDraft }
  | { type: 'SET_PRE_INVITE_TEACHERS'; emails: string[] }
  | { type: 'RESET' };

export function initialWizardState(): WizardState {
  return { currentStep: 1, payload: {}, touched: {} };
}

function clampStep(s: number): WizardStep {
  if (s < 1) return 1;
  if (s > 4) return 4;
  return s as WizardStep;
}

/**
 * Immutably set a value at a dotted path. **Object paths only** — does not
 * support array indices. The wizard's payload shape (`adminIdentity.fullName`,
 * `location.country`, `curriculum.gradeRanges` as a whole) only needs object
 * nesting. If a future field demands array writes, replace this with `lodash.set`
 * or extend with index parsing.
 */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const parts = path.split('.');
  const next = { ...obj };
  let cursor: Record<string, unknown> = next;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const prev = (cursor[k] as Record<string, unknown> | undefined) ?? {};
    cursor[k] = { ...prev };
    cursor = cursor[k] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
  return next;
}

function dedupLower(emails: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of emails) {
    const v = String(raw || '').trim().toLowerCase();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_FIELD': {
      const payload = setByPath(
        state.payload as Record<string, unknown>,
        action.path,
        action.value,
      ) as Partial<WizardSubmitPayload>;
      return {
        ...state,
        payload,
        touched: { ...state.touched, [action.path]: true },
      };
    }
    case 'GOTO_STEP':
      return { ...state, currentStep: clampStep(action.step) };
    case 'LOAD_DRAFT':
      return {
        currentStep: clampStep(action.draft.currentStep),
        payload: { ...action.draft.draftPayload },
        touched: {},
      };
    case 'SET_PRE_INVITE_TEACHERS': {
      const next = dedupLower(action.emails);
      return {
        ...state,
        payload: { ...state.payload, preInvitedTeachers: next },
        touched: { ...state.touched, preInvitedTeachers: true },
      };
    }
    case 'RESET':
      return initialWizardState();
    default:
      return state;
  }
}
