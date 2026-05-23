import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  submitTeacherJoinRequest,
  getMyTeacherJoinRequest,
  cancelMyTeacherJoinRequest,
  listPendingTeacherRequests,
  approveTeacherJoinRequest,
  declineTeacherJoinRequest,
  searchOrganizations,
} from './teacherRequests';
import api from './index';

vi.mock('./index');

const mockedApi = api as unknown as {
  post: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  mockedApi.post = vi.fn();
  mockedApi.get = vi.fn();
  mockedApi.delete = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('submitTeacherJoinRequest', () => {
  it('posts inviteCode form', async () => {
    mockedApi.post.mockResolvedValue({
      data: {
        success: true,
        requestId: 'tjr-1',
        orgId: 'org-1',
        orgName: 'SF',
        status: 'pending',
        source: 'invite_code',
      },
    });
    const result = await submitTeacherJoinRequest({ inviteCode: 'ABC123' });
    expect(mockedApi.post).toHaveBeenCalledWith('/teacher-join-requests', {
      inviteCode: 'ABC123',
    });
    expect(result.orgName).toBe('SF');
  });

  it('posts orgId form', async () => {
    mockedApi.post.mockResolvedValue({
      data: {
        success: true,
        requestId: 'tjr-1',
        orgId: 'org-1',
        orgName: 'SF',
        status: 'pending',
        source: 'search',
      },
    });
    await submitTeacherJoinRequest({ orgId: 'org-1' });
    expect(mockedApi.post).toHaveBeenCalledWith('/teacher-join-requests', { orgId: 'org-1' });
  });
});

describe('getMyTeacherJoinRequest', () => {
  it('returns null on 204', async () => {
    mockedApi.get.mockResolvedValue({ status: 204, data: null });
    const result = await getMyTeacherJoinRequest();
    expect(result).toBeNull();
  });

  it('returns request on 200', async () => {
    mockedApi.get.mockResolvedValue({
      status: 200,
      data: {
        requestId: 'tjr-1',
        orgId: 'org-1',
        orgName: 'SF',
        status: 'pending',
        source: 'search',
      },
    });
    const result = await getMyTeacherJoinRequest();
    expect(result?.status).toBe('pending');
  });
});

describe('searchOrganizations', () => {
  it('returns empty array on blank query', async () => {
    const result = await searchOrganizations('   ');
    expect(result).toEqual([]);
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('hits the endpoint with query', async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        success: true,
        results: [
          {
            id: 'org-1',
            name: 'SF Friends',
            city: 'SF',
            state: 'CA',
            school_type: 'k12',
          },
        ],
      },
    });
    const result = await searchOrganizations('SF');
    expect(mockedApi.get).toHaveBeenCalledWith('/organizations/search', { params: { q: 'SF' } });
    expect(result[0].name).toBe('SF Friends');
  });
});

describe('admin actions', () => {
  it('listPendingTeacherRequests returns array', async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        success: true,
        requests: [
          {
            requestId: 'tjr-1',
            uid: 'teacher-99',
            name: 'T',
            email: 't@x.com',
            source: 'search',
            status: 'pending',
            requestedAt: '2026-05-18T00:00:00Z',
          },
        ],
      },
    });
    const result = await listPendingTeacherRequests();
    expect(result).toHaveLength(1);
    expect(result[0].email).toBe('t@x.com');
  });

  it('approveTeacherJoinRequest hits POST', async () => {
    mockedApi.post.mockResolvedValue({
      data: { success: true, requestId: 'tjr-1', membershipId: 'mem-1', status: 'approved' },
    });
    await approveTeacherJoinRequest('tjr-1');
    expect(mockedApi.post).toHaveBeenCalledWith('/teacher-join-requests/tjr-1/approve');
  });

  it('declineTeacherJoinRequest sends reason', async () => {
    mockedApi.post.mockResolvedValue({
      data: { success: true, requestId: 'tjr-1', status: 'declined' },
    });
    await declineTeacherJoinRequest('tjr-1', 'Wrong school');
    expect(mockedApi.post).toHaveBeenCalledWith('/teacher-join-requests/tjr-1/decline', {
      reason: 'Wrong school',
    });
  });

  it('cancelMyTeacherJoinRequest hits DELETE', async () => {
    mockedApi.delete.mockResolvedValue({ data: { success: true } });
    await cancelMyTeacherJoinRequest();
    expect(mockedApi.delete).toHaveBeenCalledWith('/teacher-join-requests/me');
  });
});
