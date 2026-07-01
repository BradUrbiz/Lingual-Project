import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssignmentPracticeWorkspace } from '@/components/assignments/AssignmentPracticeWorkspace';
import type { AssignmentBootstrapData, AssignmentWorkspaceData, ChatSessionDetail, PracticeSessionDto } from '@/types';

const postCoachChipMock = vi.fn();
const getCoachChipsMock = vi.fn();
vi.mock('@/api/coachChips', () => ({
  postCoachChip: (...args: unknown[]) => postCoachChipMock(...args),
  getCoachChips: (...args: unknown[]) => getCoachChipsMock(...args),
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
const injectPromoteBackSpy = vi.fn();
let realtimeOnMessage: ((role: 'user' | 'assistant', content: string) => void) | null = null;
let realtimeOnUserTranscriptLost: (() => void) | null = null;

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
  useRealtimeChat: (options?: {
    onMessage?: (role: 'user' | 'assistant', content: string) => void;
    onUserTranscriptLost?: () => void;
  }) => {
    realtimeOnMessage = options?.onMessage ?? null;
    realtimeOnUserTranscriptLost = options?.onUserTranscriptLost ?? null;
    return {
      isConnected: false,
      isListening: false,
      isSpeaking: false,
      messages: [],
      error: null,
      connect: connectMock,
      disconnect: disconnectMock,
      clearMessages: clearMessagesMock,
      injectPromoteBack: injectPromoteBackSpy,
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
    postCoachChipMock.mockResolvedValue({ chip: null, resteer: null });
    getCoachChipsMock.mockReset();
    getCoachChipsMock.mockResolvedValue([]);
    injectPromoteBackSpy.mockReset();
    realtimeOnMessage = null;
    realtimeOnUserTranscriptLost = null;

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

  it('hydrates coach chips from the backend and renders them in FeedbackSidecar', async () => {
    const PERSISTED_CHIP: import('@/api/coachChips').CoachChip = {
      turn_index: 3,
      generated_at: '2026-06-24T10:00:00Z',
      model: 'gpt-5.4-mini',
      surface: 'voice',
      utterance: 'voy a la tienda',
      better: 'Yo voy a la tienda',
      why: 'Adding the subject pronoun makes the sentence clearer.',
      target: null,
      confidence_caveat: false,
    };

    getCoachChipsMock.mockResolvedValue([PERSISTED_CHIP]);

    render(
      <AssignmentPracticeWorkspace
        open
        bootstrap={BOOTSTRAP}
        onClose={vi.fn()}
      />
    );

    // Verify the fetch was called with the active session id
    await waitFor(() => {
      expect(getCoachChipsMock).toHaveBeenCalledWith(ACTIVE_SESSION.id);
    });

    // Verify the persisted chip's `better` text is actually rendered in FeedbackSidecar
    expect(await screen.findByText('Yo voy a la tienda')).toBeInTheDocument();
  });

  it('merges live postCoachChip and hydrated getCoachChips chips without clobbering either', async () => {
    // Use a text-modality session so we can trigger postCoachChip via a text send.
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

    // Live chip produced by postCoachChip (turn_index 2)
    const LIVE_CHIP: import('@/api/coachChips').CoachChip = {
      turn_index: 2,
      generated_at: '2026-06-24T10:01:00Z',
      model: 'gpt-5.4-mini',
      surface: 'text',
      utterance: 'je voudrais un cafe',
      better: 'Je voudrais un café, s\'il vous plaît.',
      why: 'Adding the polite closer improves register.',
      target: null,
      confidence_caveat: false,
    };

    // Persisted chip from getCoachChips (different turn_index 5)
    const HYDRATED_CHIP: import('@/api/coachChips').CoachChip = {
      turn_index: 5,
      generated_at: '2026-06-24T09:00:00Z',
      model: 'gpt-5.4-mini',
      surface: 'text',
      utterance: 'voy a la tienda',
      better: 'Yo voy a la tienda',
      why: 'Subject pronoun clarifies the sentence.',
      target: null,
      confidence_caveat: false,
    };

    // Hold getCoachChips resolution until after the live chip fires
    let resolveHydration!: (chips: import('@/api/coachChips').CoachChip[]) => void;
    getCoachChipsMock.mockReturnValue(new Promise<import('@/api/coachChips').CoachChip[]>((resolve) => {
      resolveHydration = resolve;
    }));

    postCoachChipMock.mockResolvedValue({ chip: LIVE_CHIP, resteer: null });
    sendChatMessageMock.mockResolvedValue({ response: 'Très bien !' });
    reportPracticeSessionEventMock.mockResolvedValue(undefined);
    getStudentAssignmentWorkspaceMock.mockResolvedValue(TEXT_WORKSPACE);

    render(
      <AssignmentPracticeWorkspace
        open
        bootstrap={TEXT_BOOTSTRAP}
        onClose={vi.fn()}
      />
    );

    // Wait for text input to be ready
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Type your assignment response...')).toBeInTheDocument();
    });

    // Send a message — triggers postCoachChip which appends the live chip
    const input = screen.getByPlaceholderText('Type your assignment response...');
    fireEvent.change(input, { target: { value: 'je voudrais un cafe' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    // Wait for the live chip to appear in the sidecar
    expect(await screen.findByText('Je voudrais un café, s\'il vous plaît.')).toBeInTheDocument();

    // Now resolve the hydration fetch with a chip at a DIFFERENT turn_index
    resolveHydration([HYDRATED_CHIP]);

    // Both the live chip AND the hydrated chip must be rendered (merge, not overwrite)
    await waitFor(() => {
      expect(screen.getByText('Je voudrais un café, s\'il vous plaît.')).toBeInTheDocument();
      expect(screen.getByText('Yo voy a la tienda')).toBeInTheDocument();
    });
  });

  it('clears coach chips when switching to a historical thread with no active session', async () => {
    // WORKSPACE already has two threads:
    //   chat-1 → ACTIVE_SESSION (status: active) — has coach chips
    //   chat-2 → HISTORICAL_SESSION (status: completed) — no active session

    const CHIP_FOR_ACTIVE: import('@/api/coachChips').CoachChip = {
      turn_index: 1,
      generated_at: '2026-06-24T10:00:00Z',
      model: 'gpt-5.4-mini',
      surface: 'voice',
      utterance: 'je voudrais un cafe',
      better: 'UniqueChipTextForLeakTest',
      why: 'Subject pronoun clarifies.',
      target: null,
      confidence_caveat: false,
    };

    // Active session's chips resolve immediately
    getCoachChipsMock.mockResolvedValue([CHIP_FOR_ACTIVE]);

    render(
      <AssignmentPracticeWorkspace
        open
        bootstrap={BOOTSTRAP}
        onClose={vi.fn()}
      />
    );

    // Wait for the chip from the active session to appear
    expect(await screen.findByText('UniqueChipTextForLeakTest')).toBeInTheDocument();

    // Now switch to the historical thread (no active session)
    fireEvent.click(screen.getByRole('button', { name: /Past attempt thread/i }));

    // After the switch, the chip must be gone (no stale-chip leak)
    await waitFor(() => {
      expect(screen.queryByText('UniqueChipTextForLeakTest')).not.toBeInTheDocument();
    });
  });

  it('injects a voice promote chip into the main channel via injectPromoteBack', async () => {
    const PROMOTE_CHIP: import('@/api/coachChips').CoachChip = {
      turn_index: 0,
      generated_at: 'now',
      model: 'm',
      surface: 'voice',
      utterance: 'Yo va',
      better: 'Yo voy',
      why: 'ir',
      target: 'focus_grammar:ir',
      confidence_caveat: false,
      promote: true,
      promote_prompt: 'COACH NOTE: try voy',
      promote_reason: 'hard_target',
    };
    postCoachChipMock.mockResolvedValue({ chip: PROMOTE_CHIP, resteer: null });
    saveMessageToChatMock.mockResolvedValue(undefined);
    reportPracticeSessionEventMock.mockResolvedValue(undefined);

    render(
      <AssignmentPracticeWorkspace
        open
        bootstrap={BOOTSTRAP}
        onClose={vi.fn()}
      />
    );

    // Wait for the workspace to load and voice connect button to appear
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Tap the mic to connect/i })).toBeInTheDocument();
    });

    // Connect voice (selectedActivePracticeSession is ACTIVE_SESSION from WORKSPACE)
    fireEvent.click(screen.getByRole('button', { name: /Tap the mic to connect/i }));

    await waitFor(() => {
      expect(connectMock).toHaveBeenCalled();
    });

    // Drive a learner turn followed by an assistant turn to trigger triggerCoachChip
    await act(async () => {
      realtimeOnMessage?.('user', 'Yo va al tienda');
    });
    await act(async () => {
      realtimeOnMessage?.('assistant', '¿Otra vez?');
    });

    // The assistant turn should trigger triggerCoachChip, which sees promote:true + voice → injectPromoteBack
    await waitFor(() => {
      expect(injectPromoteBackSpy).toHaveBeenCalledWith('COACH NOTE: try voy');
    });
  });

  it('attaches a pending text promote note to the NEXT send then clears it', async () => {
    const TEXT_PROMOTE: import('@/api/coachChips').CoachChip = {
      turn_index: 0,
      generated_at: 'now',
      model: 'm',
      surface: 'text',
      utterance: 'Yo va',
      better: 'Yo voy',
      why: 'ir',
      target: 'focus_grammar:ir',
      confidence_caveat: false,
      promote: true,
      promote_prompt: 'COACH NOTE: try voy',
      promote_reason: 'hard_target',
    };

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
    // First send: postCoachChip returns a text promote chip
    postCoachChipMock.mockResolvedValue({ chip: TEXT_PROMOTE, resteer: null });
    sendChatMessageMock.mockResolvedValue({ response: 'Bien' });
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

    // First send — triggerCoachChip fires with TEXT_PROMOTE, sets pendingPromoteBackRef
    fireEvent.change(input, { target: { value: 'Yo voy' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(postCoachChipMock).toHaveBeenCalledWith(TEXT_SESSION.id, expect.any(Number));
    });

    // Second send — coachNote should be attached from the pending promote
    postCoachChipMock.mockResolvedValue({ chip: null, resteer: null });
    fireEvent.change(input, { target: { value: 'Second message' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      const lastOpts = sendChatMessageMock.mock.calls.at(-1)?.[2];
      expect(lastOpts).toMatchObject({ coachNote: 'COACH NOTE: try voy' });
    });

    // Third send — pending note was cleared after one use, coachNote must be absent
    fireEvent.change(input, { target: { value: 'Third message' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      const lastOpts = sendChatMessageMock.mock.calls.at(-1)?.[2];
      expect(lastOpts?.coachNote).toBeUndefined();
    });
  });

  it('routes a director resteer through the coachNote on the next text send', async () => {
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
    // First send: postCoachChip returns a resteer (chip: null)
    postCoachChipMock.mockResolvedValue({
      chip: null,
      resteer: {
        surface: 'text', resteer: true, resteer_prompt: 'COACH NOTE: steer to la cuenta',
        turn_index: 2, kind: 'target_neglect', target: 'la cuenta', reason: 'r', generated_at: 'T',
      },
    });
    sendChatMessageMock.mockResolvedValue({ response: 'Bien' });
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

    // First send — triggerCoachChip fires with resteer, sets pendingPromoteBackRef
    fireEvent.change(input, { target: { value: 'Yo voy' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(postCoachChipMock).toHaveBeenCalledWith(TEXT_SESSION.id, expect.any(Number));
    });

    // Second send — coachNote should carry the resteer_prompt
    postCoachChipMock.mockResolvedValue({ chip: null, resteer: null });
    fireEvent.change(input, { target: { value: 'Second message' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      const lastOpts = sendChatMessageMock.mock.calls.at(-1)?.[2];
      expect(lastOpts).toMatchObject({ coachNote: 'COACH NOTE: steer to la cuenta' });
    });
  });

  it('merges a same-turn promote + resteer into ONE text coachNote (no clobber)', async () => {
    const TEXT_PROMOTE: import('@/api/coachChips').CoachChip = {
      turn_index: 0,
      generated_at: 'now',
      model: 'm',
      surface: 'text',
      utterance: 'Yo va',
      better: 'Yo voy',
      why: 'ir',
      target: 'focus_grammar:ir',
      confidence_caveat: false,
      promote: true,
      promote_prompt: 'PROMOTE: try voy',
      promote_reason: 'hard_target',
    };

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
    // First send: postCoachChip returns BOTH a text promote chip AND a text resteer
    postCoachChipMock.mockResolvedValue({
      chip: TEXT_PROMOTE,
      resteer: {
        surface: 'text', resteer: true, resteer_prompt: 'RESTEER: speak Spanish',
        turn_index: 0, kind: 'target_neglect', target: 'voy', reason: 'r', generated_at: 'T',
      },
    });
    sendChatMessageMock.mockResolvedValue({ response: 'Bien' });
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

    // First send — triggerCoachChip fires with both chip+resteer, should merge into pendingPromoteBackRef
    fireEvent.change(input, { target: { value: 'Yo voy' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(postCoachChipMock).toHaveBeenCalledWith(TEXT_SESSION.id, expect.any(Number));
    });

    // Second send — coachNote should contain BOTH the resteer prompt AND the promote prompt
    postCoachChipMock.mockResolvedValue({ chip: null, resteer: null });
    fireEvent.change(input, { target: { value: 'Second message' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      const lastOpts = sendChatMessageMock.mock.calls.at(-1)?.[2];
      expect(lastOpts?.coachNote).toContain('RESTEER: speak Spanish');
      expect(lastOpts?.coachNote).toContain('PROMOTE: try voy');
    });
  });

  it('merges a same-turn promote + resteer into ONE voice injectPromoteBack call', async () => {
    const PROMOTE_CHIP: import('@/api/coachChips').CoachChip = {
      turn_index: 0,
      generated_at: 'now',
      model: 'm',
      surface: 'voice',
      utterance: 'Yo va',
      better: 'Yo voy',
      why: 'ir',
      target: 'focus_grammar:ir',
      confidence_caveat: false,
      promote: true,
      promote_prompt: 'PROMOTE: try voy',
      promote_reason: 'hard_target',
    };
    postCoachChipMock.mockResolvedValue({
      chip: PROMOTE_CHIP,
      resteer: { surface: 'voice', resteer: true, resteer_prompt: 'RESTEER: speak Spanish' },
    });
    saveMessageToChatMock.mockResolvedValue(undefined);
    reportPracticeSessionEventMock.mockResolvedValue(undefined);

    render(
      <AssignmentPracticeWorkspace
        open
        bootstrap={BOOTSTRAP}
        onClose={vi.fn()}
      />
    );

    // Wait for the workspace to load and voice connect button to appear
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Tap the mic to connect/i })).toBeInTheDocument();
    });

    // Connect voice
    fireEvent.click(screen.getByRole('button', { name: /Tap the mic to connect/i }));

    await waitFor(() => {
      expect(connectMock).toHaveBeenCalled();
    });

    // Drive a learner turn followed by an assistant turn to trigger triggerCoachChip
    await act(async () => {
      realtimeOnMessage?.('user', 'Yo va al tienda');
    });
    await act(async () => {
      realtimeOnMessage?.('assistant', '¿Otra vez?');
    });

    // triggerCoachChip should call injectPromoteBack EXACTLY ONCE with the merged string
    await waitFor(() => {
      expect(injectPromoteBackSpy).toHaveBeenCalledTimes(1);
    });
    const arg = injectPromoteBackSpy.mock.calls[0][0];
    expect(arg).toContain('RESTEER: speak Spanish');
    expect(arg).toContain('PROMOTE: try voy');
  });

  it('emits metric.voice_transcript_lost when the realtime hook reports a dropped user transcript', async () => {
    reportPracticeSessionEventMock.mockResolvedValue(undefined);

    render(
      <AssignmentPracticeWorkspace
        open
        bootstrap={BOOTSTRAP}
        onClose={vi.fn()}
      />
    );

    // Wait for the workspace to load and voice connect button to appear
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Tap the mic to connect/i })).toBeInTheDocument();
    });

    // Connect voice (selectedActivePracticeSession is ACTIVE_SESSION from WORKSPACE)
    fireEvent.click(screen.getByRole('button', { name: /Tap the mic to connect/i }));

    await waitFor(() => {
      expect(connectMock).toHaveBeenCalled();
    });

    // Simulate the realtime hook detecting a dropped/unusable ASR transcript
    await act(async () => {
      realtimeOnUserTranscriptLost?.();
    });

    await waitFor(() => {
      expect(reportPracticeSessionEventMock).toHaveBeenCalledWith('practice-1', expect.objectContaining({
        eventType: 'metric.voice_transcript_lost',
        payload: { source: 'realtime' },
      }));
    });
  });

  it('does not emit metric.voice_transcript_lost when there is no active realtime persistence target', async () => {
    render(
      <AssignmentPracticeWorkspace
        open
        bootstrap={BOOTSTRAP}
        onClose={vi.fn()}
      />
    );

    // Wait for the workspace to load, but never connect voice — the persistence target stays null
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Tap the mic to connect/i })).toBeInTheDocument();
    });

    realtimeOnUserTranscriptLost?.();

    expect(reportPracticeSessionEventMock).not.toHaveBeenCalled();
  });
});
