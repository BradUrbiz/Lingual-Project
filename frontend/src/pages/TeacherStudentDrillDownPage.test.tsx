import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TeacherStudentDrillDownPage } from '@/pages/TeacherStudentDrillDownPage';
import type { PracticeSessionDto, StudentComplianceRecord, StudentDrillDownData } from '@/types';

const getStudentDrillDownMock = vi.fn();
const getStudentComplianceMock = vi.fn();
const updateStudentComplianceMock = vi.fn();

vi.mock('@/api/teacher', () => ({
  getStudentDrillDown: (...args: unknown[]) => getStudentDrillDownMock(...args),
  getStudentCompliance: (...args: unknown[]) => getStudentComplianceMock(...args),
  updateStudentCompliance: (...args: unknown[]) => updateStudentComplianceMock(...args),
}));

const MOCK_SESSION: PracticeSessionDto = {
  id: 'session-abc',
  orgId: 'org-1',
  classId: 'class-1',
  assignmentId: 'assignment-1',
  studentUid: 'student-1',
  status: 'completed',
  modality: 'text',
  voiceEnabled: false,
  textEnabled: true,
  promptVersion: '1',
  sessionSummary: {
    totalTurns: 10,
    studentTurnCount: 5,
    assistantTurnCount: 5,
    totalStudentWords: 40,
    averageStudentWordsPerTurn: 8,
    estimatedSpeakingTimeSeconds: 0,
    targetExpressionHits: {},
    targetExpressionTotalHits: 0,
    selfCorrectionCount: 1,
    taskCompletionCount: 1,
    feedbackCounts: { recast: 0, elicitation: 0, reviewItem: 0 },
  },
  costSummary: { estimatedUsd: 0, estimatedVoiceSeconds: 0, estimatedTextTurns: 5 },
};

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

  it('shows "View debrief" links per session row when debriefEnabled is true', async () => {
    getStudentDrillDownMock.mockResolvedValue({
      ...ANALYTICS,
      recentSessions: [MOCK_SESSION],
      debriefEnabled: true,
    });

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

    await screen.findByText('Student One');

    const debriefLink = screen.getByRole('link', { name: 'View debrief' });
    expect(debriefLink).toBeInTheDocument();
    expect(debriefLink).toHaveAttribute('href', expect.stringContaining('practice-sessions/session-abc/debrief'));
  });

  it('does not show "View debrief" links when debriefEnabled is false', async () => {
    getStudentDrillDownMock.mockResolvedValue({
      ...ANALYTICS,
      recentSessions: [MOCK_SESSION],
      debriefEnabled: false,
    });

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

    await screen.findByText('Student One');

    expect(screen.queryByRole('link', { name: 'View debrief' })).not.toBeInTheDocument();
  });

  it('does not show "View debrief" links when debriefEnabled is absent', async () => {
    getStudentDrillDownMock.mockResolvedValue({
      ...ANALYTICS,
      recentSessions: [MOCK_SESSION],
    });

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

    await screen.findByText('Student One');

    expect(screen.queryByRole('link', { name: 'View debrief' })).not.toBeInTheDocument();
  });
});
