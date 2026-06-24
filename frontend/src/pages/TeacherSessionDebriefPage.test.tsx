import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TeacherSessionDebriefPage } from '@/pages/TeacherSessionDebriefPage';
import type { SessionDebrief } from '@/api/teacher';

const getSessionDebriefMock = vi.fn();

vi.mock('@/api/teacher', () => ({
  getSessionDebrief: (...args: unknown[]) => getSessionDebriefMock(...args),
}));

const FULL_DEBRIEF: SessionDebrief = {
  sessionId: 'session-abc',
  status: 'completed',
  startedAt: '2026-06-24T10:00:00Z',
  endedAt: '2026-06-24T10:20:00Z',
  coverage: {
    expressionHits: { 'me gustaría': 3, 'hay que': 1 },
    vocabularyHits: { hablar: 2 },
    uncovered: ['sin embargo'],
    recycle: ['por lo tanto'],
  },
  uptake: {
    selfCorrectionCount: 4,
    feedbackCounts: { recast: 2, elicitation: 1, reviewItem: 0 },
    taskCompletionCount: 3,
  },
  repeatedErrors: [
    { label: 'ser vs estar confusion', count: 2 },
  ],
  // Real backend shape (serialize_coach_review): wins=[{text}], work_on=[{utterance,better,why,target,confidence_caveat}].
  coachReview: {
    surface: 'text',
    wins: [{ text: 'Used target expressions naturally' }, { text: 'Maintained conversation flow' }],
    work_on: [
      { utterance: 'yo es', better: 'yo soy', why: 'ser for identity', target: 'ser vs estar', confidence_caveat: '' },
    ],
    target_coverage: [{ surface: 'la cuenta', status: 'covered' }],
  },
  promotions: { count: 0, items: [] },
  helpUsage: {
    askCount: 5,
    byKind: { hint: 2, translation: 1, definition: 1, clarification: 1 },
  },
  affect: {
    readiness: 'ready',
    reason: 'Student expressed confidence at session start',
  },
  suggestedNext: ['Practice subjunctive mood', 'Review ser vs estar'],
  caveats: ['Analytics are heuristic and may not reflect every utterance.'],
};

function renderPage(sessionId = 'session-abc') {
  return render(
    <MemoryRouter initialEntries={[`/app/teacher/practice-sessions/${sessionId}/debrief`]}>
      <Routes>
        <Route
          path="/app/teacher/practice-sessions/:sessionId/debrief"
          element={<TeacherSessionDebriefPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('TeacherSessionDebriefPage', () => {
  beforeEach(() => {
    getSessionDebriefMock.mockReset();
  });

  it('renders all debrief sections when data is available', async () => {
    getSessionDebriefMock.mockResolvedValue(FULL_DEBRIEF);

    renderPage();

    // Header
    expect(await screen.findByText('Session debrief')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();

    // Section headings
    expect(screen.getByText('Coverage')).toBeInTheDocument();
    expect(screen.getByText('Uptake')).toBeInTheDocument();
    expect(screen.getByText('Repeated errors')).toBeInTheDocument();
    expect(screen.getByText('Coach review')).toBeInTheDocument();
    expect(screen.getByText('Help usage')).toBeInTheDocument();
    expect(screen.getByText('Affect readiness')).toBeInTheDocument();
    expect(screen.getByText('Suggested next practice')).toBeInTheDocument();
    expect(screen.getByText('Caveats')).toBeInTheDocument();

    // Coach review renders object-shaped wins/work_on as text (NOT "[object Object]")
    expect(screen.getByText('Used target expressions naturally')).toBeInTheDocument();
    expect(screen.getByText(/yo es → yo soy/)).toBeInTheDocument();
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();

    // Caveat text renders
    expect(screen.getByText('Analytics are heuristic and may not reflect every utterance.')).toBeInTheDocument();

    // No ask question/answer text appears — the debrief contract has none
    expect(screen.queryByText(/question/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/answer/i)).not.toBeInTheDocument();
  });

  it('renders Coaching interventions section when directorReSteers.count > 0', async () => {
    const debriefWithReSteers: SessionDebrief = {
      ...FULL_DEBRIEF,
      directorReSteers: {
        count: 2,
        items: [
          { turnIndex: 4, kind: 'language_drift', target: 'Korean', reason: 'r' },
          { turnIndex: 7, kind: 'target_neglect', target: 'la cuenta', reason: 'r' },
        ],
      },
    };
    getSessionDebriefMock.mockResolvedValue(debriefWithReSteers);

    renderPage();

    expect(await screen.findByText('Coaching interventions')).toBeInTheDocument();
    expect(screen.getByText(/Korean/)).toBeInTheDocument();
    expect(screen.getByText(/la cuenta/)).toBeInTheDocument();
  });

  it('omits Coaching interventions section when directorReSteers.count is 0', async () => {
    const debriefNoReSteers: SessionDebrief = {
      ...FULL_DEBRIEF,
      directorReSteers: { count: 0, items: [] },
    };
    getSessionDebriefMock.mockResolvedValue(debriefNoReSteers);

    renderPage();

    await screen.findByText('Session debrief');
    expect(screen.queryByText('Coaching interventions')).not.toBeInTheDocument();
  });

  it('renders Targeted corrections section when promotions.count > 0', async () => {
    const debriefWithPromotions: SessionDebrief = {
      ...FULL_DEBRIEF,
      promotions: {
        count: 2,
        items: [
          { turnIndex: 5, reason: 'hard_target', target: 'subjunctive' },
          { turnIndex: 8, reason: 'repeat', target: 'ser vs estar' },
        ],
      },
    };
    getSessionDebriefMock.mockResolvedValue(debriefWithPromotions);

    renderPage();

    expect(await screen.findByText('Targeted corrections')).toBeInTheDocument();
    // Assert on the card's UNIQUE row labels (these phrasings exist only in PromotionsCard),
    // not the bare targets — "subjunctive"/"ser vs estar" also appear in suggestedNext/repeatedErrors.
    expect(screen.getByText(/Drilled.*subjunctive.*focus grammar/)).toBeInTheDocument();
    expect(screen.getByText(/Drilled.*ser vs estar.*recurring error/)).toBeInTheDocument();
  });

  it('omits Targeted corrections section when promotions.count is 0', async () => {
    const debriefNoPromotions: SessionDebrief = {
      ...FULL_DEBRIEF,
      promotions: { count: 0, items: [] },
    };
    getSessionDebriefMock.mockResolvedValue(debriefNoPromotions);

    renderPage();

    await screen.findByText('Session debrief');
    expect(screen.queryByText('Targeted corrections')).not.toBeInTheDocument();
  });

  it('renders not-available state when getSessionDebrief returns null, no crash', async () => {
    getSessionDebriefMock.mockResolvedValue(null);

    renderPage();

    expect(await screen.findByText('Session debrief is not available.')).toBeInTheDocument();

    // No section headings should be present
    expect(screen.queryByText('Coverage')).not.toBeInTheDocument();
    expect(screen.queryByText('Uptake')).not.toBeInTheDocument();
    expect(screen.queryByText('Caveats')).not.toBeInTheDocument();
  });
});
