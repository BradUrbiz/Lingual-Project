import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TeacherAssignmentDebriefPage } from '@/pages/TeacherAssignmentDebriefPage';
import type { AssignmentDebrief } from '@/api/teacher';

const getAssignmentDebriefMock = vi.fn();

vi.mock('@/api/teacher', () => ({
  getAssignmentDebrief: (...args: unknown[]) => getAssignmentDebriefMock(...args),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    lang: 'en',
    t: (key: string) => key,
  }),
}));

const FULL_DEBRIEF: AssignmentDebrief = {
  assignmentId: 'assignment-abc',
  participation: {
    sessionCount: 12,
    completedSessionCount: 10,
    studentCount: 8,
    firstStartedAt: '2026-06-01T10:00:00Z',
    lastStartedAt: '2026-06-24T15:30:00Z',
  },
  uptake: {
    selfCorrectionCount: 14,
    feedbackCounts: { recast: 8, elicitation: 5, reviewItem: 2 },
    taskCompletionCount: 9,
  },
  promotions: {
    count: 4,
    byTarget: [
      { target: 'ser_vs_estar', count: 3, sessionCount: 2 },
      { target: 'subjunctive', count: 1, sessionCount: 1 },
    ],
  },
  directorReSteers: {
    count: 3,
    byKind: { 'language-drift': 2, 'target-neglect': 1 },
    byTarget: [{ target: 'english_slip', count: 2 }],
  },
  helpUsage: {
    askCount: 7,
    byKind: { hint: 3, translation: 2, definition: 1, clarification: 1, phrase: 0, refusal: 0 },
    sessionsWithHelp: 5,
  },
  affect: {
    byReadiness: { strained: 3, neutral: 4, settled: 1 },
    sessionsWithSignal: 8,
  },
  coachReview: { sessionCount: 6 },
  suggestedNext: [
    'Multiple students needed correction on ser_vs_estar — consider a focused mini-lesson.',
    'Consider advancing difficulty for students who handled targets well.',
  ],
  caveats: [
    'Analytics are heuristic and may not reflect every utterance.',
    'This roll-up aggregates 12 session(s) across 8 student(s); per-student detail is in each session debrief.',
  ],
};

const EMPTY_DEBRIEF: AssignmentDebrief = {
  assignmentId: 'assignment-empty',
  participation: {
    sessionCount: 0,
    completedSessionCount: 0,
    studentCount: 0,
    firstStartedAt: null,
    lastStartedAt: null,
  },
  uptake: {
    selfCorrectionCount: 0,
    feedbackCounts: { recast: 0, elicitation: 0, reviewItem: 0 },
    taskCompletionCount: 0,
  },
  promotions: { count: 0, byTarget: [] },
  directorReSteers: { count: 0, byKind: {}, byTarget: [] },
  helpUsage: {
    askCount: 0,
    byKind: { hint: 0, translation: 0, definition: 0, clarification: 0, phrase: 0, refusal: 0 },
    sessionsWithHelp: 0,
  },
  affect: { byReadiness: {}, sessionsWithSignal: 0 },
  coachReview: { sessionCount: 0 },
  suggestedNext: [],
  caveats: ['Analytics are heuristic and may not reflect every utterance.'],
};

function renderPage(assignmentId = 'assignment-abc') {
  return render(
    <MemoryRouter initialEntries={[`/app/teacher/assignments/${assignmentId}/debrief`]}>
      <Routes>
        <Route
          path="/app/teacher/assignments/:assignmentId/debrief"
          element={<TeacherAssignmentDebriefPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('TeacherAssignmentDebriefPage', () => {
  beforeEach(() => {
    getAssignmentDebriefMock.mockReset();
  });

  it('renders all debrief cards when data is rich', async () => {
    getAssignmentDebriefMock.mockResolvedValue(FULL_DEBRIEF);

    renderPage();

    // Header
    expect(await screen.findByText('teacher.debrief.pageTitle')).toBeInTheDocument();

    // Section headings — all should be present with full data
    expect(screen.getByText('teacher.debrief.participation.title')).toBeInTheDocument();
    expect(screen.getByText('teacher.debrief.uptake.title')).toBeInTheDocument();
    expect(screen.getByText('teacher.debrief.corrections.title')).toBeInTheDocument();
    expect(screen.getByText('teacher.debrief.coaching.title')).toBeInTheDocument();
    expect(screen.getByText('teacher.debrief.help.title')).toBeInTheDocument();
    expect(screen.getByText('teacher.debrief.affect.title')).toBeInTheDocument();
    expect(screen.getByText('teacher.debrief.coachReview.title')).toBeInTheDocument();
    expect(screen.getByText('teacher.debrief.suggestedNext.title')).toBeInTheDocument();
    expect(screen.getByText('teacher.debrief.caveats.title')).toBeInTheDocument();

    // Participation values (use getAllByText since numbers may appear in multiple contexts)
    expect(screen.getAllByText('12').length).toBeGreaterThan(0); // sessionCount
    expect(screen.getAllByText('8').length).toBeGreaterThan(0);  // studentCount

    // Targeted corrections rows (target appears in both corrections card and suggestedNext)
    expect(screen.getAllByText(/ser_vs_estar/).length).toBeGreaterThan(0);

    // Coaching interventions
    expect(screen.getByText(/language-drift/)).toBeInTheDocument();

    // Caveat text
    expect(screen.getByText('Analytics are heuristic and may not reflect every utterance.')).toBeInTheDocument();
  });

  it('renders only Participation and Caveats when roll-up is empty; intervention cards self-hide', async () => {
    getAssignmentDebriefMock.mockResolvedValue(EMPTY_DEBRIEF);

    renderPage();

    // Always-present cards
    expect(await screen.findByText('teacher.debrief.participation.title')).toBeInTheDocument();
    expect(screen.getByText('teacher.debrief.caveats.title')).toBeInTheDocument();

    // Intervention cards must self-hide (count 0)
    expect(screen.queryByText('teacher.debrief.corrections.title')).not.toBeInTheDocument();
    expect(screen.queryByText('teacher.debrief.coaching.title')).not.toBeInTheDocument();
    expect(screen.queryByText('teacher.debrief.help.title')).not.toBeInTheDocument();
    expect(screen.queryByText('teacher.debrief.affect.title')).not.toBeInTheDocument();
    expect(screen.queryByText('teacher.debrief.coachReview.title')).not.toBeInTheDocument();
    expect(screen.queryByText('teacher.debrief.uptake.title')).not.toBeInTheDocument();
    expect(screen.queryByText('teacher.debrief.suggestedNext.title')).not.toBeInTheDocument();
  });

  it('renders not-available state when getAssignmentDebrief returns null', async () => {
    getAssignmentDebriefMock.mockResolvedValue(null);

    renderPage();

    expect(await screen.findByText('teacher.debrief.notAvailable')).toBeInTheDocument();

    // No section headings should be present
    expect(screen.queryByText('teacher.debrief.participation.title')).not.toBeInTheDocument();
    expect(screen.queryByText('teacher.debrief.caveats.title')).not.toBeInTheDocument();
  });
});
