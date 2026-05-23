import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LingualAdminDashboardPage } from './LingualAdminDashboardPage';
import * as api from '@/api/lingualAdmin';

vi.mock('@/api/lingualAdmin');

beforeEach(() => vi.resetAllMocks());

describe('LingualAdminDashboardPage', () => {
  it('renders tile counts after load', async () => {
    vi.mocked(api.fetchOverview).mockResolvedValue({
      tiles: { pendingRequests: 3, activeOrgs: 12, suspendedOrgs: 1, newRequestsLast7d: 4 },
      recentActivity: [],
    });
    render(<LingualAdminDashboardPage />);
    await waitFor(() => screen.getByText('3'));
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('renders activity feed entries', async () => {
    vi.mocked(api.fetchOverview).mockResolvedValue({
      tiles: { pendingRequests: 0, activeOrgs: 0, suspendedOrgs: 0, newRequestsLast7d: 0 },
      recentActivity: [
        {
          id: 'a1', actorUid: 'u', action: 'request_approved',
          target: { type: 'school_request', id: 'r1' }, targetOrgId: 'o1',
          metadata: {}, ipHash: '', userAgent: '', createdAt: null,
        },
      ],
    });
    render(<LingualAdminDashboardPage />);
    await waitFor(() => screen.getByText(/request_approved/i));
  });

  it('shows error state on failure', async () => {
    vi.mocked(api.fetchOverview).mockRejectedValue(new Error('boom'));
    render(<LingualAdminDashboardPage />);
    await waitFor(() => screen.getByText(/failed to load/i));
  });
});
