import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TeacherStudentDrillDownPage } from '@/pages/TeacherStudentDrillDownPage';
import type { StudentComplianceRecord, StudentDrillDownData } from '@/types';

const getStudentDrillDownMock = vi.fn();
const getStudentComplianceMock = vi.fn();
const updateStudentComplianceMock = vi.fn();

vi.mock('@/api/teacher', () => ({
  getStudentDrillDown: (...args: unknown[]) => getStudentDrillDownMock(...args),
  getStudentCompliance: (...args: unknown[]) => getStudentComplianceMock(...args),
  updateStudentCompliance: (...args: unknown[]) => updateStudentComplianceMock(...args),
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

describe('TeacherStudentDrillDownPage', () => {
  beforeEach(() => {
    getStudentDrillDownMock.mockReset();
    getStudentComplianceMock.mockReset();
    updateStudentComplianceMock.mockReset();

    getStudentDrillDownMock.mockResolvedValue(ANALYTICS);
    getStudentComplianceMock.mockResolvedValue(COMPLIANCE);
    updateStudentComplianceMock.mockResolvedValue({
      ...COMPLIANCE,
      voiceConsentStatus: 'granted',
      voiceAllowed: true,
    });
  });

  it('renders student analytics and saves voice consent from the compliance editor', async () => {
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
    expect(screen.queryByText('Guardian packet')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Guardian consent')).not.toBeInTheDocument();

    const voiceSelect = screen.getByLabelText('Voice consent');
    fireEvent.change(voiceSelect, { target: { value: 'granted' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save consent state' }));

    await waitFor(() => {
      expect(updateStudentComplianceMock).toHaveBeenCalledWith('class-1', 'student-1', expect.objectContaining({
        voiceConsentStatus: 'granted',
      }));
    });
  });
});
