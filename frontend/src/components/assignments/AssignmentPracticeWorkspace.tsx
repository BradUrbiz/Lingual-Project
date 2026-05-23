import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, History, Loader2, MessageSquareText, Mic } from 'lucide-react';
import {
  createAssignmentPracticeSession,
  getStudentAssignmentWorkspace,
  reportPracticeSessionEvent,
} from '@/api/assignments';
import { createChatSession, getChatSession, saveMessageToChat, sendChatMessage } from '@/api/chat';
import { ChatInput, ChatMessage } from '@/components/chat';
import { Alert, AlertDescription, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui';
import { useLanguage } from '@/contexts/LanguageContext';
import { useRealtimeChat } from '@/hooks/useRealtimeChat';
import type { AssignmentBootstrapData, AssignmentWorkspaceData, ChatMessage as ChatMessageType, PracticeSessionDto } from '@/types';
import { AssignmentContextPanel } from './AssignmentContextPanel';
import { AssignmentThreadSidebar } from './AssignmentThreadSidebar';

interface AssignmentPracticeWorkspaceProps {
  open: boolean;
  bootstrap: AssignmentBootstrapData | null;
  onClose: () => void;
}

function buildRealtimeSessionParams(
  bootstrap: AssignmentBootstrapData,
  practiceSession?: PracticeSessionDto | null,
) {
  return {
    ...bootstrap.realtimeSessionParams,
    practice: {
      ...bootstrap.realtimeSessionParams.practice,
      ...(practiceSession ? { practiceSessionId: practiceSession.id } : {}),
    },
  };
}

function mergeActivePracticeSessionIntoWorkspace(
  workspace: AssignmentWorkspaceData,
  practiceSession: PracticeSessionDto | null | undefined,
  fallbackTitle: string,
): AssignmentWorkspaceData {
  const chatId = practiceSession?.chatId?.trim();
  if (!chatId || practiceSession?.status !== 'active') {
    return workspace;
  }

  let foundThread = false;
  const threads = workspace.threads.map((thread) => {
    const attemptsWithoutDuplicate = thread.attempts
      .filter((attempt) => attempt.id !== practiceSession.id)
      .map((attempt) => (
        attempt.status === 'active'
          ? { ...attempt, status: 'completed' }
          : attempt
      ));

    if (thread.chatId !== chatId) {
      const latestPracticeSession = thread.latestPracticeSession?.status === 'active'
        ? { ...thread.latestPracticeSession, status: 'completed' }
        : thread.latestPracticeSession;
      return {
        ...thread,
        latestPracticeSession,
        attempts: attemptsWithoutDuplicate,
        hasActiveAttempt: false,
      };
    }

    foundThread = true;
    return {
      ...thread,
      hasActiveAttempt: true,
      latestPracticeSession: practiceSession,
      attempts: [practiceSession, ...attemptsWithoutDuplicate],
    };
  });

  if (!foundThread) {
    threads.unshift({
      chatId,
      title: fallbackTitle,
      updatedAt: practiceSession.startedAt ?? null,
      messageCount: 0,
      hasActiveAttempt: true,
      latestPracticeSession: practiceSession,
      attempts: [practiceSession],
    });
  }

  return {
    ...workspace,
    selectedChatId: chatId,
    latestActivePracticeSessionId: practiceSession.id,
    threads,
  };
}

export function AssignmentPracticeWorkspace({
  open,
  bootstrap,
  onClose,
}: AssignmentPracticeWorkspaceProps) {
  const { lang } = useLanguage();
  const [workspace, setWorkspace] = useState<AssignmentWorkspaceData | null>(null);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [historyMessages, setHistoryMessages] = useState<ChatMessageType[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSendingText, setIsSendingText] = useState(false);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const [isScopeExpanded, setIsScopeExpanded] = useState(true);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(true);
  const [textInput, setTextInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const selectedChatIdRef = useRef<string | null>(null);
  const nextMessageOrderRef = useRef(0);
  const closeWithoutAbandonRef = useRef(false);
  const activePracticeSessionRef = useRef<PracticeSessionDto | null>(null);
  const realtimePersistenceTargetRef = useRef<{ practiceSessionId: string; chatId: string } | null>(null);

  const selectedThread = useMemo(
    () => workspace?.threads.find((thread) => thread.chatId === selectedChatId) ?? null,
    [workspace, selectedChatId],
  );

  const activePracticeSession = useMemo(
    () => workspace?.threads.flatMap((thread) => thread.attempts).find((attempt) => attempt.id === workspace.latestActivePracticeSessionId) ?? null,
    [workspace],
  );

  const selectedActivePracticeSession = useMemo(
    () => selectedThread?.attempts.find((attempt) => attempt.status === 'active') ?? null,
    [selectedThread],
  );

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  useEffect(() => {
    activePracticeSessionRef.current = activePracticeSession;
  }, [activePracticeSession]);

  const realtimeSessionParams = useMemo(
    () => (bootstrap ? buildRealtimeSessionParams(bootstrap, selectedActivePracticeSession) : undefined),
    [bootstrap, selectedActivePracticeSession],
  );

  const queuePracticeEvent = async (
    practiceSessionId: string,
    eventType: string,
    turnIndex: number | null,
    payload: Record<string, unknown>,
  ) => {
    await reportPracticeSessionEvent(practiceSessionId, {
      eventType,
      turnIndex,
      payload,
    });
  };

  const clearRealtimePersistenceTarget = () => {
    realtimePersistenceTargetRef.current = null;
  };

  const setRealtimePersistenceTarget = (practiceSession: PracticeSessionDto, chatId?: string | null) => {
    const resolvedChatId = (chatId ?? practiceSession.chatId ?? '').trim();
    if (!practiceSession.id || !resolvedChatId) {
      realtimePersistenceTargetRef.current = null;
      return;
    }
    realtimePersistenceTargetRef.current = {
      practiceSessionId: practiceSession.id,
      chatId: resolvedChatId,
    };
  };

  const persistRealtimeMessage = async (role: 'user' | 'assistant', content: string) => {
    const persistenceTarget = realtimePersistenceTargetRef.current;
    if (!persistenceTarget || !content.trim()) return;

    const timestamp = new Date().toISOString();
    const sortOrder = nextMessageOrderRef.current;
    nextMessageOrderRef.current += 1;

    try {
      await saveMessageToChat(persistenceTarget.chatId, role, content, { timestamp, sortOrder });
      await queuePracticeEvent(
        persistenceTarget.practiceSessionId,
        role === 'user' ? 'student.turn' : 'assistant.turn',
        sortOrder,
        {
          chatId: persistenceTarget.chatId,
          content,
          source: 'realtime',
        },
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save realtime assignment message.');
    }
  };

  const {
    isConnected,
    isListening,
    isSpeaking,
    messages: realtimeMessages,
    connect,
    disconnect,
    clearMessages,
  } = useRealtimeChat({
    onMessage: (role, content) => {
      void persistRealtimeMessage(role, content);
    },
    sessionParams: realtimeSessionParams,
  });

  const loadWorkspace = useCallback(async (
    preferredChatId?: string | null,
    optimisticActiveSession?: PracticeSessionDto | null,
    optimisticThreadTitle = 'Assignment thread',
  ) => {
    if (!bootstrap) return;
    setLoading(true);
    setError(null);
    try {
      const fetchedWorkspace = await getStudentAssignmentWorkspace(bootstrap.assignment.id);
      const nextWorkspace = optimisticActiveSession
        ? mergeActivePracticeSessionIntoWorkspace(fetchedWorkspace, optimisticActiveSession, optimisticThreadTitle)
        : fetchedWorkspace;
      setWorkspace(nextWorkspace);
      const nextSelectedChatId = preferredChatId || nextWorkspace.selectedChatId || nextWorkspace.threads[0]?.chatId || null;
      setSelectedChatId(nextSelectedChatId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load assignment workspace.');
    } finally {
      setLoading(false);
    }
  }, [bootstrap]);

  const applyOptimisticActivePracticeSession = (
    practiceSession: PracticeSessionDto,
    fallbackTitle: string,
  ) => {
    setWorkspace((currentWorkspace) => (
      currentWorkspace
        ? mergeActivePracticeSessionIntoWorkspace(currentWorkspace, practiceSession, fallbackTitle)
        : currentWorkspace
    ));
    const nextChatId = practiceSession.chatId?.trim() || selectedChatIdRef.current || null;
    selectedChatIdRef.current = nextChatId;
    setSelectedChatId(nextChatId);
  };

  useEffect(() => {
    if (!open || !bootstrap) return;
    closeWithoutAbandonRef.current = false;
    void loadWorkspace();
  }, [open, bootstrap, loadWorkspace]);

  useEffect(() => {
    let isActive = true;
    if (!open || !selectedChatId) {
      setHistoryMessages([]);
      return;
    }

    const loadChat = async () => {
      setLoadingChat(true);
      clearRealtimePersistenceTarget();
      clearMessages();
      disconnect();
      try {
        const chat = await getChatSession(selectedChatId);
        if (!isActive) return;
        const formattedMessages = chat.messages.map((message, index) => ({
          id: `${selectedChatId}-${index}`,
          role: message.role,
          content: message.content,
          timestamp: message.timestamp,
        }));
        nextMessageOrderRef.current = formattedMessages.length;
        setHistoryMessages(formattedMessages);
      } catch (chatError) {
        if (!isActive) return;
        setError(chatError instanceof Error ? chatError.message : 'Failed to load assignment thread.');
      } finally {
        if (isActive) setLoadingChat(false);
      }
    };

    void loadChat();
    return () => {
      isActive = false;
    };
  }, [open, selectedChatId, clearMessages, disconnect]);

  const endActivePracticeSession = async (reason: string) => {
    if (!activePracticeSession) return;
    await reportPracticeSessionEvent(activePracticeSession.id, {
      eventType: 'session.ended',
      payload: {
        reason,
        status: 'completed',
        chatId: activePracticeSession.chatId,
      },
    });
  };

  const ensureActivePracticeSessionForSelectedThread = async () => {
    if (selectedActivePracticeSession) return selectedActivePracticeSession;
    if (!bootstrap || !selectedThread) return null;

    clearRealtimePersistenceTarget();
    if (activePracticeSession) {
      await endActivePracticeSession('thread_resumed');
    }

    clearMessages();
    disconnect();
    const resumedPracticeSession = await createAssignmentPracticeSession(bootstrap.assignment.id, {
      uiLanguage: lang,
      chatId: selectedThread.chatId,
    });
    const normalizedPracticeSession = resumedPracticeSession.chatId?.trim()
      ? resumedPracticeSession
      : { ...resumedPracticeSession, chatId: selectedThread.chatId };
    activePracticeSessionRef.current = normalizedPracticeSession;
    applyOptimisticActivePracticeSession(normalizedPracticeSession, selectedThread.title);
    return normalizedPracticeSession;
  };

  const handleNewAttempt = async () => {
    if (!bootstrap) return;
    setIsMutating(true);
    setError(null);
    try {
      clearRealtimePersistenceTarget();
      if (activePracticeSession) {
        await endActivePracticeSession('restarted');
      }
      clearMessages();
      disconnect();
      const createdChat = await createChatSession(`ASM ${bootstrap.assignment.title}`);
      const createdPracticeSession = await createAssignmentPracticeSession(bootstrap.assignment.id, {
        uiLanguage: lang,
        chatId: createdChat.chatId,
      });
      await loadWorkspace(createdChat.chatId, createdPracticeSession, createdChat.title);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to start a new attempt.');
    } finally {
      setIsMutating(false);
    }
  };

  const handleVoiceToggle = async () => {
    if (!bootstrap || !selectedThread || isConnecting || isMutating) return;
    setError(null);

    if (isConnected) {
      clearRealtimePersistenceTarget();
      disconnect();
      return;
    }

    setIsMutating(true);
    setIsConnecting(true);
    try {
      const practiceSession = await ensureActivePracticeSessionForSelectedThread();
      if (!practiceSession) return;
      if (!practiceSession.voiceEnabled) {
        setError('Voice is not enabled for this assignment attempt.');
        return;
      }
      activePracticeSessionRef.current = practiceSession;
      selectedChatIdRef.current = practiceSession.chatId || selectedChatId;
      setRealtimePersistenceTarget(practiceSession, practiceSession.chatId || selectedChatId);
      await connect(buildRealtimeSessionParams(bootstrap, practiceSession));
    } catch (mutationError) {
      clearRealtimePersistenceTarget();
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to connect assignment voice session.');
    } finally {
      setIsConnecting(false);
      setIsMutating(false);
    }
  };

  const handleEndSession = async () => {
    if (!selectedActivePracticeSession) return;
    setIsMutating(true);
    setError(null);
    try {
      clearRealtimePersistenceTarget();
      await reportPracticeSessionEvent(selectedActivePracticeSession.id, {
        eventType: 'session.ended',
        payload: {
          reason: 'manual_disconnect',
          status: 'completed',
          chatId: selectedActivePracticeSession.chatId,
        },
      });
      clearMessages();
      disconnect();
      await loadWorkspace(selectedActivePracticeSession.chatId || null);
    } catch (endError) {
      setError(endError instanceof Error ? endError.message : 'Failed to end this practice session.');
    } finally {
      setIsMutating(false);
    }
  };

  const handleSendText = async () => {
    if (!bootstrap || !selectedChatId || !textInput.trim() || isSendingText || isMutating) {
      return;
    }
    if (bootstrap.launch.modality.mode !== 'text_only') {
      setError('Text practice is not enabled for this assignment launch.');
      return;
    }

    const message = textInput.trim();
    setIsSendingText(true);
    setError(null);
    setTextInput('');

    try {
      const practiceSession = await ensureActivePracticeSessionForSelectedThread();
      if (!practiceSession) return;
      if (!practiceSession.textEnabled) {
        setError('Text practice is not enabled for this assignment attempt.');
        return;
      }
      const userTurnIndex = nextMessageOrderRef.current;
      const assistantTurnIndex = userTurnIndex + 1;
      nextMessageOrderRef.current += 2;
      const response = await sendChatMessage(selectedChatId, message, {
        assignmentId: bootstrap.assignment.id,
        practiceSessionId: practiceSession.id,
        uiLanguage: lang,
      });
      setHistoryMessages((current) => [
        ...current,
        {
          id: `${selectedChatId}-user-${userTurnIndex}`,
          role: 'user',
          content: message,
          timestamp: new Date().toISOString(),
        },
        {
          id: `${selectedChatId}-assistant-${assistantTurnIndex}`,
          role: 'assistant',
          content: response.response,
          timestamp: new Date().toISOString(),
        },
      ]);
      await queuePracticeEvent(practiceSession.id, 'student.turn', userTurnIndex, {
        chatId: selectedChatId,
        content: message,
        source: 'text',
      });
      await queuePracticeEvent(practiceSession.id, 'assistant.turn', assistantTurnIndex, {
        chatId: selectedChatId,
        content: response.response,
        source: 'text',
      });
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Failed to send assignment message.');
    } finally {
      setIsSendingText(false);
    }
  };

  const handleClose = () => {
    closeWithoutAbandonRef.current = true;
    clearRealtimePersistenceTarget();
    clearMessages();
    disconnect();
    onClose();
  };

  useEffect(() => {
    return () => {
      const practiceSession = activePracticeSessionRef.current;
      clearRealtimePersistenceTarget();
      if (!practiceSession || closeWithoutAbandonRef.current) {
        disconnect();
        return;
      }

      void reportPracticeSessionEvent(practiceSession.id, {
        eventType: 'session.ended',
        payload: {
          reason: 'page_leave',
          status: 'abandoned',
          chatId: selectedChatIdRef.current,
        },
      });
      disconnect();
    };
  }, [disconnect]);

  const displayMessages = useMemo(
    () => [...historyMessages, ...realtimeMessages],
    [historyMessages, realtimeMessages],
  );
  const isTextLaunch = bootstrap?.launch.modality.mode === 'text_only';
  const canUseVoice = Boolean(selectedThread && (selectedActivePracticeSession?.voiceEnabled || (!selectedActivePracticeSession && bootstrap?.launch.voiceAllowed)));
  const canUseText = Boolean(
    isTextLaunch &&
    selectedThread &&
    selectedChatId &&
    (selectedActivePracticeSession?.textEnabled || (!selectedActivePracticeSession && bootstrap?.launch.textAllowed)),
  );
  const voiceStatusLabel = isConnecting
    ? 'Connecting...'
    : isConnected
      ? 'Voice connected'
      : 'Tap the mic to connect';

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) handleClose();
    }}>
      <DialogContent className="grid h-[calc(100dvh-1rem)] max-h-[920px] w-[calc(100vw-1rem)] max-w-[1500px] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden border-3 border-foreground bg-background p-0 shadow-stamp sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)]">
        <DialogHeader className="border-b-2 border-border bg-card px-4 py-4 pr-12 sm:px-6">
          <DialogTitle className="font-display text-2xl">
            {bootstrap?.assignment.title || 'Assignment practice'}
          </DialogTitle>
          <DialogDescription>
            Assignment-scoped conversation workspace with history and teacher guidance.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-[420px] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="p-6">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        ) : bootstrap && workspace ? (
          <div className="flex min-h-0 overflow-hidden bg-background max-lg:flex-col">
            <aside
              className={`flex min-h-0 shrink-0 flex-col border-b-2 border-border bg-secondary/20 transition-[height,width] duration-200 lg:h-full lg:border-b-0 lg:border-r-2 ${
                isSidebarExpanded
                  ? 'max-lg:max-h-[50%] lg:basis-1/2'
                  : 'max-lg:h-[4.5rem] lg:basis-[4.5rem]'
              }`}
            >
              <div className="flex shrink-0 items-center justify-between gap-3 border-b-2 border-border bg-card px-3 py-3">
                {isSidebarExpanded ? (
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Assignment workspace
                    </p>
                    <p className="mt-1 truncate text-sm font-semibold text-foreground">
                      Scope and attempt history
                    </p>
                  </div>
                ) : (
                  <span className="sr-only">Assignment workspace sidebar</span>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setIsSidebarExpanded((current) => !current)}
                  aria-label={isSidebarExpanded ? 'Collapse assignment sidebar' : 'Expand assignment sidebar'}
                  className="h-10 w-10 shrink-0 border-2 shadow-none"
                >
                  {isSidebarExpanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </Button>
              </div>

              {isSidebarExpanded ? (
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
                  <section className="overflow-hidden rounded-2xl border-2 border-border bg-card">
                    <button
                      type="button"
                      onClick={() => setIsScopeExpanded((current) => !current)}
                      aria-expanded={isScopeExpanded}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/50"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 border-border bg-secondary text-foreground">
                          <BookOpen className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-foreground">Assignment scope</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            Objectives, scenario, teacher guidance
                          </span>
                        </span>
                      </span>
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                          isScopeExpanded ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    {isScopeExpanded ? (
                      <div className="max-h-[34vh] overflow-y-auto border-t-2 border-border p-3">
                        <AssignmentContextPanel bootstrap={bootstrap} lang={lang} />
                      </div>
                    ) : null}
                  </section>

                  <section className="overflow-hidden rounded-2xl border-2 border-border bg-card">
                    <button
                      type="button"
                      onClick={() => setIsHistoryExpanded((current) => !current)}
                      aria-expanded={isHistoryExpanded}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/50"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 border-border bg-secondary text-foreground">
                          <History className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-foreground">Chat history</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            Assignment-only attempts and resumes
                          </span>
                        </span>
                      </span>
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                          isHistoryExpanded ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    {isHistoryExpanded ? (
                      <div className="border-t-2 border-border p-3">
                        <AssignmentThreadSidebar
                          threads={workspace.threads}
                          selectedChatId={selectedChatId}
                          onSelectThread={setSelectedChatId}
                          onNewAttempt={() => void handleNewAttempt()}
                        />
                      </div>
                    ) : null}
                  </section>
                </div>
              ) : (
                <div className="hidden min-h-0 flex-1 flex-col items-center gap-3 px-3 py-4 lg:flex">
                  <button
                    type="button"
                    onClick={() => {
                      setIsSidebarExpanded(true);
                      setIsScopeExpanded(true);
                    }}
                    aria-label="Open assignment scope"
                    className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-border bg-card text-foreground transition-colors hover:bg-secondary"
                  >
                    <BookOpen className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSidebarExpanded(true);
                      setIsHistoryExpanded(true);
                    }}
                    aria-label="Open chat history"
                    className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-border bg-card text-foreground transition-colors hover:bg-secondary"
                  >
                    <History className="h-4 w-4" />
                  </button>
                </div>
              )}
            </aside>

            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card">
              <div className="shrink-0 border-b-2 border-border px-4 py-4 sm:px-6">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Conversation</p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold text-foreground">
                    {selectedThread?.title || 'Select a thread'}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedActivePracticeSession ? (
                      <Button size="sm" variant="outline" onClick={() => void handleEndSession()} disabled={isMutating}>
                        End session
                      </Button>
                    ) : null}
                  </div>
                </div>
                {selectedActivePracticeSession ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Status: {selectedActivePracticeSession.status} · Voice {selectedActivePracticeSession.voiceEnabled ? 'on' : 'off'} ·
                    Text {selectedActivePracticeSession.textEnabled ? 'on' : 'off'} ·
                    Connected {isConnecting ? 'connecting' : isConnected ? 'yes' : 'no'} ·
                    Listening {isListening ? 'yes' : 'no'} · Speaking {isSpeaking ? 'yes' : 'no'}
                  </p>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto bg-secondary/30 px-4 py-4 sm:px-6">
                {loadingChat ? (
                  <div className="flex h-full min-h-[260px] items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : displayMessages.length > 0 ? (
                  <div className="space-y-3">
                    {displayMessages.map((message) => (
                      <ChatMessage key={message.id} role={message.role} content={message.content} />
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-secondary/20 px-6 text-center">
                    <MessageSquareText className="h-6 w-6 text-muted-foreground" />
                    <p className="mt-3 text-sm text-muted-foreground">
                      Open a thread to review assignment conversation history.
                    </p>
                  </div>
                )}
              </div>

              {selectedThread ? (
                <div className="shrink-0 space-y-3 border-t-2 border-border bg-card px-4 py-4 sm:px-6">
                  {canUseVoice ? (
                    <div className="flex items-center gap-3">
                      <div className="flex min-h-12 flex-1 items-center rounded-2xl border-2 border-border bg-background px-4 text-sm font-semibold text-muted-foreground">
                        {voiceStatusLabel}
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleVoiceToggle()}
                        disabled={isConnecting || isMutating}
                        aria-label={voiceStatusLabel}
                        className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-3 border-foreground transition-all ${
                          isConnected
                            ? 'bg-success text-success-foreground shadow-stamp'
                            : 'bg-primary text-primary-foreground shadow-stamp hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_var(--foreground)]'
                        } disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none`}
                      >
                        {isConnecting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-5 w-5" />}
                      </button>
                    </div>
                  ) : null}

                  {canUseText ? (
                    <ChatInput
                      value={textInput}
                      onChange={setTextInput}
                      onSend={() => void handleSendText()}
                      disabled={isSendingText || isMutating || !selectedChatId}
                      placeholder={
                        selectedActivePracticeSession
                          ? 'Type your assignment response...'
                          : 'Type to continue this assignment thread...'
                      }
                    />
                  ) : null}
                </div>
              ) : null}
            </main>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
