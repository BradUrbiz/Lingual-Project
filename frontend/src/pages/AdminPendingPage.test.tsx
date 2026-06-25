import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminPendingPage } from './AdminPendingPage';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const getMineMock = vi.fn();
const cancelMineMock = vi.fn();
const refreshUserMock = vi.fn();

vi.mock('@/api/schoolRequests', () => ({
  getMySchoolRequest: (...args: unknown[]) => getMineMock(...args),
  cancelMySchoolRequest: (...args: unknown[]) => cancelMineMock(...args),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { uid: 'uid-1', email: 'ada@ssfs.org', name: 'Ada' },
    refreshUser: (...args: unknown[]) => refreshUserMock(...args),
  }),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

function renderPage() {
  return render(<MemoryRouter><AdminPendingPage /></MemoryRouter>);
}

describe('AdminPendingPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    getMineMock.mockReset();
    cancelMineMock.mockReset().mockResolvedValue(undefined);
    refreshUserMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the pending state with the school name', async () => {
    getMineMock.mockResolvedValue({
      id: 'r1', status: 'pending', schoolName: 'SF Friends',
      requesterEmail: 'ada@ssfs.org',
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('admin.pending.awaiting.title')).toBeInTheDocument());
    expect(screen.getByText('admin.pending.awaiting.title')).toBeInTheDocument();
  });

  it('does not offer edit while the request is still pending', async () => {
    getMineMock.mockResolvedValue({
      id: 'r1', status: 'pending', schoolName: 'SF Friends',
      requesterEmail: 'ada@ssfs.org',
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('admin.pending.awaiting.title')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /edit request/i })).not.toBeInTheDocument();
    expect(screen.getByText('admin.pending.awaiting.changeDetails')).toBeInTheDocument();
  });

  it('redirects to the wizard when no request exists', async () => {
    getMineMock.mockResolvedValue(null);
    renderPage();
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/signup/admin/org-wizard', expect.anything()),
    );
  });

  it('refreshes user then redirects to /app/admin when status becomes approved', async () => {
    vi.useFakeTimers();
    getMineMock
      .mockResolvedValueOnce({ id: 'r1', status: 'pending', schoolName: 'SF Friends' })
      .mockResolvedValueOnce({ id: 'r1', status: 'approved', schoolName: 'SF Friends' });
    renderPage();
    // Flush the initial render promise so the component mounts with 'pending'.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // Advance past the 30s poll interval - this triggers the second getMySchoolRequest
    // which returns 'approved', then refreshUser(), then navigate(SCHOOL_ADMIN_HOME_ROUTE).
    await act(async () => { vi.advanceTimersByTime(31000); });
    // Flush the async chain (getMySchoolRequest → setReq → refreshUser → navigate).
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    // Switch back to real timers so waitFor can poll normally.
    vi.useRealTimers();
    await waitFor(() => expect(refreshUserMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/app/admin', expect.anything()),
    );
    // refreshUser must be called before navigate so the protected route sees
    // the new membership and onboarding_state.
    const refreshOrder = refreshUserMock.mock.invocationCallOrder[0];
    const adminCall = navigateMock.mock.calls.findIndex(
      (c) => c[0] === '/app/admin',
    );
    const navigateOrder = navigateMock.mock.invocationCallOrder[adminCall];
    expect(refreshOrder).toBeLessThan(navigateOrder);
  });

  it('shows decline reason when rejected', async () => {
    getMineMock.mockResolvedValue({
      id: 'r1', status: 'rejected', schoolName: 'SF Friends',
      rejectionReason: 'Website not reachable.',
      rejectionCategory: 'info_missing',
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Website not reachable/)).toBeInTheDocument());
  });

  it('cancels the request and navigates to the wizard', async () => {
    getMineMock.mockResolvedValue({
      id: 'r1', status: 'pending', schoolName: 'SF Friends',
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('admin.pending.awaiting.title')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'admin.pending.awaiting.cancelRequest' }));
    await waitFor(() => expect(cancelMineMock).toHaveBeenCalled());
    expect(navigateMock).toHaveBeenCalledWith('/signup/admin/org-wizard', expect.anything());
  });
});
