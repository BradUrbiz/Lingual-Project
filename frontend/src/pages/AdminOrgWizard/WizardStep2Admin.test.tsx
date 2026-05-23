import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WizardStep2Admin, validateStep2 } from './WizardStep2Admin';

describe('WizardStep2Admin', () => {
  it('renders prefilled admin identity', () => {
    render(
      <WizardStep2Admin
        state={{
          adminIdentity: {
            fullName: 'Ada Lovelace',
            schoolEmail: 'ada@ssfs.org',
            roleTitle: 'Principal',
            authorizationAttested: false,
          },
        }}
        orgNamePreview="SF Friends"
        dispatch={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/full name/i)).toHaveValue('Ada Lovelace');
    expect(screen.getByLabelText(/school email/i)).toHaveValue('ada@ssfs.org');
    expect(screen.getByLabelText(/role/i)).toHaveValue('Principal');
    expect(screen.getByText(/SF Friends/)).toBeInTheDocument();
  });

  it('dispatches SET_FIELD for adminIdentity.fullName', () => {
    const dispatch = vi.fn();
    render(<WizardStep2Admin state={{}} orgNamePreview="" dispatch={dispatch} />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Bob' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_FIELD', path: 'adminIdentity.fullName', value: 'Bob',
    });
  });

  it('toggles authorization checkbox via dispatch', () => {
    const dispatch = vi.fn();
    render(<WizardStep2Admin state={{}} orgNamePreview="" dispatch={dispatch} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /authorized/i }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_FIELD',
      path: 'adminIdentity.authorizationAttested',
      value: true,
    });
  });
});

describe('validateStep2', () => {
  const ok = {
    adminIdentity: {
      fullName: 'Ada',
      schoolEmail: 'ada@ssfs.org',
      roleTitle: 'Principal',
      authorizationAttested: true,
    },
  };

  it('passes a complete payload', () => {
    expect(validateStep2(ok).ok).toBe(true);
  });

  it('requires authorization checkbox', () => {
    const r = validateStep2({
      adminIdentity: { ...ok.adminIdentity, authorizationAttested: false },
    });
    expect(r.ok).toBe(false);
    expect(r.errors['adminIdentity.authorizationAttested']).toMatch(/confirm/i);
  });

  it('requires fullName, schoolEmail, roleTitle', () => {
    const r = validateStep2({ adminIdentity: { authorizationAttested: true } as never });
    expect(r.errors['adminIdentity.fullName']).toBeDefined();
    expect(r.errors['adminIdentity.schoolEmail']).toBeDefined();
    expect(r.errors['adminIdentity.roleTitle']).toBeDefined();
  });

  it('rejects malformed email', () => {
    const r = validateStep2({
      adminIdentity: { ...ok.adminIdentity, schoolEmail: 'not-an-email' },
    });
    expect(r.errors['adminIdentity.schoolEmail']).toMatch(/valid/i);
  });
});
