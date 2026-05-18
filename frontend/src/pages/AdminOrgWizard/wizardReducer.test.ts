import { describe, it, expect } from 'vitest';
import {
  wizardReducer,
  initialWizardState,
  type WizardState,
} from './wizardReducer';

describe('wizardReducer', () => {
  it('starts with empty payload at step 1', () => {
    const state = initialWizardState();
    expect(state.currentStep).toBe(1);
    expect(state.payload).toEqual({});
    expect(state.touched).toEqual({});
  });

  it('SET_FIELD updates the payload by dotted path', () => {
    const state = wizardReducer(initialWizardState(), {
      type: 'SET_FIELD', path: 'schoolName', value: 'SF Friends',
    });
    expect(state.payload.schoolName).toBe('SF Friends');
    expect(state.touched.schoolName).toBe(true);
  });

  it('SET_FIELD handles nested paths like adminIdentity.fullName', () => {
    let state = initialWizardState();
    state = wizardReducer(state, {
      type: 'SET_FIELD', path: 'adminIdentity.fullName', value: 'Ada',
    });
    state = wizardReducer(state, {
      type: 'SET_FIELD', path: 'adminIdentity.schoolEmail', value: 'ada@x.test',
    });
    expect(state.payload.adminIdentity).toEqual({
      fullName: 'Ada',
      schoolEmail: 'ada@x.test',
    });
  });

  it('GOTO_STEP clamps to [1, 4]', () => {
    let state = initialWizardState();
    state = wizardReducer(state, { type: 'GOTO_STEP', step: 0 });
    expect(state.currentStep).toBe(1);
    state = wizardReducer(state, { type: 'GOTO_STEP', step: 99 });
    expect(state.currentStep).toBe(4);
    state = wizardReducer(state, { type: 'GOTO_STEP', step: 3 });
    expect(state.currentStep).toBe(3);
  });

  it('LOAD_DRAFT replaces state', () => {
    const state = wizardReducer(initialWizardState(), {
      type: 'LOAD_DRAFT',
      draft: {
        uid: 'u',
        currentStep: 2,
        draftPayload: { schoolName: 'SF Friends' },
        updatedAt: null,
      },
    });
    expect(state.currentStep).toBe(2);
    expect(state.payload.schoolName).toBe('SF Friends');
  });

  it('SET_PRE_INVITE_TEACHERS replaces the list (dedup + lowercase + trim)', () => {
    const state = wizardReducer(initialWizardState(), {
      type: 'SET_PRE_INVITE_TEACHERS',
      emails: ['  Foo@X.test ', 'foo@x.test', 'bar@x.test', ''],
    });
    expect(state.payload.preInvitedTeachers).toEqual(['foo@x.test', 'bar@x.test']);
  });

  it('RESET returns to initial', () => {
    let state = wizardReducer(initialWizardState(), {
      type: 'SET_FIELD', path: 'schoolName', value: 'SF',
    });
    state = wizardReducer(state, { type: 'RESET' });
    expect(state.currentStep).toBe(1);
    expect(state.payload).toEqual({});
  });
});
