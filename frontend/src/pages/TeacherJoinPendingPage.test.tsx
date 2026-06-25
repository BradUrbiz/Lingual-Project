import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TeacherJoinPendingPage } from './TeacherJoinPendingPage';

vi.mock('@/contexts/LanguageContext', () => ({
    useLanguage: () => ({
        language: 'en',
        t: (key: string) => key,
    }),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return { ...actual, useNavigate: () => navigate };
});

const getMyMock = vi.fn();
const cancelMyMock = vi.fn();
const refreshUserMock = vi.fn();

vi.mock('@/api/teacherRequests', () => ({
    getMyTeacherJoinRequest: (...a: unknown[]) => getMyMock(...a),
    cancelMyTeacherJoinRequest: (...a: unknown[]) => cancelMyMock(...a),
}));

vi.mock('@/hooks/useAuth', () => ({
    useAuth: () => ({ refreshUser: refreshUserMock }),
}));

beforeEach(() => {
    vi.useFakeTimers();
    navigate.mockReset();
    getMyMock.mockReset();
    cancelMyMock.mockReset();
    refreshUserMock.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
});

function renderPage() {
    return render(
        <MemoryRouter>
            <TeacherJoinPendingPage />
        </MemoryRouter>,
    );
}

describe('TeacherJoinPendingPage', () => {
    it('shows pending state', async () => {
        getMyMock.mockResolvedValue({
            requestId: 'tjr-1', orgId: 'org-1', orgName: 'SF Friends',
            status: 'pending', source: 'search',
        });
        renderPage();
        await waitFor(() => expect(getMyMock).toHaveBeenCalled());
        // With i18n mock (t: key => key), heading and subtitle text are keys.
        expect(await screen.findByText('teacher.joinPending.pending.title')).toBeInTheDocument();
        expect(screen.getByText('teacher.joinPending.pending.subtitle')).toBeInTheDocument();
    });

    it('polls every 30 seconds', async () => {
        getMyMock.mockResolvedValue({
            requestId: 'tjr-1', orgId: 'org-1', orgName: 'SF Friends',
            status: 'pending', source: 'search',
        });
        renderPage();
        await waitFor(() => expect(getMyMock).toHaveBeenCalledTimes(1));
        await act(async () => { vi.advanceTimersByTime(30_000); });
        await waitFor(() => expect(getMyMock).toHaveBeenCalledTimes(2));
    });

    it('navigates to dashboard when request clears', async () => {
        getMyMock.mockResolvedValueOnce({
            requestId: 'tjr-1', orgId: 'org-1', orgName: 'SF Friends',
            status: 'pending', source: 'search',
        });
        getMyMock.mockResolvedValueOnce(null);  // status=approved → cleared
        renderPage();
        await waitFor(() => expect(getMyMock).toHaveBeenCalledTimes(1));
        await act(async () => { vi.advanceTimersByTime(30_000); });
        await waitFor(() => expect(refreshUserMock).toHaveBeenCalled());
        expect(navigate).toHaveBeenCalledWith('/app/teacher', { replace: true });
    });

    it('navigates to dashboard when polling returns approved', async () => {
        getMyMock.mockResolvedValue({
            requestId: 'tjr-1', orgId: 'org-1', orgName: 'SF Friends',
            status: 'approved', source: 'search',
        });
        renderPage();
        await waitFor(() => expect(refreshUserMock).toHaveBeenCalled());
        expect(navigate).toHaveBeenCalledWith('/app/teacher', { replace: true });
    });

    it('retries dashboard navigation when auth refresh fails once', async () => {
        getMyMock.mockResolvedValueOnce({
            requestId: 'tjr-1', orgId: 'org-1', orgName: 'SF Friends',
            status: 'pending', source: 'search',
        });
        getMyMock.mockResolvedValue({
            requestId: 'tjr-1', orgId: 'org-1', orgName: 'SF Friends',
            status: 'approved', source: 'search',
        });
        refreshUserMock
            .mockRejectedValueOnce(new Error('refresh failed'))
            .mockResolvedValueOnce(undefined);

        renderPage();
        await waitFor(() => expect(getMyMock).toHaveBeenCalledTimes(1));

        await act(async () => { vi.advanceTimersByTime(30_000); });
        await waitFor(() => expect(refreshUserMock).toHaveBeenCalledTimes(1));
        expect(navigate).not.toHaveBeenCalled();

        await act(async () => { vi.advanceTimersByTime(30_000); });
        await waitFor(() => expect(refreshUserMock).toHaveBeenCalledTimes(2));
        expect(navigate).toHaveBeenCalledWith('/app/teacher', { replace: true });
    });

    it('cancel button calls cancelMyTeacherJoinRequest and routes back', async () => {
        getMyMock.mockResolvedValue({
            requestId: 'tjr-1', orgId: 'org-1', orgName: 'SF Friends',
            status: 'pending', source: 'search',
        });
        cancelMyMock.mockResolvedValue(undefined);
        renderPage();
        // With i18n mock (t: key => key), button text is the key.
        const cancelBtn = await screen.findByRole('button', { name: 'teacher.joinPending.pending.cancelRequest' });
        fireEvent.click(cancelBtn);
        await waitFor(() => expect(cancelMyMock).toHaveBeenCalled());
        expect(navigate).toHaveBeenCalledWith('/signup/teacher/join-org', { replace: true });
    });
});
