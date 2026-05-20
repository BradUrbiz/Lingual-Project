import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LingualRequestsPage } from './LingualRequestsPage';
import * as api from '@/api/lingualAdmin';

vi.mock('@/api/lingualAdmin');

beforeEach(() => vi.resetAllMocks());

describe('LingualRequestsPage', () => {
  it('lists requests', async () => {
    vi.mocked(api.fetchRequests).mockResolvedValue({
      items: [
        { id: 'r1', schoolName: 'Sunset HS', status: 'pending', requesterEmail: 'a@x.com' },
      ],
      nextCursor: null,
    });
    render(<LingualRequestsPage />);
    await waitFor(() => screen.getByText('Sunset HS'));
  });

  it('opens the detail panel when row clicked', async () => {
    vi.mocked(api.fetchRequests).mockResolvedValue({
      items: [{ id: 'r1', schoolName: 'Sunset HS', status: 'pending' }],
      nextCursor: null,
    });
    vi.mocked(api.fetchRequestDetail).mockResolvedValue({
      id: 'r1', schoolName: 'Sunset HS', status: 'pending',
      preInvitedTeachers: ['a@x.com'],
      attestation: { ipHash: 'h', userAgent: 'ua', attestedAt: null },
      integration: { lms: null, instanceUrl: null },
    } as any);
    render(<LingualRequestsPage />);
    await waitFor(() => screen.getByText('Sunset HS'));
    fireEvent.click(screen.getByText('Sunset HS'));
    await waitFor(() => screen.getByText(/pre-invited teachers/i));
    expect(screen.getByText('a@x.com')).toBeInTheDocument();
  });

  it('approve button calls approveRequest', async () => {
    vi.mocked(api.fetchRequests).mockResolvedValue({
      items: [{ id: 'r1', schoolName: 'Sunset HS', status: 'pending' }],
      nextCursor: null,
    });
    vi.mocked(api.fetchRequestDetail).mockResolvedValue({
      id: 'r1', schoolName: 'Sunset HS', status: 'pending',
      preInvitedTeachers: [],
      attestation: { ipHash: '', userAgent: '', attestedAt: null },
      integration: { lms: null, instanceUrl: null },
    } as any);
    vi.mocked(api.approveRequest).mockResolvedValue({
      requestId: 'r1', createdOrgId: 'o-new', membershipId: 'm', preInviteInvitationIds: [],
    });
    render(<LingualRequestsPage />);
    await waitFor(() => screen.getByText('Sunset HS'));
    fireEvent.click(screen.getByText('Sunset HS'));
    await waitFor(() => screen.getByRole('button', { name: /approve/i }));
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() => expect(api.approveRequest).toHaveBeenCalledWith('r1', { internalNote: undefined }));
  });
});
