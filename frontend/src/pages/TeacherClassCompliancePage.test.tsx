import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TeacherClassCompliancePage } from '@/pages/TeacherClassCompliancePage';
import type { ClassComplianceRosterData } from '@/types';

const navigateMock = vi.fn();
const getClassComplianceRosterMock = vi.fn();
const bulkUpdateClassComplianceMock = vi.fn();
const downloadClassComplianceAuditExportMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ classId: 'class-1' }),
  };
});

vi.mock('@/api/teacher', () => ({
  getClassComplianceRoster: (...args: unknown[]) => getClassComplianceRosterMock(...args),
  bulkUpdateClassCompliance: (...args: unknown[]) => bulkUpdateClassComplianceMock(...args),
  downloadClassComplianceAuditExport: (...args: unknown[]) => downloadClassComplianceAuditExportMock(...args),
}));

const ROSTER: ClassComplianceRosterData = {
  class: {
    id: 'class-1',
    orgId: 'org-1',
    name: 'French 2 - Period 3',
    subject: 'French',
    term: 'Spring 2026',
    learningLocale: 'fr-FR',
    gradeBand: '10-11',
    status: 'active',
  },
  summary: {
    studentCount: 2,
    voiceAllowedCount: 1,
    voiceBlockedCount: 1,
    guardianActionRequiredCount: 1,
    unknownConsentCount: 1,
    rawAudioRestrictedCount: 1,
    textBlockedCount: 0,
  },
  students: [
    {
      uid: 'student-1',
      displayName: 'Student One',
      studentNumber: 'A001',
      guardianContactRequired: true,
      guardianPacket: {
        id: 'packet-1',
        orgId: 'org-1',
        classId: 'class-1',
        studentUid: 'student-1',
        noticeVersion: 'guardian_beta_v1',
        consentScope: 'voice_school_beta',
        contactChannel: 'email',
        contactDestinationHint: 'parent@example.org',
        deliveryMethod: 'secure_link',
        status: 'issued',
        tokenLastFour: 'cdef',
        reminderCount: 0,
        expiresAt: '2026-03-23T12:00:00Z',
        issuedAt: '2026-03-09T12:00:00Z',
        lastSentAt: '2026-03-09T12:00:00Z',
        actedAt: null,
        createdByUid: 'teacher-1',
        createdAt: '2026-03-09T12:00:00Z',
        updatedAt: '2026-03-09T12:00:00Z',
        canResend: true,
        canCancel: true,
        isTerminal: false,
      },
      compliance: {
        id: 'org-1_student-1',
        orgId: 'org-1',
        studentUid: 'student-1',
        isMinor: true,
        guardianConsentStatus: 'unknown',
        voiceConsentStatus: 'unknown',
        textAllowed: true,
        voiceAllowed: false,
        retentionPolicyId: 'standard_school',
        retentionPolicy: {
          id: 'standard_school',
          label: 'Standard school retention',
          rawAudioStorageAllowed: true,
          rawAudioRetentionDays: 30,
          transcriptRetentionDays: 365,
          analyticsRetentionDays: 730,
        },
      },
      blockedReasons: [
        'Guardian consent is required before voice practice can start.',
        'Voice consent has not been granted for this student.',
      ],
    },
    {
      uid: 'student-2',
      displayName: 'Student Two',
      studentNumber: 'A002',
      guardianContactRequired: false,
      guardianPacket: null,
      compliance: {
        id: 'org-1_student-2',
        orgId: 'org-1',
        studentUid: 'student-2',
        isMinor: false,
        guardianConsentStatus: 'not_required',
        voiceConsentStatus: 'granted',
        textAllowed: true,
        voiceAllowed: true,
        retentionPolicyId: 'no_raw_audio',
        retentionPolicy: {
          id: 'no_raw_audio',
          label: 'No raw audio retention',
          rawAudioStorageAllowed: false,
          rawAudioRetentionDays: 0,
          transcriptRetentionDays: 365,
          analyticsRetentionDays: 730,
        },
      },
      blockedReasons: [],
    },
  ],
  limitations: [
    'Beta operations are class-scoped. Guardian packet delivery and deletion execution remain admin-assisted follow-up work.',
  ],
};

describe('TeacherClassCompliancePage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    getClassComplianceRosterMock.mockReset();
    bulkUpdateClassComplianceMock.mockReset();
    downloadClassComplianceAuditExportMock.mockReset();

    getClassComplianceRosterMock.mockResolvedValue(ROSTER);
    bulkUpdateClassComplianceMock.mockResolvedValue({
      batchId: 'batch-1',
      updatedCount: 1,
      studentUids: ['student-1'],
    });
    downloadClassComplianceAuditExportMock.mockResolvedValue(undefined);
  });

  it('renders class compliance data and submits a bulk update', async () => {
    render(<TeacherClassCompliancePage />);

    expect(await screen.findByText('French 2 - Period 3')).toBeInTheDocument();
    expect(screen.getByText('Student One')).toBeInTheDocument();
    expect(screen.getByText('Student Two')).toBeInTheDocument();
    expect(screen.getByText('Packet issued')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.change(screen.getByLabelText('Voice consent'), {
      target: { value: 'granted' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply to selected students' }));

    await waitFor(() => {
      expect(bulkUpdateClassComplianceMock).toHaveBeenCalledWith('class-1', {
        studentUids: ['student-1'],
        updates: { voiceConsentStatus: 'granted' },
        reason: undefined,
      });
    });

    expect(getClassComplianceRosterMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Updated 1 student records.')).toBeInTheDocument();
  });

  it('downloads the audit export from the class page', async () => {
    render(<TeacherClassCompliancePage />);

    expect(await screen.findByText('Class compliance roster')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export audit CSV' }));

    await waitFor(() => {
      expect(downloadClassComplianceAuditExportMock).toHaveBeenCalledWith('class-1');
    });
  });
});
