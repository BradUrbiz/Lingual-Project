import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { migrateRole, confirmEmailVerification, resendEmailVerification } from './auth';
import api from './index';

vi.mock('./index');

const mockedApi = api as unknown as {
  post: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  mockedApi.post = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('email verification api', () => {
  it('posts the code to confirm and returns the body', async () => {
    mockedApi.post.mockResolvedValue({ data: { success: true } });
    const res = await confirmEmailVerification('123456');
    expect(mockedApi.post).toHaveBeenCalledWith(
      '/auth/email-verification/confirm',
      { code: '123456' },
      { validateStatus: expect.any(Function) },
    );
    expect(res.success).toBe(true);
  });

  it('returns the body (does not throw) on a failure status', async () => {
    mockedApi.post.mockResolvedValue({ data: { success: false, error: 'invalid_code' } });
    const res = await confirmEmailVerification('000000');
    expect(res.error).toBe('invalid_code');
  });

  it('posts to resend and returns cooldown', async () => {
    mockedApi.post.mockResolvedValue({ data: { success: true, cooldownSeconds: 60 } });
    const res = await resendEmailVerification();
    expect(mockedApi.post).toHaveBeenCalledWith(
      '/auth/email-verification/resend',
      {},
      { validateStatus: expect.any(Function) },
    );
    expect(res.cooldownSeconds).toBe(60);
  });
});

describe('migrateRole', () => {
  it('POSTs to /auth/migrate-role with role and returns parsed body', async () => {
    mockedApi.post.mockResolvedValue({
      data: { intendedRole: 'student', onboardingState: 'complete' },
    });
    const result = await migrateRole('student');
    expect(mockedApi.post).toHaveBeenCalledWith('/auth/migrate-role', { role: 'student' });
    expect(result.intendedRole).toBe('student');
    expect(result.onboardingState).toBe('complete');
  });

  it('passes through teacher', async () => {
    mockedApi.post.mockResolvedValue({
      data: { intendedRole: 'teacher', onboardingState: 'role_selected' },
    });
    await migrateRole('teacher');
    expect(mockedApi.post).toHaveBeenLastCalledWith('/auth/migrate-role', { role: 'teacher' });
  });

  it('passes through admin', async () => {
    mockedApi.post.mockResolvedValue({
      data: { intendedRole: 'admin', onboardingState: 'role_selected' },
    });
    await migrateRole('admin');
    expect(mockedApi.post).toHaveBeenLastCalledWith('/auth/migrate-role', { role: 'admin' });
  });
});
