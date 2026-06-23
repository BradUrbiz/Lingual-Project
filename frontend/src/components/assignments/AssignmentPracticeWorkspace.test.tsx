import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssignmentPracticeWorkspace } from '@/components/assignments/AssignmentPracticeWorkspace';
import type { AssignmentBootstrapData, AssignmentWorkspaceData, ChatSessionDetail, PracticeSessionDto } from '@/types';

const postCoachChipMock = vi.fn();
vi.mock('@/api/coachChips', () => ({
  postCoachChip: (...args: unknown[]) => postCoachChipMock(...args),
}));

const getStudentAssignmentWorkspaceMock = vi.fn();
const createAssignmentPracticeSessionMock = vi.fn();
const reportPracticeSessionEventMock = vi.fn();
const getChatSessionMock = vi.fn();
const createChatSessionMock = vi.fn();
const sendChatMessageMock = vi.fn();
const saveMessageToChatMock = vi.fn();
const connectMock = vi.fn();
const disconnectMock = vi.fn();
const clearMessagesMock = vi.fn();
let realtimeOnMessage: ((role: 'user' | 'assistant', content: string) => void) | null = null;

vi.mock('@/api/assignments', () => ({
  getStudentAssignmentWorkspace: (...args: unknown[]) => getStudentAssignmentWorkspaceMock(...args),
  createAssignmentPracticeSession: (...args: unknown[]) => createAssignmentPracticeSessionMock(...args),
  reportPracticeSessionEvent: (...args: unknown[]) => reportPracticeSessionEventMock(...args),
}));

vi.mock('@/api/chat', () => ({
  getChatSession: (...args: unknown[]) => getChatSessionMock(...args),
  createChatSession: (...args: unknown[]) => createChatSessionMock(...args),
  sendChatMessage: (...args: unknown[]) => sendChatMessageMock(...args),
  saveMessageToChat: (...args: unknown[]) => saveMessageToChatMock(...args),
}));

vi.mock('@/hooks/useRealtimeChat', () => ({
  useRealtimeChat: (options?: { onMessage?: (role: 'user' | 'assistant', content: string) => void }) => {
    realtimeOnMessage = options?.onMessage ?? null;
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
    generatedScenario: 'You are ordering dinner at a busy restaurant.',
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

const ACTIVE_SESSION: PracticeSessionDto = {
  id: 'practice-1',
  orgId: 'org-1',
  classId: 'class-1',
  assignmentId: 'assignment-1',
  studentUid: 'student-1',
  chatId: 'chat-1',
  status: 'active',
  modality: 'hybrid',
  voiceEnabled: true,
  textEnabled: true,
  promptVersion: 'assignment_bootstrap.v1',
  sessionSummary: {
    totalTurns: 2,
    studentTurnCount: 1,
    assistantTurnCount: 1,
    totalStudentWords: 3,
    averageStudentWordsPerTurn: 3,
    estimatedSpeakingTimeSeconds: 2,
    targetExpressionHits: {},
    targetExpressionTotalHits: 0,
    selfCorrectionCount: 0,
    taskCompletionCount: 0,
    feedbackCounts: { recast: 0, elicitation: 0, reviewItem: 0 },
    endedReason: null,
  },
  costSummary: {
    estimatedUsd: 0,
    estimatedVoiceSeconds: 0,
    estimatedTextTurns: 0,
  },
};

const HISTORICAL_SESSION: PracticeSessionDto = {
  ...ACTIVE_SESSION,
  id: 'practice-2',
  chatId: 'chat-2',
  status: 'completed',
};

const RESUMED_SESSION: PracticeSessionDto = {
  ...ACTIVE_SESSION,
  id: 'practice-resumed',
  chatId: 'chat-2',
  status: 'active',
};

const CHAT_1: ChatSessionDetail = {
  id: 'chat-1',
  title: 'Current active thread',
  created_at: '2026-04-19T10:00:00Z',
  updated_at: '2026-04-19T10:05:00Z',
  messages: [
    { role: 'user', content: 'Bonjour', timestamp: '2026-04-19T10:00:00Z' },
    { role: 'assistant', content: 'Salut', timestamp: '2026-04-19T10:01:00Z' },
  ],
};

const CHAT_2: ChatSessionDetail = {
  id: 'chat-2',
  title: 'Past attempt thread',
  created_at: '2026-04-18T09:00:00Z',
  updated_at: '2026-04-18T09:05:00Z',
  messages: [
    { role: 'user', content: 'Je m appelle Lea', timestamp: '2026-04-18T09:00:00Z' },
  ],
};

const WORKSPACE: AssignmentWorkspaceData = {
  bootstrap: BOOTSTRAP,
  selectedChatId: 'chat-1',
  latestActivePracticeSessionId: 'practice-1',
  threads: [
    {
      chatId: 'chat-1',
      title: 'Current active thread',
      updatedAt: '2026-04-19T10:05:00Z',
      messageCount: 2,
      hasActiveAttempt: true,
      latestPracticeSession: ACTIVE_SESSION,
      attempts: [ACTIVE_SESSION],
    },
    {
      chatId: 'chat-2',
      title: 'Past attempt thread',
      updatedAt: '2026-04-18T09:05:00Z',
      messageCount: 1,
      hasActiveAttempt: false,
      latestPracticeSession: HISTORICAL_SESSION,
      attempts: [HISTORICAL_SESSION],
    },
  ],
};

describe('AssignmentPracticeWorkspace', () => {
  beforeEach(() => {
    getStudentAssignmentWorkspaceMock.mockReset();
    createAssignmentPracticeSessionMock.mockReset();
    reportPracticeSessionEventMock.mockReset();
    getChatSessionMock.mockReset();
    createChatSessionMock.mockReset();
    sendChatMessageMock.mockReset();
    saveMessageToChatMock.mockReset();
    connectMock.mockReset();
    disconnectMock.mockReset();
    clearMessagesMock.mockReset();
    postCoachChipMock.mockReset();
    postCoachChipMock.mockResolvedValue(null);
    realtimeOnMessage = null;

    getStudentAssignmentWorkspaceMock.mockResolvedValue(WORKSPACE);
    getChatSessionMock.mockImplementation(async (chatId: string) => (chatId === 'chat-2' ? CHAT_2 : CHAT_1));
    createChatSessionMock.mockResolvedValue({ chatId: 'chat-new', title: 'ASM Restaurant Ordering Practice' });
    createAssignmentPracticeSessionMock.mockResolvedValue({
      ...ACTIVE_SESSION,
      id: 'practice-new',
      chatId: 'chat-new',
    });
    reportPracticeSessionEventMock.mockResolvedValue({
      ...ACTIVE_SESSION,
      status: 'completed',
    });
  });

  it('loads the workspace and selected thread transcript on open', async () => {
    render(
      <AssignmentPracticeWorkspace
        open
        bootstrap={BOOTSTRAP}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(getStudentAssignmentWorkspaceMock).toHaveBeenCalledWith('assignment-1');
    });

    await waitFor(() => {
      expect(screen.getByText('Bonjour')).toBeInTheDocument();
      expect(screen.getByText('Salut')).toBeInTheDocument();
    });
  });

  it('shows the full assignment context inside the workspace scope panel', async () => {
    render(
      <AssignmentPracticeWorkspace
        open
        bootstrap={BOOTSTRAP}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Conversation scenario')).toBeInTheDocument();
      expect(screen.getByText('You are ordering dinner at a busy restaurant.')).toBeInTheDocument();
      expect(screen.getByText('Situation')).toBeInTheDocument();
      expect(screen.getByText('S1')).toBeInTheDocument();
      expect(screen.getByText(/Interpersonal speaking - Restaurant/i)).toBeInTheDocument();
      expect(screen.getByText('Target expressions')).toBeInTheDocument();
      expect(screen.getByText(/Could I have/i)).toBeInTheDocument();
      expect(screen.getByText(/I would like/i)).toBeInTheDocument();
      expect(screen.getByText('Focus grammar')).toBeInTheDocument();
      expect(screen.getByText(/polite requests/i)).toBeInTheDocument();
      expect(screen.getByText('Success criteria')).toBeInTheDocument();
      expect(screen.getByText(/Use one polite request/i)).toBeInTheDocument();
    });
  });

  it('loads a historical thread transcript when the student selects it', async () => {
    render(
      <AssignmentPracticeWorkspace
        open
        bootstrap={BOOTSTRAP}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Past attempt thread')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Past attempt thread/i }));

    await waitFor(() => {
      expect(getChatSessionMock).toHaveBeenCalledWith('chat-2');
      expect(screen.getByText('Je m appelle Lea')).toBeInTheDocument();
    });
  });

  it('starts a new attempt from the workspace', async () => {
    render(
      <AssignmentPracticeWorkspace
        open
        bootstrap={BOOTSTRAP}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'New attempt' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'New attempt' }));

    await waitFor(() => {
      expect(createChatSessionMock).toHaveBeenCalledWith('ASM Restaurant Ordering Practice');
      expect(createAssignmentPracticeSessionMock).toHaveBeenCalledWith('assignment-1', {
        uiLanguage: 'en',
        chatId: 'chat-new',
      });
    });
  });

  it('resumes a historical thread as a new attempt on the existing chat id', async () => {
    createAssignmentPracticeSessionMock.mockResolvedValue(RESUMED_SESSION);

    render(
      <AssignmentPracticeWorkspace
        open
        bootstrap={BOOTSTRAP}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Past attempt thread/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Past attempt thread/i }));

    await waitFor(() => {
      expect(screen.getByText('Je m appelle Lea')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Resume this thread' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Tap the mic to connect' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Tap the mic to connect' }));

    await waitFor(() => {
      expect(createAssignmentPracticeSessionMock).toHaveBeenCalledWith('assignment-1', {
        uiLanguage: 'en',
        chatId: 'chat-2',
      });
      expect(connectMock).toHaveBeenCalledWith(expect.objectContaining({
        practice: expect.objectContaining({
          assignmentId: 'assignment-1',
          practiceSessionId: 'practice-resumed',
        }),
      }));
    });
  });

  it('resumes a historical thread without refetching the workspace before connecting', async () => {
    createAssignmentPracticeSessionMock.mockResolvedValue(RESUMED_SESSION);

    render(
      <AssignmentPracticeWorkspace
        open
        bootstrap={BOOTSTRAP}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Past attempt thread/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Past attempt thread/i }));

    await waitFor(() => {
      expect(screen.getByText('Je m appelle Lea')).toBeInTheDocument();
    });

    getStudentAssignmentWorkspaceMock.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Tap the mic to connect' }));

    await waitFor(() => {
      expect(connectMock).toHaveBeenCalledWith(expect.objectContaining({
        practice: expect.objectContaining({
          assignmentId: 'assignment-1',
          practiceSessionId: 'practice-resumed',
        }),
      }));
    });

    expect(getStudentAssignmentWorkspaceMock).not.toHaveBeenCalled();
  });

  it('keeps the resumed thread active after tapping the mic when the workspace refresh is stale', async () => {
    createAssignmentPracticeSessionMock.mockResolvedValue(RESUMED_SESSION);
    getStudentAssignmentWorkspaceMock.mockResolvedValue(WORKSPACE);

    render(
      <AssignmentPracticeWorkspace
        open
        bootstrap={BOOTSTRAP}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Past attempt thread/i })).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Past attempt thread/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Past attempt thread/i }));

    await waitFor(() => {
      expect(screen.getByText('Je m appelle Lea')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Resume this thread' })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Tap the mic to connect' }));

    await waitFor(() => {
      expect(screen.getByText('Je m appelle Lea')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'End session' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Resume this thread' })).not.toBeInTheDocument();
      expect(connectMock).toHaveBeenCalled();
    });
  });

  it('ignores stale realtime messages after the previous session is ended during thread resume', async () => {
    let resolveResumedSession: ((session: PracticeSessionDto) => void) | null = null;
    createAssignmentPracticeSessionMock.mockImplementation(
      () => new Promise<PracticeSessionDto>((resolve) => {
        resolveResumedSession = resolve;
      }),
    );

    render(
      <AssignmentPracticeWorkspace
        open
        bootstrap={BOOTSTRAP}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Past attempt thread/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Past attempt thread/i }));

    await waitFor(() => {
      expect(screen.getByText('Je m appelle Lea')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Tap the mic to connect' }));

    await waitFor(() => {
      expect(reportPracticeSessionEventMock).toHaveBeenCalledWith('practice-1', expect.objectContaining({
        eventType: 'session.ended',
        payload: expect.objectContaining({
          reason: 'thread_resumed',
        }),
      }));
    });

    saveMessageToChatMock.mockClear();
    reportPracticeSessionEventMock.mockClear();

    realtimeOnMessage?.('assistant', 'Late trailing reply');

    await Promise.resolve();

    expect(saveMessageToChatMock).not.toHaveBeenCalled();
    expect(reportPracticeSessionEventMock).not.toHaveBeenCalled();

    resolveResumedSession?.(RESUMED_SESSION);

    await waitFor(() => {
      expect(connectMock).toHaveBeenCalledWith(expect.objectContaining({
        practice: expect.objectContaining({
          practiceSessionId: 'practice-resumed',
        }),
      }));
    });
  });

  it('does not show a text resume input for non-text launches', async () => {
    render(
      <AssignmentPracticeWorkspace
        open
        bootstrap={BOOTSTRAP}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Bonjour')).toBeInTheDocument();
    });

    expect(screen.queryByPlaceholderText('Type your assignment response...')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Past attempt thread/i }));

    await waitFor(() => {
      expect(screen.getByText('Je m appelle Lea')).toBeInTheDocument();
    });

    expect(screen.queryByPlaceholderText('Type to continue this assignment thread...')).not.toBeInTheDocument();
  });

  it('fires postCoachChip with the practice session id and learner turn index after a text send', async () => {
    const TEXT_BOOTSTRAP: AssignmentBootstrapData = {
      ...BOOTSTRAP,
      launch: {
        ...BOOTSTRAP.launch,
        modality: { mode: 'text_only', voiceMinutesCap: 0, textFallbackEnabled: false },
        voiceAllowed: false,
        textAllowed: true,
      },
    };
    const TEXT_SESSION: PracticeSessionDto = {
      ...ACTIVE_SESSION,
      modality: 'text_only',
      voiceEnabled: false,
      textEnabled: true,
    };
    const TEXT_WORKSPACE: AssignmentWorkspaceData = {
      ...WORKSPACE,
      bootstrap: TEXT_BOOTSTRAP,
      threads: [
        {
          ...WORKSPACE.threads[0],
          latestPracticeSession: TEXT_SESSION,
          attempts: [TEXT_SESSION],
        },
      ],
    };

    getStudentAssignmentWorkspaceMock.mockResolvedValue(TEXT_WORKSPACE);
    sendChatMessageMock.mockResolvedValue({ response: 'Très bien !' });
    reportPracticeSessionEventMock.mockResolvedValue(undefined);

    render(
      <AssignmentPracticeWorkspace
        open
        bootstrap={TEXT_BOOTSTRAP}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Type your assignment response...')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('Type your assignment response...');
    fireEvent.change(input, { target: { value: 'Bonjour, je voudrais commander.' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(postCoachChipMock).toHaveBeenCalledWith(
        TEXT_SESSION.id,
        expect.any(Number),
      );
    });
  });
});
