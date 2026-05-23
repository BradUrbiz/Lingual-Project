import { describe, it, expect, vi, beforeEach } from 'vitest';
import api from './index';
import {
  getSchoolRequestDraft,
  saveSchoolRequestDraft,
  cancelMySchoolRequest,
  submitSchoolRequest,
  rejectSchoolRequest,
} from './schoolRequests';

vi.mock('./index', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mocked = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

describe('schoolRequests api', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
    mocked.delete.mockReset();
  });

  it('getSchoolRequestDraft GETs /school-requests/draft', async () => {
    mocked.get.mockResolvedValue({ data: { success: true, draft: null } });
    const out = await getSchoolRequestDraft();
    expect(mocked.get).toHaveBeenCalledWith('/school-requests/draft');
    expect(out).toBeNull();
  });

  it('saveSchoolRequestDraft PATCHes with the wizard step + payload', async () => {
    mocked.patch.mockResolvedValue({ data: { success: true } });
    await saveSchoolRequestDraft({
      currentStep: 2,
      draftPayload: { schoolName: 'SF Friends' },
    });
    expect(mocked.patch).toHaveBeenCalledWith('/school-requests/draft', {
      currentStep: 2,
      draftPayload: { schoolName: 'SF Friends' },
    });
  });

  it('cancelMySchoolRequest DELETEs /school-requests/mine', async () => {
    mocked.delete.mockResolvedValue({ data: { success: true } });
    await cancelMySchoolRequest();
    expect(mocked.delete).toHaveBeenCalledWith('/school-requests/mine');
  });

  it('submitSchoolRequest POSTs the full wizard payload', async () => {
    mocked.post.mockResolvedValue({
      data: { success: true, request: { id: 'r1', schoolName: 'SF Friends' } },
    });
    const req = await submitSchoolRequest({
      schoolName: 'SF Friends',
      orgType: 'school',
      websiteUrl: 'https://ssfs.org',
      location: { country: 'US', state: 'CA' },
      schoolType: 'k12',
      publicPrivate: 'private',
      gradeSize: '50-100',
      adminIdentity: {
        fullName: 'Ada', schoolEmail: 'ada@ssfs.org',
        roleTitle: 'Principal', authorizationAttested: true,
      },
    });
    expect(mocked.post).toHaveBeenCalledWith('/school-requests', expect.objectContaining({
      schoolName: 'SF Friends',
      schoolType: 'k12',
    }));
    expect(req.id).toBe('r1');
  });

  it('rejectSchoolRequest forwards the required reason and category', async () => {
    mocked.post.mockResolvedValue({ data: { success: true, request: { id: 'r2' } } });
    await rejectSchoolRequest('r2', 'Need more info', 'info_missing');
    expect(mocked.post).toHaveBeenCalledWith(
      '/admin/school-requests/r2/reject',
      { reason: 'Need more info', category: 'info_missing' },
    );
  });
});
