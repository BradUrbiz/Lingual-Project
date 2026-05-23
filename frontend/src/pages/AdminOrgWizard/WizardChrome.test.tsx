import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WizardField } from './WizardField';
import { WizardProgress } from './WizardProgress';
import { WizardSidebar } from './WizardSidebar';

describe('WizardField', () => {
  it('renders label and required marker', () => {
    render(
      <WizardField label="School name" required htmlFor="name">
        <input id="name" />
      </WizardField>,
    );
    expect(screen.getByLabelText(/school name/i)).toBeInTheDocument();
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('renders helper text and error message', () => {
    render(
      <WizardField label="Email" helper="Use your school email" error="Required">
        <input />
      </WizardField>,
    );
    expect(screen.getByText('Use your school email')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });
});

describe('WizardProgress', () => {
  it('marks dots [done, done, current, todo] for current=3', () => {
    render(<WizardProgress current={3} total={4} />);
    const dots = screen.getAllByTestId(/^wizard-progress-dot-/);
    expect(dots).toHaveLength(4);
    expect(dots[0]).toHaveAttribute('data-state', 'done');
    expect(dots[1]).toHaveAttribute('data-state', 'done');
    expect(dots[2]).toHaveAttribute('data-state', 'current');
    expect(dots[3]).toHaveAttribute('data-state', 'todo');
  });
});

describe('WizardSidebar', () => {
  it('lists each step title and marks the current one', () => {
    render(
      <WizardSidebar
        steps={[
          { id: 1, title: 'Organization' },
          { id: 2, title: 'Admin' },
          { id: 3, title: 'Integration' },
          { id: 4, title: 'Review' },
        ]}
        currentStep={2}
      />,
    );
    expect(screen.getByText('Organization')).toBeInTheDocument();
    const current = screen.getByText('Admin').closest('li');
    expect(current).toHaveAttribute('aria-current', 'step');
  });
});
