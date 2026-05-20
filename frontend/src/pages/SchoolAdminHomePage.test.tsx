import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { SchoolAdminHomePage } from './SchoolAdminHomePage';

describe('SchoolAdminHomePage', () => {
  it('renders welcome heading', () => {
    render(<MemoryRouter><SchoolAdminHomePage /></MemoryRouter>);
    expect(screen.getByText(/school admin/i)).toBeInTheDocument();
  });

  it('renders link to teacher tools', () => {
    render(<MemoryRouter><SchoolAdminHomePage /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /teacher tools|classes/i });
    expect(link).toHaveAttribute('href', '/app/teacher');
  });

  it('renders link to compliance', () => {
    render(<MemoryRouter><SchoolAdminHomePage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /compliance/i })).toBeInTheDocument();
  });
});
