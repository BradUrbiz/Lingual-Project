import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchOverview,
  fetchRequests,
  fetchRequestDetail,
  approveRequest,
  declineRequest,
  fetchOrgs,
  fetchOrgDetail,
  fetchOrgMembers,
  fetchOrgClasses,
  fetchOrgAudit,
  suspendOrg,
  restoreOrg,
  removeMember,
} from './lingualAdmin';
import api from './index';

vi.mock('./index', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const mocked = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  mocked.get.mockReset();
  mocked.post.mockReset();
  mocked.delete.mockReset();
});

describe('lingualAdmin API client', () => {
  it('fetchOverview calls GET /lingual-admin/overview', async () => {
    mocked.get.mockResolvedValue({ data: { tiles: {}, recentActivity: [] } });
    await fetchOverview();
    expect(mocked.get).toHaveBeenCalledWith('/lingual-admin/overview');
  });

  it('fetchRequests passes filters as query params', async () => {
    mocked.get.mockResolvedValue({ data: { items: [], nextCursor: null } });
    await fetchRequests({ status: 'pending', schoolType: 'high', sort: 'name' });
    expect(mocked.get).toHaveBeenCalledWith(
      '/lingual-admin/requests',
      expect.objectContaining({
        params: { status: 'pending', schoolType: 'high', sort: 'name' },
      }),
    );
  });

  it('fetchRequests serializes cursor as JSON', async () => {
    mocked.get.mockResolvedValue({ data: { items: [], nextCursor: null } });
    await fetchRequests({
      cursor: { leadingValue: '2026-05-01T12:00:00+00:00', id: 'r1' },
    });
    const call = mocked.get.mock.calls[0];
    expect(call[1].params.cursor).toBe(
      JSON.stringify({ leadingValue: '2026-05-01T12:00:00+00:00', id: 'r1' }),
    );
  });

  it('fetchRequestDetail GETs /lingual-admin/requests/:id', async () => {
    mocked.get.mockResolvedValue({ data: { id: 'r1' } });
    await fetchRequestDetail('r1');
    expect(mocked.get).toHaveBeenCalledWith('/lingual-admin/requests/r1');
  });

  it('approveRequest POSTs with internalNote', async () => {
    mocked.post.mockResolvedValue({ data: {} });
    await approveRequest('r1', { internalNote: 'note' });
    expect(mocked.post).toHaveBeenCalledWith(
      '/lingual-admin/requests/r1/approve',
      { internalNote: 'note' },
    );
  });

  it('declineRequest POSTs reason+category', async () => {
    mocked.post.mockResolvedValue({ data: {} });
    await declineRequest('r1', { reason: 'r', category: 'fraud_risk' });
    expect(mocked.post).toHaveBeenCalledWith(
      '/lingual-admin/requests/r1/decline',
      { reason: 'r', category: 'fraud_risk' },
    );
  });

  it('fetchOrgs serializes cursor as JSON', async () => {
    mocked.get.mockResolvedValue({ data: { items: [], nextCursor: null } });
    await fetchOrgs({ status: 'active', cursor: { nameLower: 'lin', id: 'o1' } });
    const call = mocked.get.mock.calls[0];
    expect(call[1].params.cursor).toBe(
      JSON.stringify({ nameLower: 'lin', id: 'o1' }),
    );
  });

  it('fetchOrgDetail GETs /lingual-admin/organizations/:id', async () => {
    mocked.get.mockResolvedValue({ data: { id: 'o1' } });
    await fetchOrgDetail('o1');
    expect(mocked.get).toHaveBeenCalledWith('/lingual-admin/organizations/o1');
  });

  it('fetchOrgMembers GETs /lingual-admin/organizations/:id/members', async () => {
    mocked.get.mockResolvedValue({ data: { members: [], studentCount: 0 } });
    await fetchOrgMembers('o1');
    expect(mocked.get).toHaveBeenCalledWith(
      '/lingual-admin/organizations/o1/members',
    );
  });

  it('fetchOrgClasses GETs /lingual-admin/organizations/:id/classes', async () => {
    mocked.get.mockResolvedValue({ data: { items: [] } });
    await fetchOrgClasses('o1');
    expect(mocked.get).toHaveBeenCalledWith(
      '/lingual-admin/organizations/o1/classes',
    );
  });

  it('fetchOrgAudit GETs /lingual-admin/organizations/:id/audit with limit', async () => {
    mocked.get.mockResolvedValue({ data: { items: [] } });
    await fetchOrgAudit('o1', 25);
    expect(mocked.get).toHaveBeenCalledWith(
      '/lingual-admin/organizations/o1/audit',
      { params: { limit: 25 } },
    );
  });

  it('suspendOrg POSTs reason+suspendedUntil', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true } });
    await suspendOrg('o1', {
      reason: 'r',
      suspendedUntil: '2026-06-01T00:00:00Z',
    });
    expect(mocked.post).toHaveBeenCalledWith(
      '/lingual-admin/organizations/o1/suspend',
      { reason: 'r', suspendedUntil: '2026-06-01T00:00:00Z' },
    );
  });

  it('restoreOrg POSTs empty body', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true } });
    await restoreOrg('o1');
    expect(mocked.post).toHaveBeenCalledWith(
      '/lingual-admin/organizations/o1/restore',
    );
  });

  it('removeMember DELETEs with reason in body', async () => {
    mocked.delete.mockResolvedValue({ data: { ok: true } });
    await removeMember('o1', 'm1', { reason: 'left school' });
    expect(mocked.delete).toHaveBeenCalledWith(
      '/lingual-admin/organizations/o1/members/m1',
      { data: { reason: 'left school' } },
    );
  });
});
