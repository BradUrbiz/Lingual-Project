import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WizardStep1Organization } from './WizardStep1Organization';
import { validateStep1 } from './wizardValidation';

const noopDispatch = vi.fn();

describe('WizardStep1Organization', () => {
  it('renders all required fields with their current values', () => {
    render(
      <WizardStep1Organization
        state={{
          schoolName: 'SF Friends',
          websiteUrl: 'https://ssfs.org',
          schoolType: 'k12',
          publicPrivate: 'private',
          gradeSize: '50-100',
          location: { country: 'US', state: 'CA' },
        }}
        dispatch={noopDispatch}
      />,
    );
    expect(screen.getByLabelText(/organization name/i)).toHaveValue('SF Friends');
    expect(screen.getByLabelText(/website/i)).toHaveValue('https://ssfs.org');
    expect(screen.getByLabelText(/country/i)).toHaveValue('US');
    expect(screen.getByLabelText(/state/i)).toHaveValue('CA');
    expect(screen.getByDisplayValue('K-12')).toBeChecked();
    expect(screen.getByDisplayValue('Private')).toBeChecked();
    expect(screen.getByDisplayValue('50-100')).toBeChecked();
  });

  it('dispatches SET_FIELD on text input change', () => {
    const dispatch = vi.fn();
    render(<WizardStep1Organization state={{}} dispatch={dispatch} />);
    fireEvent.change(screen.getByLabelText(/organization name/i), {
      target: { value: 'New School' },
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_FIELD', path: 'schoolName', value: 'New School',
    });
  });

  it('dispatches SET_FIELD for nested location.country', () => {
    const dispatch = vi.fn();
    render(<WizardStep1Organization state={{}} dispatch={dispatch} />);
    fireEvent.change(screen.getByLabelText(/country/i), { target: { value: 'CA' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_FIELD', path: 'location.country', value: 'CA',
    });
  });
});

describe('validateStep1', () => {
  it('passes when all required fields are present', () => {
    expect(validateStep1({
      schoolName: 'SF Friends',
      websiteUrl: 'https://ssfs.org',
      location: { country: 'US', state: 'CA' },
      schoolType: 'k12',
      publicPrivate: 'private',
      gradeSize: '50-100',
    })).toEqual({ ok: true, errors: {} });
  });

  it('reports missing schoolName', () => {
    const r = validateStep1({});
    expect(r.ok).toBe(false);
    expect(r.errors.schoolName).toMatch(/required/i);
  });

  it('reports invalid website URL', () => {
    const r = validateStep1({ schoolName: 'X', websiteUrl: 'not-a-url' });
    expect(r.errors.websiteUrl).toMatch(/valid/i);
  });

  it('requires country and state', () => {
    const r = validateStep1({ schoolName: 'X', websiteUrl: 'https://ok.test' });
    expect(r.errors['location.country']).toBeDefined();
    expect(r.errors['location.state']).toBeDefined();
  });
});
