import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { AppChatPage } from '@/pages/AppChatPage';
import type { AvatarPerformanceFrame } from '@/components/avatar/types';

const getChatSessionsMock = vi.fn();
const getChatSessionMock = vi.fn();
const createChatSessionMock = vi.fn();
const saveMessageToChatMock = vi.fn();
const sendChatMessageMock = vi.fn();
const deleteChatSessionMock = vi.fn();
const getUserProfileMock = vi.fn();
const getAssessmentResultsMock = vi.fn();
let voiceOnMessage: ((role: 'user' | 'assistant', content: string) => void) | undefined;
let latestRealtimeOptions: { sessionParams?: { avatarDirectives?: boolean } } | undefined;

const legacyRealtimeState = {
  isConnected: true,
  isListening: false,
  isSpeaking: false,
  messages: [],
  remoteAudioStream: null,
  assistantTranscriptDelta: '',
  assistantTranscriptFinal: '',
  assistantSpeechStartedAt: null,
  assistantSpeechEndedAt: null,
  avatarDirective: null,
  avatarDirectiveSource: 'fallback' as const,
  avatarDiagnostics: {
    audioLevel: 0,
    rmsLevel: 0,
    hasRemoteAudio: false,
    speakingEventState: 'idle' as const,
    mouthTarget: 0,
    paramA: null,
    paramI: null,
    paramU: null,
    paramE: null,
    paramO: null,
    lastExplicitDirective: null,
    source: 'fallback' as const,
    directiveRequested: false,
    stats: {
      directiveEventCount: 0,
      avatarHitCount: 0,
      assistantSpeechTurnCount: 0,
      directiveSpeechTurnCount: 0,
      fallbackSpeechTurnCount: 0,
    },
  },
  error: null,
  connect: vi.fn(),
  disconnect: vi.fn(),
  startListening: vi.fn(),
  stopListening: vi.fn(),
  clearMessages: vi.fn(),
  queueAvatarHit: vi.fn(),
};

const avatarPerformanceState: AvatarPerformanceFrame = {
  dialogueState: 'idle',
  affect: 'neutral',
  intensity: 0.1,
  jawOpen: 0.01,
  mouthRound: 0.02,
  mouthSpread: 0.02,
  smile: 0.04,
  browInnerUp: 0.03,
  browOuterUp: 0.02,
  browDown: 0.02,
  blink: 0,
  gazeYaw: 0,
  gazePitch: 0,
  headPitch: 0,
  headYaw: 0,
  headRoll: 0,
  neckPitch: 0,
  chestPitch: 0,
  directive: null,
  directiveSource: 'fallback',
  debug: {
    audioLevel: 0,
    rmsLevel: 0,
    transcript: '',
    hasRemoteAudio: false,
    speakingEventState: 'idle',
    mouthTarget: 0.01,
    detectedExpressionKeys: [],
    directiveSource: 'fallback',
    lastExplicitDirective: null,
  },
};

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useSearchParams: () => [new URLSearchParams()],
  };
});

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
}));

vi.mock('@/hooks/useRealtimeChat', () => ({
  useRealtimeChat: (options?: { onMessage?: (role: 'user' | 'assistant', content: string) => void }) => {
    voiceOnMessage = options?.onMessage;
    latestRealtimeOptions = options;
    return legacyRealtimeState;
  },
}));

vi.mock('@/components/avatar/useAvatarPerformance', () => ({
  useAvatarPerformance: () => ({
    ...avatarPerformanceState,
    debug: {
      ...avatarPerformanceState.debug,
    },
  }),
}));

vi.mock('@/components/avatar/Live2DAvatarPanel', () => ({
  default: ({
    avatarState,
    avatarReaction,
    audioLevel,
    statusLabel,
    onAvatarHit,
    avatarDiagnostics,
  }: {
    avatarState: unknown;
    avatarReaction: unknown;
    audioLevel: number;
    statusLabel: string;
    onAvatarHit?: (area: string) => void;
    avatarDiagnostics?: unknown;
  }) => (
    <div
      data-testid="live2d-avatar"
      data-status-label={statusLabel}
      data-audio-level={String(audioLevel)}
      data-avatar-state={JSON.stringify(avatarState)}
      data-avatar-reaction={JSON.stringify(avatarReaction)}
      data-avatar-diagnostics={JSON.stringify(avatarDiagnostics)}
      data-has-avatar-hit={String(Boolean(onAvatarHit))}
    />
  ),
}));

vi.mock('@/components/avatar/AvatarPerformancePanel', () => ({
  default: () => <div data-testid="legacy-avatar" />,
}));

vi.mock('@/components/chat', () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}));

vi.mock('@/components/learning', () => ({
  ChatSessionsSidebar: () => <div data-testid="chat-sessions-sidebar" />,
}));

vi.mock('@/components/ui', () => ({
  Button: ({
    children,
    loading,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => {
    void loading;
    return <button {...props}>{children}</button>;
  },
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/api/chat', () => ({
  getChatSessions: (...args: unknown[]) => getChatSessionsMock(...args),
  getChatSession: (...args: unknown[]) => getChatSessionMock(...args),
  createChatSession: (...args: unknown[]) => createChatSessionMock(...args),
  saveMessageToChat: (...args: unknown[]) => saveMessageToChatMock(...args),
  sendChatMessage: (...args: unknown[]) => sendChatMessageMock(...args),
  deleteChatSession: (...args: unknown[]) => deleteChatSessionMock(...args),
}));

vi.mock('@/api/user', () => ({
  getUserProfile: (...args: unknown[]) => getUserProfileMock(...args),
}));

vi.mock('@/api/assessment', () => ({
  getAssessmentResults: (...args: unknown[]) => getAssessmentResultsMock(...args),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    avatarUrl: null,
  }),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    lang: 'en',
    t: (key: string) =>
      ({
        'app.learn.status.connecting': 'Connecting',
        'app.learn.status.tapToConnect': 'Tap to connect',
        'app.learn.status.aiSpeaking': 'AI speaking',
        'app.learn.status.listening': 'Listening',
        'app.learn.status.ready': 'Ready',
        'app.learn.status.aiResponding': 'AI responding',
        'app.learn.chat.title': 'Conversation Tutor',
        'app.learn.chat.label': 'Chat',
        'app.learn.chat.input.connected': 'Connected',
        'app.learn.chat.input.disconnected': 'Disconnected',
        'chat.textMode': 'Text',
        'chat.voiceMode': 'Voice',
        'app.learn.sessions.title': 'Sessions',
        'app.learn.path.title': 'Path',
        'app.learn.chat.loading': 'Loading',
        'app.learn.chat.empty': 'Empty',
        'app.learn.sessions.subtitle': 'Session list',
        'chat.placeholder': 'Message',
      })[key] || key,
  }),
}));

describe('AppChatPage live2d avatar wiring', () => {
  beforeEach(() => {
    Object.assign(legacyRealtimeState, {
      isConnected: true,
      isListening: false,
      isSpeaking: false,
      messages: [],
      remoteAudioStream: null,
      assistantTranscriptDelta: '',
      assistantTranscriptFinal: '',
      assistantSpeechStartedAt: null,
      assistantSpeechEndedAt: null,
      avatarDirective: null,
      avatarDirectiveSource: 'fallback',
      avatarDiagnostics: {
        audioLevel: 0,
        rmsLevel: 0,
        hasRemoteAudio: false,
        speakingEventState: 'idle',
        mouthTarget: 0,
        paramA: null,
        paramI: null,
        paramU: null,
        paramE: null,
        paramO: null,
        lastExplicitDirective: null,
        source: 'fallback',
        directiveRequested: false,
        stats: {
          directiveEventCount: 0,
          avatarHitCount: 0,
          assistantSpeechTurnCount: 0,
          directiveSpeechTurnCount: 0,
          fallbackSpeechTurnCount: 0,
        },
      },
      error: null,
    });
    Object.assign(avatarPerformanceState, {
      dialogueState: 'idle',
      affect: 'neutral',
      intensity: 0.1,
      jawOpen: 0.01,
      mouthRound: 0.02,
      mouthSpread: 0.02,
      smile: 0.04,
      browInnerUp: 0.03,
      browOuterUp: 0.02,
      browDown: 0.02,
      blink: 0,
      gazeYaw: 0,
      gazePitch: 0,
      headPitch: 0,
      headYaw: 0,
      headRoll: 0,
      neckPitch: 0,
      chestPitch: 0,
      debug: {
        audioLevel: 0,
        rmsLevel: 0,
        transcript: '',
        hasRemoteAudio: false,
        speakingEventState: 'idle',
        mouthTarget: 0.01,
        detectedExpressionKeys: [],
        directiveSource: 'fallback',
        lastExplicitDirective: null,
      },
    });

    getChatSessionsMock.mockReset();
    getChatSessionMock.mockReset();
    createChatSessionMock.mockReset();
    saveMessageToChatMock.mockReset();
    sendChatMessageMock.mockReset();
    deleteChatSessionMock.mockReset();
    getUserProfileMock.mockReset();
    getAssessmentResultsMock.mockReset();
    voiceOnMessage = undefined;
    latestRealtimeOptions = undefined;

    getChatSessionsMock.mockResolvedValue([
      {
        id: 'chat-1',
        title: 'Realtime practice',
        created_at: '2026-03-06T00:00:00.000Z',
        updated_at: '2026-03-06T00:00:00.000Z',
        message_count: 0,
      },
    ]);
    getChatSessionMock.mockResolvedValue({
      id: 'chat-1',
      title: 'Realtime practice',
      messages: [],
    });
    getUserProfileMock.mockResolvedValue({
      assessed: false,
      selectedCategories: [],
    });
    getAssessmentResultsMock.mockResolvedValue(null);
    saveMessageToChatMock.mockResolvedValue({
      success: true,
      message: { role: 'user', content: '', timestamp: '' },
      title: null,
    });

    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      media: '(min-width: 1024px)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    // AppChatPage reads its avatar-enabled preference from localStorage and
    // defaults to `false` when nothing is stored. The avatar panel is only
    // rendered when the preference is truthy, so explicitly opt in for this
    // test suite — this matches the real-user flow where someone toggles the
    // avatar on and the preference persists across sessions.
    window.localStorage.clear();
    window.localStorage.setItem('lingual:chat:avatarEnabled', 'true');
  });

  it('forces avatar off for the pilot even when local storage says it was enabled', async () => {
    render(<AppChatPage />);

    await waitFor(() => {
      expect(screen.getByText('Realtime practice')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('live2d-avatar')).not.toBeInTheDocument();
    expect(latestRealtimeOptions?.sessionParams?.avatarDirectives).toBe(false);
  });

  it('still saves finalized realtime voice messages with sequential sortOrder metadata', async () => {
    render(<AppChatPage />);

    await waitFor(() => {
      expect(screen.getByText('Realtime practice')).toBeInTheDocument();
    });

    await act(async () => {
      voiceOnMessage?.('user', '안녕하세요');
      voiceOnMessage?.('assistant', '안녕하세요. 다시 해볼까요?');
      voiceOnMessage?.('user', '좋아요');
    });

    expect(saveMessageToChatMock).toHaveBeenNthCalledWith(
      1,
      'chat-1',
      'user',
      '안녕하세요',
      expect.objectContaining({ sortOrder: 0 })
    );
    expect(saveMessageToChatMock).toHaveBeenNthCalledWith(
      2,
      'chat-1',
      'assistant',
      '안녕하세요. 다시 해볼까요?',
      expect.objectContaining({ sortOrder: 1 })
    );
    expect(saveMessageToChatMock).toHaveBeenNthCalledWith(
      3,
      'chat-1',
      'user',
      '좋아요',
      expect.objectContaining({ sortOrder: 2 })
    );
  });
});
