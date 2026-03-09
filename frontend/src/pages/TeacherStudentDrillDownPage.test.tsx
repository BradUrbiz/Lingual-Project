import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TeacherStudentDrillDownPage } from '@/pages/TeacherStudentDrillDownPage';
import type { GuardianConsentIssueResult, GuardianConsentPacket, StudentComplianceRecord, StudentDrillDownData } from '@/types';

const getStudentDrillDownMock = vi.fn();
const getStudentComplianceMock = vi.fn();
const getStudentGuardianConsentPacketMock = vi.fn();
const updateStudentComplianceMock = vi.fn();
const issueStudentGuardianConsentPacketMock = vi.fn();
const resendStudentGuardianConsentPacketMock = vi.fn();
const cancelStudentGuardianConsentPacketMock = vi.fn();

vi.mock('@/api/teacher', () => ({
  getStudentDrillDown: (...args: unknown[]) => getStudentDrillDownMock(...args),
  getStudentCompliance: (...args: unknown[]) => getStudentComplianceMock(...args),
  getStudentGuardianConsentPacket: (...args: unknown[]) => getStudentGuardianConsentPacketMock(...args),
  updateStudentCompliance: (...args: unknown[]) => updateStudentComplianceMock(...args),
  issueStudentGuardianConsentPacket: (...args: unknown[]) => issueStudentGuardianConsentPacketMock(...args),
  resendStudentGuardianConsentPacket: (...args: unknown[]) => resendStudentGuardianConsentPacketMock(...args),
  cancelStudentGuardianConsentPacket: (...args: unknown[]) => cancelStudentGuardianConsentPacketMock(...args),
}));

const ANALYTICS: StudentDrillDownData = {
  student: {
    uid: 'student-1',
    displayName: 'Student One',
    email: 'student.one@example.org',
  },
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
    sessionCount: 2,
    completedSessionCount: 2,
    activeSessionCount: 0,
    uniqueStudentCount: 1,
    totalStudentTurns: 16,
    totalStudentWords: 140,
    averageStudentWordsPerTurn: 8.75,
    estimatedSpeakingTimeSeconds: 420,
    selfCorrectionCount: 3,
    taskCompletionCount: 2,
    repeatedErrorCount: 1,
    feedbackCounts: {
      recast: 1,
      elicitation: 1,
      reviewItem: 1,
    },
  },
  assignments: [],
  repeatedErrors: [],
  recentSessions: [],
  limitations: [],
};

const COMPLIANCE: StudentComplianceRecord = {
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
  lastVerifiedAt: '2026-03-09T12:00:00Z',
};

const ISSUED_PACKET: GuardianConsentPacket = {
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
  responseMethod: '',
  evidenceRef: '',
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
};

const ISSUE_RESULT: GuardianConsentIssueResult = {
  guardianPacket: ISSUED_PACKET,
  deliveryToken: 'token-abc',
};

describe('TeacherStudentDrillDownPage', () => {
  beforeEach(() => {
    getStudentDrillDownMock.mockReset();
    getStudentComplianceMock.mockReset();
    getStudentGuardianConsentPacketMock.mockReset();
    updateStudentComplianceMock.mockReset();
    issueStudentGuardianConsentPacketMock.mockReset();
    resendStudentGuardianConsentPacketMock.mockReset();
    cancelStudentGuardianConsentPacketMock.mockReset();

    getStudentDrillDownMock.mockResolvedValue(ANALYTICS);
    getStudentComplianceMock.mockResolvedValue(COMPLIANCE);
    getStudentGuardianConsentPacketMock.mockResolvedValue(null);
    updateStudentComplianceMock.mockResolvedValue(COMPLIANCE);
    issueStudentGuardianConsentPacketMock.mockResolvedValue(ISSUE_RESULT);
    resendStudentGuardianConsentPacketMock.mockResolvedValue(ISSUE_RESULT);
    cancelStudentGuardianConsentPacketMock.mockResolvedValue({
      ...ISSUED_PACKET,
      status: 'canceled',
      canResend: false,
      canCancel: false,
      isTerminal: true,
    });
  });

  it('issues a guardian packet from the student drill-down view', async () => {
    render(
      <MemoryRouter initialEntries={['/app/teacher/classes/class-1/students/student-1/analytics']}>
        <Routes>
          <Route
            path="/app/teacher/classes/:classId/students/:studentUid/analytics"
            element={<TeacherStudentDrillDownPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Student One')).toBeInTheDocument();
    expect(await screen.findByText('Guardian packet')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Contact destination hint'), {
      target: { value: 'parent@example.org' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Issue guardian packet' }));

    await waitFor(() => {
      expect(issueStudentGuardianConsentPacketMock).toHaveBeenCalledWith('class-1', 'student-1', {
        deliveryMethod: 'secure_link',
        contactChannel: 'email',
        contactDestinationHint: 'parent@example.org',
        noticeVersion: 'guardian_beta_v1',
      });
    });

    expect(await screen.findByText('Latest secure link')).toBeInTheDocument();
    expect(screen.getByDisplayValue(/token-abc$/)).toBeInTheDocument();
  });
});
