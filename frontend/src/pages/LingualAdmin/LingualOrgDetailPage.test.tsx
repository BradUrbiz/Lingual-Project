import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LingualOrgDetailPage } from './LingualOrgDetailPage';
import * as api from '@/api/lingualAdmin';

vi.mock('@/api/lingualAdmin');

beforeEach(() => vi.resetAllMocks());

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/lingual-admin/organizations/:orgId" element={<LingualOrgDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LingualOrgDetailPage', () => {
  it('renders org name and overview tab content', async () => {
    vi.mocked(api.fetchOrgDetail).mockResolvedValue({
      id: 'o1', name: 'Sunset HS', status: 'active',
      country: 'US', state: 'CA', county: 'San Mateo',
      schoolAdminContacts: [{ membershipId: 'm1', uid: 'u1', email: 'a@x.com' }],
    } as any);
    renderAt('/lingual-admin/organizations/o1');
    await waitFor(() => screen.getByText('Sunset HS'));
    expect(screen.getByText('US / CA / San Mateo')).toBeInTheDocument();
    expect(screen.getByText('a@x.com', { exact: false })).toBeInTheDocument();
  });

  it('shows Suspend button when active', async () => {
    vi.mocked(api.fetchOrgDetail).mockResolvedValue({
      id: 'o1', name: 'Sunset HS', status: 'active', schoolAdminContacts: [],
    } as any);
    renderAt('/lingual-admin/organizations/o1');
    await waitFor(() => screen.getByText('Sunset HS'));
    expect(screen.getByRole('button', { name: /suspend/i })).toBeInTheDocument();
  });

  it('shows Restore button when suspended', async () => {
    vi.mocked(api.fetchOrgDetail).mockResolvedValue({
      id: 'o1', name: 'Sunset HS', status: 'suspended', schoolAdminContacts: [],
      suspendReason: 'compliance review',
    } as any);
    renderAt('/lingual-admin/organizations/o1');
    await waitFor(() => screen.getByText('Sunset HS'));
    expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument();
  });

  it('Suspend opens modal and calls API on confirm', async () => {
    vi.mocked(api.fetchOrgDetail).mockResolvedValue({
      id: 'o1', name: 'Sunset HS', status: 'active', schoolAdminContacts: [],
    } as any);
    vi.mocked(api.suspendOrg).mockResolvedValue();
    renderAt('/lingual-admin/organizations/o1');
    await waitFor(() => screen.getByText('Sunset HS'));
    fireEvent.click(screen.getByRole('button', { name: /suspend/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'fraud risk' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(api.suspendOrg).toHaveBeenCalledWith('o1', expect.objectContaining({ reason: 'fraud risk' })));
  });
});
