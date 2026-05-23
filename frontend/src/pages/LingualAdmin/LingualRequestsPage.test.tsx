import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LingualRequestsPage } from './LingualRequestsPage';
import * as api from '@/api/lingualAdmin';
import type { SchoolRequestDetail } from '@/types/lingualAdmin';

vi.mock('@/api/lingualAdmin');

beforeEach(() => vi.resetAllMocks());

// Real wire shape produced by `_serialize_request` in
// `backend/routes/school_requests.py`: location is nested, attestation lives
// under `adminIdentity.authorizationAttestation`, integration is canvas-shaped.
function makeDetail(overrides: Partial<SchoolRequestDetail> = {}): SchoolRequestDetail {
  return {
    id: 'r1',
    schoolName: 'Sunset HS',
    status: 'pending',
    preInvitedTeachers: ['a@x.com'],
    location: { country: 'US', state: 'CA', county: 'San Mateo' },
    adminIdentity: {
      fullName: 'Admin R',
      schoolEmail: 'admin@sunset.edu',
      authorizationAttestation: {
        confirmedAt: '2026-05-01T00:00:00Z',
        ipHash: 'abc123',
        userAgent: 'Mozilla/5.0 (Macintosh)',
      },
    },
    integration: { canvasUrl: null, canvasIntegrationTypes: [] },
    ...overrides,
  };
}

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
    vi.mocked(api.fetchRequestDetail).mockResolvedValue(makeDetail());
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
    vi.mocked(api.fetchRequestDetail).mockResolvedValue(
      makeDetail({ preInvitedTeachers: [] })
    );
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

  // Regression: prior to the P1 #2 fix, the detail panel read flat
  // `request.attestation.ipHash` and `request.county/state/country`. The real
  // API response nests those under `adminIdentity.authorizationAttestation`
  // and `location`. The pre-fix code threw
  // `TypeError: Cannot read properties of undefined (reading 'ipHash')`,
  // crashing the panel and blocking approve/decline.
  it('renders nested DTO without crash (P1 #2 regression)', async () => {
    vi.mocked(api.fetchRequests).mockResolvedValue({
      items: [{ id: 'r1', schoolName: 'Sunset HS', status: 'pending' }],
      nextCursor: null,
    });
    vi.mocked(api.fetchRequestDetail).mockResolvedValue(makeDetail());
    render(<LingualRequestsPage />);
    await waitFor(() => screen.getByText('Sunset HS'));
    fireEvent.click(screen.getByText('Sunset HS'));

    // ipHash from the nested DTO is rendered
    await waitFor(() => expect(screen.getByText(/abc123/)).toBeInTheDocument());

    // Location concatenated from nested fields
    expect(screen.getByText('San Mateo, CA, US')).toBeInTheDocument();

    // Both action buttons present (would not be if the dl threw above them)
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /decline/i })).toBeInTheDocument();
  });

  it('shows the full wizard payload before approval', async () => {
    vi.mocked(api.fetchRequests).mockResolvedValue({
      items: [{ id: 'r1', schoolName: 'Sunset HS', status: 'pending' }],
      nextCursor: null,
    });
    vi.mocked(api.fetchRequestDetail).mockResolvedValue(makeDetail({
      orgType: 'school',
      schoolType: 'high',
      publicPrivate: 'public',
      gradeSize: '200-500' as never,
      officialEmailDomains: ['sunset.edu', 'students.sunset.edu'],
      adminIdentity: {
        fullName: 'Admin R',
        schoolEmail: 'admin@sunset.edu',
        roleTitle: 'Principal',
        authorizationAttestation: {
          confirmedAt: '2026-05-01T00:00:00Z',
          ipHash: 'abc123',
          userAgent: 'Mozilla/5.0 (Macintosh)',
        },
      },
      integration: {
        canvasUrl: 'https://canvas.sunset.edu',
        canvasIntegrationTypes: ['lti13', 'roster_sync'],
      },
      curriculum: {
        gradeRanges: ['g9_12'],
        languagesTaught: ['es', 'fr'],
        courseFrameworks: ['ap'],
      },
    }));
    render(<LingualRequestsPage />);
    await waitFor(() => screen.getByText('Sunset HS'));
    fireEvent.click(screen.getByText('Sunset HS'));

    await waitFor(() => screen.getByText('Admin R'));
    expect(screen.getByText('admin@sunset.edu')).toBeInTheDocument();
    expect(screen.getByText('Principal')).toBeInTheDocument();
    expect(screen.getByText('public')).toBeInTheDocument();
    expect(screen.getByText('200-500')).toBeInTheDocument();
    expect(screen.getByText('sunset.edu, students.sunset.edu')).toBeInTheDocument();
    expect(screen.getByText('https://canvas.sunset.edu')).toBeInTheDocument();
    expect(screen.getByText('lti13, roster_sync')).toBeInTheDocument();
    expect(screen.getByText('g9_12')).toBeInTheDocument();
    expect(screen.getByText('es, fr')).toBeInTheDocument();
    expect(screen.getByText('ap')).toBeInTheDocument();
  });

  it('renders gracefully when nested fields missing', async () => {
    // Defensive: a request submitted by a legacy path may have no
    // adminIdentity / no location. Panel should still render with em-dashes.
    vi.mocked(api.fetchRequests).mockResolvedValue({
      items: [{ id: 'r1', schoolName: 'Sunset HS', status: 'pending' }],
      nextCursor: null,
    });
    vi.mocked(api.fetchRequestDetail).mockResolvedValue({
      id: 'r1',
      schoolName: 'Sunset HS',
      status: 'pending',
      preInvitedTeachers: [],
    });
    render(<LingualRequestsPage />);
    await waitFor(() => screen.getByText('Sunset HS'));
    fireEvent.click(screen.getByText('Sunset HS'));
    await waitFor(() => screen.getByText(/pre-invited teachers/i));
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
  });
});
