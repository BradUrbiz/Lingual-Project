import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PendingTeacherRequestsSection } from './PendingTeacherRequestsSection';

const listMock = vi.fn();
const approveMock = vi.fn();
const declineMock = vi.fn();

vi.mock('@/api/teacherRequests', () => ({
    listPendingTeacherRequests: (...a: unknown[]) => listMock(...a),
    approveTeacherJoinRequest: (...a: unknown[]) => approveMock(...a),
    declineTeacherJoinRequest: (...a: unknown[]) => declineMock(...a),
}));

beforeEach(() => {
    listMock.mockReset();
    approveMock.mockReset();
    declineMock.mockReset();
});

describe('PendingTeacherRequestsSection', () => {
    it('renders rows from listPendingTeacherRequests', async () => {
        listMock.mockResolvedValue([
            {
                requestId: 'tjr-1', uid: 'teacher-99',
                name: 'Jane Doe', email: 'jane@x.com',
                source: 'invite_code', status: 'pending',
                requestedAt: '2026-05-18T01:00:00Z',
            },
        ]);
        render(<PendingTeacherRequestsSection />);
        expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
        expect(screen.getByText('jane@x.com')).toBeInTheDocument();
    });

    it('hides section when empty', async () => {
        listMock.mockResolvedValue([]);
        const { container } = render(<PendingTeacherRequestsSection />);
        await waitFor(() => expect(listMock).toHaveBeenCalled());
        expect(container.textContent).not.toMatch(/pending teacher request/i);
    });

    it('approve triggers API + refresh', async () => {
        listMock
            .mockResolvedValueOnce([{
                requestId: 'tjr-1', uid: 'teacher-99', name: 'J', email: 'j@x.com',
                source: 'search', status: 'pending', requestedAt: null,
            }])
            .mockResolvedValueOnce([]);
        approveMock.mockResolvedValue(undefined);
        render(<PendingTeacherRequestsSection />);
        fireEvent.click(await screen.findByRole('button', { name: /approve/i }));
        await waitFor(() => {
            expect(approveMock).toHaveBeenCalledWith('tjr-1');
        });
        await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    });

    it('decline opens modal and submits reason', async () => {
        listMock
            .mockResolvedValueOnce([{
                requestId: 'tjr-1', uid: 'teacher-99', name: 'J', email: 'j@x.com',
                source: 'search', status: 'pending', requestedAt: null,
            }])
            .mockResolvedValueOnce([]);
        declineMock.mockResolvedValue(undefined);
        render(<PendingTeacherRequestsSection />);
        fireEvent.click(await screen.findByRole('button', { name: /decline/i }));
        const reasonInput = await screen.findByLabelText(/reason/i);
        fireEvent.change(reasonInput, { target: { value: 'Wrong school' } });
        fireEvent.click(screen.getByRole('button', { name: /decline request/i }));
        await waitFor(() => {
            expect(declineMock).toHaveBeenCalledWith('tjr-1', 'Wrong school');
        });
    });
});
