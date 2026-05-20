import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrgAuditTab } from './OrgAuditTab';
import * as api from '@/api/lingualAdmin';

vi.mock('@/api/lingualAdmin');
beforeEach(() => vi.resetAllMocks());

describe('OrgAuditTab', () => {
  it('renders audit rows', async () => {
    vi.mocked(api.fetchOrgAudit).mockResolvedValue({
      items: [
        {
          id: 'a1', actorUid: 'admin-1', action: 'org_suspended',
          target: { type: 'organization', id: 'o1' }, targetOrgId: 'o1',
          metadata: { reason: 'compliance review' }, ipHash: 'h', userAgent: 'ua', createdAt: '2026-05-20T01:00:00Z',
        },
        {
          id: 'a2', actorUid: 'admin-1', action: 'org_viewed_detail',
          target: { type: 'organization', id: 'o1' }, targetOrgId: 'o1',
          metadata: {}, ipHash: 'h', userAgent: 'ua', createdAt: '2026-05-20T00:50:00Z',
        },
      ],
    });
    render(<OrgAuditTab orgId="o1" />);
    await waitFor(() => screen.getByText('org_suspended'));
    expect(screen.getByText('org_viewed_detail')).toBeInTheDocument();
    expect(screen.getByText(/compliance review/i)).toBeInTheDocument();
  });

  it('shows empty state when there are no entries', async () => {
    vi.mocked(api.fetchOrgAudit).mockResolvedValue({ items: [] });
    render(<OrgAuditTab orgId="o1" />);
    await waitFor(() => screen.getByText(/no audit/i));
  });
});
