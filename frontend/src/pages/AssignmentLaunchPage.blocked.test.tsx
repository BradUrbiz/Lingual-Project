import { render, screen, waitFor } from '@testing-library/react';
import { AssignmentLaunchPage } from '@/pages/AssignmentLaunchPage';
import type { AssignmentBootstrapData, PracticeSessionDto } from '@/types';

const navigateMock = vi.fn();
const bootstrapStudentAssignmentMock = vi.fn();
const createAssignmentPracticeSessionMock = vi.fn();
const reportPracticeSessionEventMock = vi.fn();
const createChatSessionMock = vi.fn();
const saveMessageToChatMock = vi.fn();
const sendChatMessageMock = vi.fn();
const connectMock = vi.fn();
const disconnectMock = vi.fn();
const clearMessagesMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ assignmentId: 'assignment-1' }),
  };
});

vi.mock('@/api/assignments', () => ({
  bootstrapStudentAssignment: (...args: unknown[]) => bootstrapStudentAssignmentMock(...args),
  createAssignmentPracticeSession: (...args: unknown[]) => createAssignmentPracticeSessionMock(...args),
  reportPracticeSessionEvent: (...args: unknown[]) => reportPracticeSessionEventMock(...args),
}));

vi.mock('@/api/chat', () => ({
  createChatSession: (...args: unknown[]) => createChatSessionMock(...args),
  saveMessageToChat: (...args: unknown[]) => saveMessageToChatMock(...args),
  sendChatMessage: (...args: unknown[]) => sendChatMessageMock(...args),
}));

vi.mock('@/hooks/useRealtimeChat', () => ({
  useRealtimeChat: () => {
    return {
      isConnected: false,
      isListening: false,
      isSpeaking: false,
      messages: [],
      error: null,
      connect: connectMock,
      disconnect: disconnectMock,
      clearMessages: clearMessagesMock,
    };
  },
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    lang: 'en',
    t: (_key: string) => '',
  }),
}));

const BOOTSTRAP: AssignmentBootstrapData = {
  assignment: {
    id: 'assignment-1',
    orgId: 'org-1',
    classId: 'class-1',
    title: 'Restaurant Ordering Practice',
    description: 'Order a meal and ask one follow-up question.',
    status: 'published',
    taskType: 'information_gap',
    successCriteria: ['Use one polite request', 'Ask for clarification once'],
    modalityOverride: {
      mode: 'hybrid',
      voiceMinutesCap: 8,
      textFallbackEnabled: true,
    },
    createdByUid: 'teacher-1',
    maxAttempts: 3,
  },
  mapping: {
    id: 'mapping-1',
    orgId: 'org-1',
    classId: 'class-1',
    packageId: 'sample-ap-french',
    moduleId: 'M1',
    objectiveIds: ['OBJ1'],
    situationIds: ['S1'],
    targetExpressions: ['Could I have', 'I would like'],
    focusGrammar: ['polite requests'],
    allowedContextTags: ['restaurant'],
    feedbackPolicy: {
      mode: 'balanced',
      targetOnlyStrict: false,
      recastDefault: true,
      elicitationRepeatThreshold: 3,
      endReviewEnabled: true,
    },
    scaffoldPolicy: {
      silenceToleranceMs: 3000,
      hintLadder: ['wait', 'context_hint', 'choice_prompt', 'model_and_retry'],
      maxModelingSteps: 1,
    },
    modalityPolicy: {
      mode: 'hybrid',
      voiceMinutesCap: 10,
      textFallbackEnabled: true,
    },
    rubricFocus: ['task_completion'],
    teacherNotes: 'Keep the learner in the restaurant lane.',
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
  curriculum: {
    package: {
      id: 'sample-ap-french',
      title: { en: 'Sample AP French' },
      learningLocale: 'fr-FR',
      levelBand: 'B1-B2',
      version: '2026.03',
      sourceType: 'native',
      status: 'active',
      ownerScope: 'global',
    },
    unit: {
      id: 'U1',
      title: { en: 'Unit 1' },
      unitNumber: 1,
    },
    module: {
      id: 'M1',
      title: { en: 'Restaurant roleplay' },
      goal: { en: 'Order food politely.' },
    },
    situation: {
      id: 'S1',
      kind: 'interpersonal_speaking',
      seed: {
        setting: 'Restaurant',
      },
    },
    objectives: [
      {
        id: 'OBJ1',
        mode: 'interpersonal_speaking',
        canDo: { en: 'I can order politely in a restaurant.' },
        contextTags: ['restaurant'],
      },
    ],
  },
  launch: {
    modality: {
      mode: 'hybrid',
      voiceMinutesCap: 8,
      textFallbackEnabled: true,
    },
    voiceAllowed: true,
    textAllowed: true,
    maxAttempts: 3,
    taskType: 'information_gap',
  },
  realtimeSessionParams: {
    uiLanguage: 'en',
    practice: {
      type: 'curriculum_module',
      curriculumId: 'sample-ap-french',
      moduleId: 'M1',
      situationId: 'S1',
      assignmentId: 'assignment-1',
      classId: 'class-1',
    },
  },
  systemPromptPreview: 'Prompt for M1::S1',
  limitations: [],
};

const PRACTICE_SESSION: PracticeSessionDto = {
  id: 'practice-1',
  orgId: 'org-1',
  classId: 'class-1',
  assignmentId: 'assignment-1',
  studentUid: 'student-1',
  chatId: 'chat-123',
  status: 'active',
  modality: 'hybrid',
  voiceEnabled: true,
  textEnabled: true,
  promptVersion: 'assignment_bootstrap.v1',
  sessionSummary: {
    totalTurns: 0,
    studentTurnCount: 0,
    assistantTurnCount: 0,
    totalStudentWords: 0,
    averageStudentWordsPerTurn: 0,
    estimatedSpeakingTimeSeconds: 0,
    targetExpressionHits: {},
    targetExpressionTotalHits: 0,
    selfCorrectionCount: 0,
    taskCompletionCount: 0,
    feedbackCounts: {
      recast: 0,
      elicitation: 0,
      reviewItem: 0,
    },
    endedReason: null,
  },
  costSummary: {
    estimatedUsd: 0,
    estimatedVoiceSeconds: 0,
    estimatedTextTurns: 0,
  },
};

describe('AssignmentLaunchPage - blocked state and teacher preview', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    bootstrapStudentAssignmentMock.mockReset();
    createAssignmentPracticeSessionMock.mockReset();
    reportPracticeSessionEventMock.mockReset();
    createChatSessionMock.mockReset();
    saveMessageToChatMock.mockReset();
    sendChatMessageMock.mockReset();
    connectMock.mockReset();
    disconnectMock.mockReset();
    clearMessagesMock.mockReset();

    bootstrapStudentAssignmentMock.mockResolvedValue(BOOTSTRAP);
    createChatSessionMock.mockResolvedValue({
      chatId: 'chat-123',
      title: 'ASM Restaurant Ordering Practice',
    });
    createAssignmentPracticeSessionMock.mockResolvedValue(PRACTICE_SESSION);
    connectMock.mockResolvedValue(undefined);
  });

  it('disables the start button and shows blocked reasons when voice and text are both blocked', async () => {
    bootstrapStudentAssignmentMock.mockResolvedValue({
      ...BOOTSTRAP,
      launch: {
        ...BOOTSTRAP.launch,
        modality: {
          ...BOOTSTRAP.launch.modality,
          mode: 'hybrid',
        },
        voiceAllowed: false,
        textAllowed: false,
        blockedReasons: [
          'Voice consent has not been granted for this student.',
          'Text practice is disabled by school policy.',
        ],
      },
    });

    render(<AssignmentLaunchPage />);

    await waitFor(() => {
      expect(screen.getByText('Restaurant Ordering Practice')).toBeInTheDocument();
    });

    const startButton = screen.getByRole('button', { name: /start/i });
    expect(startButton).toBeDisabled();

    expect(
      screen.getByText(
        'Voice consent has not been granted for this student. Text practice is disabled by school policy.'
      )
    ).toBeInTheDocument();
  });

  it('renders a teacher preview alert when bootstrap includes teacherPreview flag', async () => {
    bootstrapStudentAssignmentMock.mockResolvedValue({
      ...BOOTSTRAP,
      teacherPreview: true,
    });

    render(<AssignmentLaunchPage />);

    await waitFor(() => {
      expect(screen.getByText('Restaurant Ordering Practice')).toBeInTheDocument();
    });

    expect(screen.getByText('Teacher preview')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This launch is running in teacher preview mode. Students will only see it when they are actively enrolled and the assignment is published.'
      )
    ).toBeInTheDocument();
  });
});
