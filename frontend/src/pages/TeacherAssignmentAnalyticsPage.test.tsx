import { render, screen, waitFor } from '@testing-library/react';
import { TeacherAssignmentAnalyticsPage } from '@/pages/TeacherAssignmentAnalyticsPage';
import type { AssignmentAnalyticsData } from '@/types';

const navigateMock = vi.fn();
const getAssignmentAnalyticsMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ classId: 'class-1', assignmentId: 'assignment-1' }),
  };
});

vi.mock('@/api/assignments', () => ({
  getAssignmentAnalytics: (...args: unknown[]) => getAssignmentAnalyticsMock(...args),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    lang: 'en',
    t: (key: string) => key,
  }),
}));

const ANALYTICS: AssignmentAnalyticsData = {
  assignment: {
    id: 'assignment-1',
    orgId: 'org-1',
    classId: 'class-1',
    mappingId: 'mapping-1',
    title: 'Family Interview',
    description: 'Ask follow-up questions about family life.',
    status: 'published',
    modalityOverride: {
      mode: 'hybrid',
      voiceMinutesCap: 8,
      textFallbackEnabled: true,
    },
    maxAttempts: 3,
    taskType: 'information_gap',
    successCriteria: ['Use two follow-up questions'],
    createdByUid: 'teacher-1',
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
  mapping: {
    id: 'mapping-1',
    orgId: 'org-1',
    classId: 'class-1',
    packageId: 'sample-ap-french',
    moduleId: 'mod.1.1',
    objectiveIds: ['OBJ1'],
    situationIds: ['S1'],
    targetExpressions: ['Est-ce que'],
    focusGrammar: ['follow-up questions'],
    allowedContextTags: ['family_structures'],
    feedbackPolicy: {
      mode: 'balanced',
      targetOnlyStrict: false,
      recastDefault: true,
      elicitationRepeatThreshold: 3,
      endReviewEnabled: true,
    },
    scaffoldPolicy: {
      silenceToleranceMs: 3000,
      hintLadder: ['wait', 'context_hint'],
      maxModelingSteps: 1,
    },
    modalityPolicy: {
      mode: 'hybrid',
      voiceMinutesCap: 10,
      textFallbackEnabled: true,
    },
    rubricFocus: ['task_completion'],
    teacherNotes: 'Keep the learner asking questions.',
    createdByUid: 'teacher-1',
  },
  summary: {
    sessionCount: 4,
    completedSessionCount: 3,
    activeSessionCount: 1,
    uniqueStudentCount: 2,
    totalStudentTurns: 12,
    totalAssistantTurns: 10,
    totalStudentWords: 96,
    averageStudentWordsPerTurn: 8,
    estimatedSpeakingTimeSeconds: 50,
    targetExpressionHits: { 'Est-ce que': 3 },
    targetExpressionTotalHits: 3,
    selfCorrectionCount: 2,
    taskCompletionCount: 1,
    repeatedErrorCount: 2,
    rubricAverageScore: 3.25,
    feedbackCounts: {
      recast: 2,
      elicitation: 1,
      reviewItem: 1,
    },
    eventCount: 18,
  },
  pedagogy: {
    taskModel: 'ap.conversation',
    evidence: {
      minTurns: 4,
      maxTurns: 8,
      timeLimitSec: 90,
      maxReplays: null,
    },
    targetExpressions: [{ id: 'Est-ce que', count: 3 }],
    contextTagCoverage: [{ id: 'family_structures', count: 12 }],
    communicativeFunctionSignals: [{ id: 'ask_follow_up', count: 4 }],
    discourseMoveSignals: [{ id: 'turn_taking', count: 2 }],
    foundationDomainCoverage: [{ id: 'communication_strategies', count: 12 }],
    repeatedErrors: [
      {
        id: 'fr.past_auxiliary_infinitive',
        label: 'Passé composé auxiliary followed by infinitive',
        category: 'grammar',
        count: 2,
        rubricDimensionIds: ['lexical_grammatical_control'],
        studentCount: 1,
      },
    ],
    rubricDimensionScores: [{ id: 'clarity', score: 3.25 }],
    objectives: [
      {
        id: 'OBJ1',
        mode: 'interpersonal_speaking',
        canDo: { en: 'I can ask follow-up questions about family life.' },
        contextTags: ['family_structures'],
        communicativeFunctions: ['ask_follow_up'],
        discourseMoves: ['turn_taking'],
        foundationDomains: ['communication_strategies'],
        register: 'informal',
        rubricId: 'rub.speaking.v1',
        rubricThreshold: 3,
        templateRefs: ['tpl.conversation.v1'],
        turnCount: 12,
        estimatedRubricScore: 3.25,
        meetingThreshold: true,
      },
    ],
    rubrics: [
      {
        id: 'rub.speaking.v1',
        title: { en: 'Speaking Rubric' },
        scale: { min: 0, max: 4, step: 1 },
        dimensions: [
          {
            id: 'clarity',
            title: { en: 'Clarity' },
            description: { en: 'Expresses ideas clearly.' },
            averageScore: 3.25,
            threshold: 3,
            meetingThreshold: true,
            confidence: 'medium',
            signalCount: 4,
            errorCount: 1,
            evidence: ['ask_follow_up x4', 'family_structures x12'],
            concerns: ['fr.past_auxiliary_infinitive x2'],
          },
        ],
        notes: 'Speaking rubric notes',
        turnCount: 12,
        averageScore: 3.25,
        threshold: 3,
        meetingThreshold: true,
        confidence: 'medium',
      },
    ],
  },
  recentSessions: [
    {
      id: 'practice-1',
      orgId: 'org-1',
      classId: 'class-1',
      assignmentId: 'assignment-1',
      studentUid: 'student-1',
      chatId: 'chat-1',
      status: 'completed',
      modality: 'hybrid',
      voiceEnabled: true,
      textEnabled: true,
      promptVersion: 'assignment_bootstrap.v1',
      sessionSummary: {
        totalTurns: 6,
        studentTurnCount: 3,
        assistantTurnCount: 3,
        totalStudentWords: 24,
        averageStudentWordsPerTurn: 8,
        estimatedSpeakingTimeSeconds: 12,
        targetExpressionHits: { 'Est-ce que': 1 },
        targetExpressionTotalHits: 1,
        selfCorrectionCount: 1,
        taskCompletionCount: 1,
        repeatedErrorCounts: { 'fr.past_auxiliary_infinitive': 2 },
        feedbackCounts: {
          recast: 1,
          elicitation: 0,
          reviewItem: 0,
        },
        endedReason: 'manual_disconnect',
      },
      costSummary: {
        estimatedUsd: 0,
        estimatedVoiceSeconds: 12,
        estimatedTextTurns: 3,
      },
    },
  ],
  limitations: ['Signal coverage is heuristic first-pass data.'],
};

describe('TeacherAssignmentAnalyticsPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    getAssignmentAnalyticsMock.mockReset();
    getAssignmentAnalyticsMock.mockResolvedValue(ANALYTICS);
  });

  it('renders assignment analytics drill-down data', async () => {
    render(<TeacherAssignmentAnalyticsPage />);

    await waitFor(() => {
      expect(getAssignmentAnalyticsMock).toHaveBeenCalledWith('assignment-1');
    });

    expect(await screen.findByText('Family Interview')).toBeInTheDocument();
    expect(screen.getByText('Objective alignment')).toBeInTheDocument();
    expect(screen.getByText('Signal coverage')).toBeInTheDocument();
    expect(screen.getByText('Speaking Rubric')).toBeInTheDocument();
    expect(screen.getByText('ask_follow_up: 4')).toBeInTheDocument();
    expect(
      screen.getByText('Passé composé auxiliary followed by infinitive: 2 · students 1')
    ).toBeInTheDocument();
    expect(screen.getByText('clarity: 3.25')).toBeInTheDocument();
    expect(screen.getByText('Rubric avg')).toBeInTheDocument();
    expect(screen.getByText('family_structures: 12')).toBeInTheDocument();
    expect(screen.getByText(/Estimated rubric score 3\.25/i)).toBeInTheDocument();
    expect(screen.getAllByText('meeting threshold').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Threshold 3').length).toBeGreaterThan(0);
    expect(screen.getAllByText('medium confidence').length).toBeGreaterThan(0);
    expect(screen.getByText(/Evidence: ask_follow_up x4/i)).toBeInTheDocument();
    expect(screen.getByText(/Concerns: fr\.past_auxiliary_infinitive x2/i)).toBeInTheDocument();
    expect(screen.getByText('Signal coverage is heuristic first-pass data.')).toBeInTheDocument();
  });
});
