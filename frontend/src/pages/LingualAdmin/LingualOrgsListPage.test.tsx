import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LingualOrgsListPage } from './LingualOrgsListPage';
import * as api from '@/api/lingualAdmin';

vi.mock('@/api/lingualAdmin');

beforeEach(() => vi.resetAllMocks());

const renderWithRouter = () =>
  render(<MemoryRouter><LingualOrgsListPage /></MemoryRouter>);

describe('LingualOrgsListPage', () => {
  it('lists orgs', async () => {
    vi.mocked(api.fetchOrgs).mockResolvedValue({
      items: [{ id: 'o1', name: 'Sunset HS', status: 'active', memberCount: 2 }],
      nextCursor: null,
    });
    renderWithRouter();
    await waitFor(() => screen.getByText('Sunset HS'));
  });

  it('filters by status', async () => {
    vi.mocked(api.fetchOrgs).mockResolvedValue({ items: [], nextCursor: null });
    renderWithRouter();
    await waitFor(() => expect(api.fetchOrgs).toHaveBeenCalled());
    vi.mocked(api.fetchOrgs).mockClear();
    const select = screen.getByLabelText(/status/i);
    fireEvent.change(select, { target: { value: 'suspended' } });
    await waitFor(() => expect(api.fetchOrgs).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'suspended' }),
    ));
  });

  it('row link points to org detail', async () => {
    vi.mocked(api.fetchOrgs).mockResolvedValue({
      items: [{ id: 'o1', name: 'Sunset HS', status: 'active', memberCount: 2 }],
      nextCursor: null,
    });
    renderWithRouter();
    await waitFor(() => screen.getByText('Sunset HS'));
    const link = screen.getByRole('link', { name: /sunset hs/i });
    expect(link).toHaveAttribute('href', '/lingual-admin/organizations/o1');
  });
});
