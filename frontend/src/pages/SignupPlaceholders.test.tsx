import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminOrgWizardPlaceholderPage } from './AdminOrgWizardPlaceholderPage';
import { vi } from 'vitest';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'a@b.test', name: 'A', intendedRole: 'teacher' },
    logout: vi.fn(),
  }),
}));

describe('Admin org wizard placeholder', () => {
  it('renders a coming-soon message and a link back to the landing page', () => {
    render(
      <MemoryRouter>
        <AdminOrgWizardPlaceholderPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /almost there/i })).toBeInTheDocument();
    expect(screen.getByText(/school registration/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/');
  });
});
