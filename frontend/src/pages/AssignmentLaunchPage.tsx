import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Loader2,
  Mic,
  MessageSquareText,
  PlayCircle,
} from 'lucide-react';
import { bootstrapStudentAssignment, createAssignmentPracticeSession, reportPracticeSessionEvent } from '@/api/assignments';
import { createChatSession, saveMessageToChat, sendChatMessage } from '@/api/chat';
import { ChatInput } from '@/components/chat';
import { Alert, AlertDescription, Badge, Button, Card } from '@/components/ui';
import { useLanguage } from '@/contexts/LanguageContext';
import { useRealtimeChat } from '@/hooks/useRealtimeChat';
import type { ChatMessage } from '@/types';
import type { AssignmentBootstrapData, PracticeSessionDto } from '@/types';

function getLocalizedText(
  value: Record<string, string> | undefined,
  lang: 'en' | 'ko',
  fallback = ''
): string {
  if (!value) return fallback;
  return value[lang] || value.en || Object.values(value)[0] || fallback;
}

function formatModeLabel(value: string) {
  return value.replaceAll('_', ' ');
}

function formatBadgeVariant(status: string): 'success' | 'secondary' | 'outline' {
  if (status === 'published') return 'success';
  if (status === 'archived') return 'secondary';
  return 'outline';
}

export function AssignmentLaunchPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();
  const { lang } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [bootstrap, setBootstrap] = useState<AssignmentBootstrapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [practiceError, setPracticeError] = useState<string | null>(null);
  const [isStartingPractice, setIsStartingPractice] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSendingText, setIsSendingText] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [textMessages, setTextMessages] = useState<ChatMessage[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [practiceSession, setPracticeSession] = useState<PracticeSessionDto | null>(null);

  const chatIdRef = useRef<string | null>(null);
  const practiceSessionRef = useRef<PracticeSessionDto | null>(null);
  const realtimeSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sessionEventQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sessionEndedRef = useRef(false);
  const nextRealtimeMessageOrderRef = useRef(0);

  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);

  useEffect(() => {
    practiceSessionRef.current = practiceSession;
  }, [practiceSession]);

  useEffect(() => {
    let isActive = true;

    if (!assignmentId) {
      setLoading(false);
      setError('Assignment id is required.');
      return;
    }

    const loadBootstrap = async () => {
      setLoading(true);
      try {
        const nextBootstrap = await bootstrapStudentAssignment(assignmentId, lang);
        if (!isActive) return;
        setBootstrap(nextBootstrap);
        setError(null);
      } catch (loadError) {
        if (!isActive) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load assignment.');
      } finally {
        if (isActive) setLoading(false);
      }
    };

    void loadBootstrap();
    return () => {
      isActive = false;
    };
  }, [assignmentId, lang]);

  const queuePracticeEvent = async (
    eventType: string,
    turnIndex: number | null,
    payload: Record<string, unknown>
  ) => {
    const activeSession = practiceSessionRef.current;
    if (!activeSession || sessionEndedRef.current) return;

    sessionEventQueueRef.current = sessionEventQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const updatedSession = await reportPracticeSessionEvent(activeSession.id, {
          eventType,
          turnIndex,
          payload,
        });
        setPracticeSession(updatedSession);
        practiceSessionRef.current = updatedSession;
        if (eventType === 'session.ended') {
          sessionEndedRef.current = true;
        }
      })
      .catch((eventError) => {
        console.error('Failed to report practice event:', eventError);
        setPracticeError((current) => current || 'Failed to capture assignment practice events.');
      });

    await sessionEventQueueRef.current;
  };

  const finalizePracticeSession = async (
    reason: string,
    options?: {
      session?: PracticeSessionDto | null;
      status?: 'completed' | 'abandoned';
    }
  ) => {
    const activeSession = options?.session || practiceSessionRef.current;
    if (!activeSession || sessionEndedRef.current) return;
    await queuePracticeEvent('session.ended', null, {
      reason,
      status: options?.status || (reason === 'manual_disconnect' ? 'completed' : 'abandoned'),
      chatId: chatIdRef.current,
    });
  };

  const persistRealtimeMessage = (role: 'user' | 'assistant', content: string) => {
    const activeChatId = chatIdRef.current;
    if (!activeChatId || !content.trim()) return;

    const sortOrder = nextRealtimeMessageOrderRef.current;
    const timestamp = new Date().toISOString();
    nextRealtimeMessageOrderRef.current += 1;

    realtimeSaveQueueRef.current = realtimeSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await saveMessageToChat(activeChatId, role, content, { timestamp, sortOrder });
      })
      .catch((saveError) => {
        console.error('Failed to save assignment realtime message:', saveError);
      });

    void queuePracticeEvent(
      role === 'user' ? 'student.turn' : 'assistant.turn',
      sortOrder,
      {
        chatId: activeChatId,
        content,
        source: 'realtime',
      }
    );
  };

  const realtimeSessionParams = bootstrap
    ? {
        ...bootstrap.realtimeSessionParams,
        practice: {
          ...bootstrap.realtimeSessionParams.practice,
          ...(practiceSession ? { practiceSessionId: practiceSession.id } : {}),
        },
      }
    : undefined;

  const {
    isConnected,
    isListening,
    isSpeaking,
    messages,
    error: realtimeError,
    connect,
    disconnect,
    clearMessages,
  } = useRealtimeChat({
    onMessage: persistRealtimeMessage,
    sessionParams: realtimeSessionParams,
  });

  const isTextLaunch = Boolean(bootstrap && bootstrap.launch.modality.mode === 'text_only');
  const canStartPractice = Boolean(
    bootstrap && (bootstrap.launch.voiceAllowed || bootstrap.launch.textAllowed)
  );
  const launchBlockedReasons = bootstrap?.launch.blockedReasons ?? [];

  const startAssignmentPractice = async () => {
    if (!bootstrap) return;

    setPracticeError(null);
    setIsStartingPractice(true);
    let createdPracticeSession: PracticeSessionDto | null = null;

    try {
      await finalizePracticeSession('restarted');
      disconnect();
      clearMessages();
      realtimeSaveQueueRef.current = Promise.resolve();
      sessionEventQueueRef.current = Promise.resolve();
      nextRealtimeMessageOrderRef.current = 0;
      sessionEndedRef.current = false;
      setTextMessages([]);
      setTextInput('');

      const created = await createChatSession(`ASM ${bootstrap.assignment.title}`);
      setChatId(created.chatId);
      chatIdRef.current = created.chatId;
      createdPracticeSession = await createAssignmentPracticeSession(bootstrap.assignment.id, {
        uiLanguage: lang,
        chatId: created.chatId,
      });
      setPracticeSession(createdPracticeSession);
      practiceSessionRef.current = createdPracticeSession;
      if (bootstrap.launch.modality.mode !== 'text_only') {
        await connect();
      }
    } catch (startError) {
      if (createdPracticeSession) {
        await finalizePracticeSession('connection_failed', {
          session: createdPracticeSession,
        });
      }
      setPracticeError(startError instanceof Error ? startError.message : 'Failed to start assignment practice.');
    } finally {
      setIsStartingPractice(false);
    }
  };

  const handleSendText = async () => {
    if (
      !bootstrap ||
      !chatId ||
      !practiceSession ||
      practiceSession.status !== 'active' ||
      !textInput.trim() ||
      isSendingText
    ) {
      return;
    }

    const message = textInput.trim();
    setTextInput('');
    setPracticeError(null);
    setIsSendingText(true);

    try {
      const response = await sendChatMessage(chatId, message, {
        assignmentId: bootstrap.assignment.id,
        practiceSessionId: practiceSession.id,
        uiLanguage: lang,
      });

      const userTurnIndex = nextRealtimeMessageOrderRef.current;
      const assistantTurnIndex = userTurnIndex + 1;
      nextRealtimeMessageOrderRef.current += 2;

      const userMessage: ChatMessage = {
        id: `assignment-user-${userTurnIndex}`,
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
      };
      const assistantMessage: ChatMessage = {
        id: `assignment-assistant-${assistantTurnIndex}`,
        role: 'assistant',
        content: response.response,
        timestamp: new Date().toISOString(),
      };
      setTextMessages((current) => [...current, userMessage, assistantMessage]);

      await queuePracticeEvent('student.turn', userTurnIndex, {
        chatId,
        content: message,
        source: 'text',
      });
      await queuePracticeEvent('assistant.turn', assistantTurnIndex, {
        chatId,
        content: response.response,
        source: 'text',
      });
    } catch (sendError) {
      setPracticeError(sendError instanceof Error ? sendError.message : 'Failed to send assignment text message.');
    } finally {
      setIsSendingText(false);
    }
  };

  const toggleConnection = async () => {
    if (!chatId) return;

    setPracticeError(null);
    if (isConnected) {
      await finalizePracticeSession('manual_disconnect');
      disconnect();
      return;
    }

    setIsConnecting(true);
    try {
      await connect();
    } catch (connectError) {
      setPracticeError(connectError instanceof Error ? connectError.message : 'Failed to connect.');
    } finally {
      setIsConnecting(false);
    }
  };

  useEffect(() => {
    return () => {
      const activeSession = practiceSessionRef.current;
      if (!activeSession || sessionEndedRef.current) return;
      sessionEndedRef.current = true;
      void reportPracticeSessionEvent(activeSession.id, {
        eventType: 'session.ended',
        payload: {
          reason: 'page_leave',
          status: 'abandoned',
          chatId: chatIdRef.current,
        },
      });
      disconnect();
    };
  }, [disconnect]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!bootstrap) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{error || 'Assignment launch data is unavailable.'}</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => navigate('/app/learn')}>
          Back to learning dashboard
        </Button>
      </div>
    );
  }

  const showTextFallbackNotice = bootstrap.launch.modality.mode === 'text_only';

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="rounded-3xl border-3 border-foreground bg-card p-6 shadow-stamp">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge variant={formatBadgeVariant(bootstrap.assignment.status)} size="sm">
                {bootstrap.assignment.status}
              </Badge>
              <Badge variant="secondary" size="sm">
                {formatModeLabel(bootstrap.assignment.taskType)}
              </Badge>
              {bootstrap.teacherPreview ? (
                <Badge variant="accent" size="sm">
                  Teacher preview
                </Badge>
              ) : null}
            </div>
            <h1 className="text-3xl font-display font-bold text-foreground">{bootstrap.assignment.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {bootstrap.class.name} · {bootstrap.class.subject || 'Language practice'} ·{' '}
              {bootstrap.class.term || 'Current term'}
            </p>
            {bootstrap.assignment.description ? (
              <p className="mt-3 max-w-3xl text-sm text-foreground/80">{bootstrap.assignment.description}</p>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-2xl border-2 border-border bg-secondary/50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Modality</p>
              <p className="mt-1 text-lg font-bold text-foreground">
                {formatModeLabel(bootstrap.launch.modality.mode)}
              </p>
            </div>
            <div className="rounded-2xl border-2 border-border bg-secondary/50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Attempts</p>
              <p className="mt-1 text-lg font-bold text-foreground">
                {bootstrap.launch.maxAttempts ?? 'Unlimited'}
              </p>
            </div>
            <div className="rounded-2xl border-2 border-border bg-secondary/50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Locale</p>
              <p className="mt-1 text-lg font-bold text-foreground">{bootstrap.class.learningLocale}</p>
            </div>
          </div>
        </div>
      </header>

      {bootstrap.teacherPreview ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>
            This launch is running in teacher preview mode. Students will only see it when they are actively enrolled
            and the assignment is published.
          </AlertDescription>
        </Alert>
      ) : null}

      {bootstrap.limitations.map((message) => (
        <Alert key={message}>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ))}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {practiceError || realtimeError ? (
        <Alert variant="destructive">
          <AlertDescription>{practiceError || realtimeError}</AlertDescription>
        </Alert>
      ) : null}

      {showTextFallbackNotice ? (
        <Alert>
          <MessageSquareText className="h-4 w-4" />
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {bootstrap.launch.fallbackApplied
                ? 'Voice is blocked for this student, so this assignment has been downgraded to assignment-scoped text practice.'
                : 'This assignment is configured to launch in assignment-scoped text mode.'}
            </span>
            {bootstrap.launch.fallbackApplied ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate('/app/consent/voice')}
              >
                Grant voice consent
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {launchBlockedReasons.length > 0 && !canStartPractice ? (
        <Alert variant="destructive">
          <AlertDescription>{launchBlockedReasons.join(' ')}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <details className="group">
            <summary className="cursor-pointer list-none">
              <Card className="border-3 border-foreground p-5 shadow-stamp transition-colors group-open:border-primary/40">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-foreground bg-primary text-primary-foreground">
                      <BookOpen size={22} strokeWidth={2.5} />
                    </div>
                    <div>
                      <h2 className="text-lg font-display font-bold text-foreground">About this assignment</h2>
                      <p className="text-sm text-muted-foreground">
                        Curriculum scope, objectives, and teacher instructions
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground group-open:hidden">Show details</span>
                  <span className="hidden text-xs font-medium text-muted-foreground group-open:inline">Hide details</span>
                </div>
              </Card>
            </summary>

          <Card className="mt-3 border-3 border-foreground p-6 shadow-stamp">
            <h2 className="text-lg font-display font-bold text-foreground">
              {bootstrap.curriculum.package?.id === 'canvas-generated' ? 'Practice scope' : 'Curriculum scope'}
            </h2>

            {bootstrap.curriculum.unit && bootstrap.curriculum.module ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Unit</p>
                <p className="mt-2 font-semibold text-foreground">
                  {getLocalizedText(bootstrap.curriculum.unit.title, lang, bootstrap.curriculum.unit.id)}
                </p>
              </div>
              <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Module</p>
                <p className="mt-2 font-semibold text-foreground">
                  {getLocalizedText(bootstrap.curriculum.module.title, lang, bootstrap.curriculum.module.id)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {getLocalizedText(bootstrap.curriculum.module.goal, lang)}
                </p>
              </div>
            </div>
            ) : bootstrap.mapping?.generatedScenario ? (
            <div className="mt-6 rounded-2xl border-2 border-border bg-secondary/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Conversation scenario</p>
              <p className="mt-2 text-sm text-foreground">{bootstrap.mapping.generatedScenario}</p>
              {bootstrap.mapping.sourceCanvasItemTitle && (
                <p className="mt-2 text-xs text-muted-foreground">Based on: {bootstrap.mapping.sourceCanvasItemTitle}</p>
              )}
            </div>
            ) : null}

            <div className="mt-5 rounded-2xl border-2 border-border bg-secondary/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Situation</p>
              <p className="mt-2 font-semibold text-foreground">{bootstrap.curriculum.situation?.id || 'Canvas-generated'}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatModeLabel(bootstrap.curriculum.situation?.kind)} · {String(bootstrap.curriculum.situation?.seed?.setting || 'context not specified')}
              </p>
            </div>

            <div className="mt-5">
              <h3 className="text-base font-semibold text-foreground">Objectives</h3>
              <div className="mt-3 grid gap-3">
                {bootstrap.curriculum.objectives.map((objective) => (
                  <div key={objective.id} className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                    <p className="text-sm font-semibold text-foreground">{objective.id}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {getLocalizedText(objective.canDo, lang, objective.id)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card className="border-3 border-foreground p-6 shadow-stamp">
            <h2 className="text-xl font-display font-bold text-foreground">Teacher-designed practice overlay</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Target expressions
                </p>
                <ul className="mt-3 space-y-2 text-sm text-foreground">
                  {(bootstrap.mapping.targetExpressions.length > 0
                    ? bootstrap.mapping.targetExpressions
                    : ['No explicit target expressions configured.']
                  ).map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Focus grammar
                </p>
                <ul className="mt-3 space-y-2 text-sm text-foreground">
                  {(bootstrap.mapping.focusGrammar.length > 0
                    ? bootstrap.mapping.focusGrammar
                    : ['No explicit grammar focus configured.']
                  ).map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Success criteria
                </p>
                <ul className="mt-3 space-y-2 text-sm text-foreground">
                  {(bootstrap.assignment.successCriteria.length > 0
                    ? bootstrap.assignment.successCriteria
                    : ['Complete the task with sustained, assignment-aligned output.']
                  ).map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Teacher notes
                </p>
                <p className="mt-3 text-sm text-foreground">
                  {bootstrap.mapping.teacherNotes || 'No teacher notes were attached to this assignment.'}
                </p>
              </div>
            </div>
          </Card>
          </details>
        </div>

        <div className="space-y-6">
          <Card className="border-3 border-foreground p-6 shadow-stamp">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-foreground bg-success text-success-foreground">
                <Mic size={22} strokeWidth={2.5} />
              </div>
              <div>
                <h2 className="text-xl font-display font-bold text-foreground">Start speaking</h2>
                <p className="text-sm text-muted-foreground">
                  Practice with your AI speaking partner. The conversation follows your teacher’s lesson plan.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Voice</p>
                <p className="mt-2 font-semibold text-foreground">{bootstrap.launch.voiceAllowed ? 'Allowed' : 'Blocked'}</p>
              </div>
              <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Text fallback</p>
                <p className="mt-2 font-semibold text-foreground">{bootstrap.launch.textAllowed ? 'Available' : 'Blocked'}</p>
              </div>
            </div>

            {bootstrap.launch.retentionPolicy ? (
              <div className="mt-4 rounded-2xl border-2 border-border bg-secondary/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Retention</p>
                <p className="mt-2 text-sm text-foreground">
                  {bootstrap.launch.retentionPolicy.label} · Raw audio{' '}
                  {bootstrap.launch.retentionPolicy.rawAudioStorageAllowed ? 'stored' : 'not stored'}
                </p>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => chatId && navigate(`/app/chat?chatId=${encodeURIComponent(chatId)}`)} loading={isStartingPractice} disabled={!canStartPractice}>
                <PlayCircle size={16} className="mr-2" />
                {isTextLaunch ? 'Start text practice' : 'Start assignment practice'}
              </Button>
              {!isTextLaunch ? (
                <Button
                  variant="outline"
                  onClick={() => void toggleConnection()}
                  disabled={!chatId || isStartingPractice || practiceSession?.status !== 'active'}
                >
                  {isConnected ? 'End session' : isConnecting ? 'Connecting…' : 'Reconnect'}
                </Button>
              ) : null}
            </div>

            <div className="mt-5 rounded-2xl border-2 border-border bg-secondary/40 p-4">
              <p className="text-sm font-semibold text-foreground">Live status</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {isTextLaunch
                  ? `Text session ready: ${practiceSession?.status === 'active' && chatId ? 'yes' : 'no'}`
                  : `Connected: ${isConnected ? 'yes' : 'no'} · Listening: ${isListening ? 'yes' : 'no'} · Speaking: ${isSpeaking ? 'yes' : 'no'}`}
              </p>
            </div>

            {practiceSession ? (
              <div className="mt-5 rounded-2xl border-2 border-border bg-secondary/40 p-4">
                <p className="text-sm font-semibold text-foreground">Session summary</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Status</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{practiceSession.status}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Student turns</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {practiceSession.sessionSummary.studentTurnCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Assistant turns</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {practiceSession.sessionSummary.assistantTurnCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Estimated speaking</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {practiceSession.sessionSummary.estimatedSpeakingTimeSeconds}s
                    </p>
                  </div>
                </div>
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Target expression hits
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(practiceSession.sessionSummary.targetExpressionHits).length === 0 ? (
                      <span className="text-sm text-muted-foreground">No tracked hits yet.</span>
                    ) : (
                      Object.entries(practiceSession.sessionSummary.targetExpressionHits).map(([expression, count]) => (
                        <Badge key={expression} variant="outline" size="sm">
                          {expression}: {count}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </Card>

          <Card className="border-3 border-foreground p-6 shadow-stamp">
            <h2 className="text-xl font-display font-bold text-foreground">
              {isTextLaunch ? 'Assignment text practice' : 'Realtime transcript'}
            </h2>
            <div className="mt-5 space-y-3">
              {(isTextLaunch ? textMessages : messages).length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
                  {isTextLaunch
                    ? 'Start text practice to begin collecting the assignment transcript.'
                    : 'Start practice to begin collecting the assignment transcript.'}
                </div>
              ) : (
                (isTextLaunch ? textMessages : messages).map((message) => (
                  <div
                    key={message.id}
                    className={`rounded-2xl border-2 p-4 ${
                      message.role === 'assistant'
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border bg-secondary/40'
                    }`}
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {message.role}
                    </p>
                    <p className="mt-2 text-sm text-foreground">{message.content}</p>
                  </div>
                ))
              )}
            </div>

            {isTextLaunch ? (
              <div className="mt-5 border-t-2 border-border pt-5">
                <ChatInput
                  value={textInput}
                  onChange={setTextInput}
                  onSend={() => void handleSendText()}
                  disabled={!chatId || !practiceSession || practiceSession.status !== 'active' || isSendingText}
                  placeholder="Type your assignment response..."
                />
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
