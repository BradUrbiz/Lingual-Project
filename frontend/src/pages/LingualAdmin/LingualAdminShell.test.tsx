import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { LingualAdminShell } from './LingualAdminShell';

function renderShellAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/lingual-admin/*" element={<LingualAdminShell />}>
          <Route path="dashboard" element={<div>Dashboard view</div>} />
          <Route path="requests" element={<div>Requests view</div>} />
          <Route path="organizations" element={<div>Orgs view</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('LingualAdminShell', () => {
  it('renders three nav links', () => {
    renderShellAt('/lingual-admin/dashboard');
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /requests/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /organizations/i })).toBeInTheDocument();
  });

  it('renders child outlet', () => {
    renderShellAt('/lingual-admin/requests');
    expect(screen.getByText('Requests view')).toBeInTheDocument();
  });

  it('marks the active link', () => {
    renderShellAt('/lingual-admin/organizations');
    const orgsLink = screen.getByRole('link', { name: /organizations/i });
    expect(orgsLink).toHaveAttribute('aria-current', 'page');
  });
});
