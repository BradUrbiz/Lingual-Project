import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { migrateRole } from './auth';
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
