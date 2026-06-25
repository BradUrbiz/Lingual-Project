import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { SchoolAdminHomePage } from './SchoolAdminHomePage';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

describe('SchoolAdminHomePage', () => {
  it('renders welcome heading', () => {
    render(<MemoryRouter><SchoolAdminHomePage /></MemoryRouter>);
    expect(screen.getByText('admin.home.title')).toBeInTheDocument();
  });

  it('renders link to teacher tools', () => {
    render(<MemoryRouter><SchoolAdminHomePage /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /admin\.home\.teacherTools/i });
    expect(link).toHaveAttribute('href', '/app/teacher');
  });

  it('renders link to compliance', () => {
    render(<MemoryRouter><SchoolAdminHomePage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /admin\.home\.compliance/i })).toBeInTheDocument();
  });
});
