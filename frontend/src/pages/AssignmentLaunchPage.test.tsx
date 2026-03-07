import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssignmentLaunchPage } from '@/pages/AssignmentLaunchPage';
import type { AssignmentBootstrapData, PracticeSessionDto } from '@/types';

const navigateMock = vi.fn();
const bootstrapStudentAssignmentMock = vi.fn();
const createAssignmentPracticeSessionMock = vi.fn();
const reportPracticeSessionEventMock = vi.fn();
const createChatSessionMock = vi.fn();
const saveMessageToChatMock = vi.fn();
const connectMock = vi.fn();
const disconnectMock = vi.fn();
const clearMessagesMock = vi.fn();
let capturedSessionParams: unknown;
let capturedOnMessage: ((role: 'user' | 'assistant', content: string) => void) | undefined;

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
}));

vi.mock('@/hooks/useRealtimeChat', () => ({
  useRealtimeChat: (options: { onMessage?: (role: 'user' | 'assistant', content: string) => void; sessionParams?: unknown }) => {
    capturedSessionParams = options?.sessionParams;
    capturedOnMessage = options?.onMessage;
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
    t: (key: string) => key,
  }),
}));

const BOOTSTRAP: AssignmentBootstrapData = {
  assignment: {
    id: 'assignment-1',
    orgId: 'org-1',
    classId: 'class-1',
    mappingId: 'mapping-1',
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
      mappingId: 'mapping-1',
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

describe('AssignmentLaunchPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    bootstrapStudentAssignmentMock.mockReset();
    createAssignmentPracticeSessionMock.mockReset();
    reportPracticeSessionEventMock.mockReset();
    createChatSessionMock.mockReset();
    saveMessageToChatMock.mockReset();
    connectMock.mockReset();
    disconnectMock.mockReset();
    clearMessagesMock.mockReset();
    capturedSessionParams = undefined;
    capturedOnMessage = undefined;

    bootstrapStudentAssignmentMock.mockResolvedValue(BOOTSTRAP);
    createChatSessionMock.mockResolvedValue({
      chatId: 'chat-123',
      title: 'ASM Restaurant Ordering Practice',
    });
    createAssignmentPracticeSessionMock.mockResolvedValue(PRACTICE_SESSION);
    reportPracticeSessionEventMock.mockImplementation(async (_sessionId: string, payload: { eventType: string }) => {
      if (payload.eventType === 'student.turn') {
        return {
          ...PRACTICE_SESSION,
          sessionSummary: {
            ...PRACTICE_SESSION.sessionSummary,
            totalTurns: 1,
            studentTurnCount: 1,
            totalStudentWords: 5,
            averageStudentWordsPerTurn: 5,
            estimatedSpeakingTimeSeconds: 2,
            targetExpressionHits: { 'Could I have': 1 },
            targetExpressionTotalHits: 1,
          },
        };
      }

      return PRACTICE_SESSION;
    });
    connectMock.mockResolvedValue(undefined);
  });

  it('loads bootstrap data, creates a practice session, and reports realtime turn events', async () => {
    render(<AssignmentLaunchPage />);

    await waitFor(() => {
      expect(screen.getByText('Restaurant Ordering Practice')).toBeInTheDocument();
    });

    expect(capturedSessionParams).toEqual(BOOTSTRAP.realtimeSessionParams);
    expect(screen.getByText('Teacher-designed practice overlay')).toBeInTheDocument();
    expect(screen.getByText('Keep the learner in the restaurant lane.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start assignment practice' }));

    await waitFor(() => {
      expect(createChatSessionMock).toHaveBeenCalledWith('ASM Restaurant Ordering Practice');
    });

    await waitFor(() => {
      expect(createAssignmentPracticeSessionMock).toHaveBeenCalledWith('assignment-1', {
        uiLanguage: 'en',
        chatId: 'chat-123',
      });
    });

    await waitFor(() => {
      expect(capturedSessionParams).toEqual({
        ...BOOTSTRAP.realtimeSessionParams,
        practice: {
          ...BOOTSTRAP.realtimeSessionParams.practice,
          practiceSessionId: 'practice-1',
        },
      });
    });

    await waitFor(() => {
      expect(connectMock).toHaveBeenCalled();
    });

    capturedOnMessage?.('user', 'Could I have the soup, please?');

    await waitFor(() => {
      expect(saveMessageToChatMock).toHaveBeenCalledWith(
        'chat-123',
        'user',
        'Could I have the soup, please?',
        expect.objectContaining({ sortOrder: 0 })
      );
    });

    await waitFor(() => {
      expect(reportPracticeSessionEventMock).toHaveBeenCalledWith(
        'practice-1',
        expect.objectContaining({
          eventType: 'student.turn',
          turnIndex: 0,
          payload: expect.objectContaining({
            chatId: 'chat-123',
            content: 'Could I have the soup, please?',
          }),
        })
      );
    });
  });
});
