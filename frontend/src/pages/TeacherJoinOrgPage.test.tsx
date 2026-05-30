import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TeacherJoinOrgPage } from './TeacherJoinOrgPage';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return { ...actual, useNavigate: () => navigate };
});

const submitMock = vi.fn();
const searchMock = vi.fn();

vi.mock('@/api/teacherRequests', () => ({
    submitTeacherJoinRequest: (...a: unknown[]) => submitMock(...a),
    searchOrganizations: (...a: unknown[]) => searchMock(...a),
}));

vi.mock('@/hooks/useAuth', () => ({
    useAuth: () => ({ refreshUser: vi.fn() }),
}));

function renderPage() {
    return render(
        <MemoryRouter>
            <TeacherJoinOrgPage />
        </MemoryRouter>
    );
}

beforeEach(() => {
    navigate.mockReset();
    submitMock.mockReset();
    searchMock.mockReset();
});

describe('Pane A - entry', () => {
    it('shows two options', () => {
        renderPage();
        expect(screen.getByRole('button', { name: /invite code/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /find my school/i })).toBeInTheDocument();
    });
});

describe('Pane B - invite code', () => {
    it('submits 6-char code and navigates to pending', async () => {
        submitMock.mockResolvedValue({
            requestId: 'tjr-1', orgId: 'org-1', orgName: 'SF Friends',
            status: 'pending', source: 'invite_code',
        });
        renderPage();
        fireEvent.click(screen.getByRole('button', { name: /invite code/i }));
        const input = screen.getByPlaceholderText(/ABC123/);
        fireEvent.change(input, { target: { value: 'abc123' } });
        fireEvent.click(screen.getByRole('button', { name: /submit code/i }));
        await waitFor(() => {
            expect(submitMock).toHaveBeenCalledWith({ inviteCode: 'ABC123' });
        });
        expect(navigate).toHaveBeenCalledWith('/signup/teacher/pending', { replace: true });
    });

    it('shows error on invalid code', async () => {
        submitMock.mockRejectedValue(new Error('Invalid or expired invite code.'));
        renderPage();
        fireEvent.click(screen.getByRole('button', { name: /invite code/i }));
        fireEvent.change(screen.getByPlaceholderText(/ABC123/), { target: { value: 'XXXXXX' } });
        fireEvent.click(screen.getByRole('button', { name: /submit code/i }));
        await waitFor(() => {
            expect(screen.getByText(/invalid or expired/i)).toBeInTheDocument();
        });
    });
});

describe('Pane C - search', () => {
    it('searches and shows results', async () => {
        searchMock.mockResolvedValue([
            { id: 'org-1', name: 'SF Friends', city: 'SF', state: 'CA', school_type: 'k12' },
        ]);
        renderPage();
        fireEvent.click(screen.getByRole('button', { name: /find my school/i }));
        const input = screen.getByPlaceholderText(/school name/i);
        fireEvent.change(input, { target: { value: 'SF' } });
        await waitFor(() => {
            expect(searchMock).toHaveBeenCalledWith('SF');
        });
        expect(await screen.findByText('SF Friends')).toBeInTheDocument();
    });

    it('submits the selected org and navigates to pending', async () => {
        searchMock.mockResolvedValue([
            { id: 'org-1', name: 'SF Friends', city: 'SF', state: 'CA', school_type: 'k12' },
        ]);
        submitMock.mockResolvedValue({
            requestId: 'tjr-1', orgId: 'org-1', orgName: 'SF Friends',
            status: 'pending', source: 'search',
        });
        renderPage();
        fireEvent.click(screen.getByRole('button', { name: /find my school/i }));
        fireEvent.change(screen.getByPlaceholderText(/school name/i), { target: { value: 'SF' } });
        const result = await screen.findByText('SF Friends');
        fireEvent.click(result);
        // Confirm dialog
        const confirm = await screen.findByRole('button', { name: /confirm/i });
        fireEvent.click(confirm);
        await waitFor(() => {
            expect(submitMock).toHaveBeenCalledWith({ orgId: 'org-1' });
        });
        expect(navigate).toHaveBeenCalledWith('/signup/teacher/pending', { replace: true });
    });

    it('offers admin-wizard pivot for "Can\'t find my school"', () => {
        renderPage();
        fireEvent.click(screen.getByRole('button', { name: /find my school/i }));
        const pivot = screen.getByText(/i'm actually an administrator/i);
        fireEvent.click(pivot);
        expect(navigate).toHaveBeenCalledWith('/signup/admin/org-wizard');
    });
});
