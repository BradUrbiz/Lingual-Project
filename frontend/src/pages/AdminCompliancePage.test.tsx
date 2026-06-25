import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminCompliancePage } from './AdminCompliancePage';
import {
  exportOrgComplianceAudit,
  getOrgComplianceRoster,
  getOrgGuardianPackets,
} from '@/api/admin';
import type { MembershipSummary, OrgComplianceRosterData } from '@/types';

const membershipState = vi.hoisted(() => ({
  activeMembership: {
    id: 'mem-teacher',
    orgId: 'org-1',
    orgName: 'Pilot School',
    roles: ['teacher'],
    status: 'active',
  } as MembershipSummary,
}));

vi.mock('@/api/admin', () => ({
  bulkUpdateOrgCompliance: vi.fn(),
  exportOrgComplianceAudit: vi.fn(),
  getOrgComplianceRoster: vi.fn(),
  getOrgGuardianPackets: vi.fn(),
}));

vi.mock('@/contexts/MembershipContext', () => ({
  useMembership: () => ({
    activeMembership: membershipState.activeMembership,
  }),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const rosterFixture: OrgComplianceRosterData = {
  summary: {
    studentCount: 1,
    voiceAllowedCount: 1,
    voiceBlockedCount: 0,
    guardianActionRequiredCount: 0,
    unknownConsentCount: 0,
    rawAudioRestrictedCount: 0,
    textBlockedCount: 0,
  },
  students: [
    {
      uid: 'student-1',
      displayName: 'Student One',
      classIds: ['class-1', 'class-2'],
      classNames: ['Korean 1', 'Korean 2'],
      blockedReasons: [],
      compliance: {
        id: 'record-1',
        orgId: 'org-1',
        studentUid: 'student-1',
        isMinor: false,
        guardianConsentStatus: 'not_required',
        voiceConsentStatus: 'granted',
        textAllowed: true,
        voiceAllowed: true,
        retentionPolicyId: 'standard_school',
        retentionPolicy: {
          id: 'standard_school',
          label: 'Standard school retention',
          rawAudioStorageAllowed: true,
        },
      },
    },
  ],
};

describe('AdminCompliancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    membershipState.activeMembership = {
      id: 'mem-teacher',
      orgId: 'org-1',
      orgName: 'Pilot School',
      roles: ['teacher'],
      status: 'active',
    };
    vi.mocked(getOrgComplianceRoster).mockResolvedValue(rosterFixture);
    vi.mocked(getOrgGuardianPackets).mockResolvedValue({
      packets: [],
      statusCounts: {},
      totalCount: 0,
    });
  });

  it('does not call admin compliance APIs when the active membership is not school_admin', async () => {
    render(
      <MemoryRouter>
        <AdminCompliancePage />
      </MemoryRouter>,
    );

    expect(
      screen.getByText('admin.compliance.accessDenied'),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(getOrgComplianceRoster).not.toHaveBeenCalled();
      expect(getOrgGuardianPackets).not.toHaveBeenCalled();
      expect(exportOrgComplianceAudit).not.toHaveBeenCalled();
    });
  });

  it('gives roster filter selects accessible names', async () => {
    membershipState.activeMembership = {
      id: 'mem-admin',
      orgId: 'org-1',
      orgName: 'Pilot School',
      roles: ['school_admin'],
      status: 'active',
    };

    render(
      <MemoryRouter>
        <AdminCompliancePage />
      </MemoryRouter>,
    );

    await screen.findByText('admin.compliance.metric.totalStudents');
    fireEvent.click(screen.getByRole('button', { name: 'admin.compliance.tab.roster' }));
    await screen.findByText('Student One');

    expect(screen.getByRole('combobox', { name: 'admin.compliance.filter.consentStatusAriaLabel' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'admin.compliance.filter.classAriaLabel' })).toBeInTheDocument();
  });
});
