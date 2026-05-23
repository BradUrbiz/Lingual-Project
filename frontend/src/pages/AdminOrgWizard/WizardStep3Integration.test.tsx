import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WizardStep3Integration, validateStep3 } from './WizardStep3Integration';

describe('WizardStep3Integration', () => {
  it('hides Canvas fields by default', () => {
    render(<WizardStep3Integration state={{}} dispatch={vi.fn()} />);
    expect(screen.queryByLabelText(/canvas instance/i)).not.toBeInTheDocument();
  });

  it('shows Canvas fields when user picks "Yes"', () => {
    const dispatch = vi.fn();
    const { rerender } = render(<WizardStep3Integration state={{}} dispatch={dispatch} />);
    fireEvent.click(screen.getByLabelText(/uses canvas: yes/i));
    rerender(
      <WizardStep3Integration
        state={{ integration: { canvasUrl: '', canvasIntegrationTypes: [] } }}
        dispatch={dispatch}
      />,
    );
    expect(screen.getByLabelText(/canvas instance/i)).toBeInTheDocument();
  });

  it('toggles canvasIntegrationTypes via dispatch', () => {
    const dispatch = vi.fn();
    render(
      <WizardStep3Integration
        state={{ integration: { canvasUrl: 'x.instructure.com', canvasIntegrationTypes: [] } }}
        dispatch={dispatch}
      />,
    );
    fireEvent.click(screen.getByLabelText(/LTI 1.3 assignment launch/i));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_FIELD',
      path: 'integration.canvasIntegrationTypes',
      value: ['lti13'],
    });
  });

  it('allows selecting multiple grade ranges (chip toggles)', () => {
    const dispatch = vi.fn();
    render(
      <WizardStep3Integration
        state={{ curriculum: { gradeRanges: ['g6_8'], languagesTaught: [], courseFrameworks: [] } }}
        dispatch={dispatch}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /9–12/i }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_FIELD',
      path: 'curriculum.gradeRanges',
      value: ['g6_8', 'g9_12'],
    });
  });

  it('renders without crashing when curriculum is partial', () => {
    // The reducer's SET_FIELD on `curriculum.gradeRanges` produces a partial
    // curriculum object with the other arrays undefined. The component must
    // default each nested array independently so .join() / .includes() don't
    // crash on the partial.
    const dispatch = vi.fn();
    expect(() => render(
      <WizardStep3Integration
        state={{ curriculum: { gradeRanges: ['g6_8'] } as never }}
        dispatch={dispatch}
      />,
    )).not.toThrow();
    expect(screen.getByLabelText(/languages taught/i)).toHaveValue('');
  });
});

describe('validateStep3', () => {
  it('always passes (step is optional)', () => {
    expect(validateStep3({}).ok).toBe(true);
    expect(validateStep3({
      integration: { canvasUrl: 'x.instructure.com', canvasIntegrationTypes: ['lti13'] },
    }).ok).toBe(true);
  });
});
