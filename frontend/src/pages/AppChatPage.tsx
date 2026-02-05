import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCcw,
  MessageSquare,
  Mic,
  Loader2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx } from 'clsx';
import { useRealtimeChat } from '@/hooks/useRealtimeChat';
import {
  createChatSession,
  getChatSession,
  getChatSessions,
  saveMessageToChat,
  sendChatMessage,
  deleteChatSession,
} from '@/api/chat';
import { ChatInput } from '@/components/chat';
import { getUserProfile } from '@/api/user';
import { getAssessmentResults } from '@/api/assessment';
import { LearningPathCard, ChatSessionsSidebar } from '@/components/learning';
import type { ChatMessage, ChatSession, AssessmentResults, UserProfile } from '@/types';
import { useLanguage } from '@/contexts/LanguageContext';

const USER_AVATAR = '/imgs/landing/student.jpg';
const AI_AVATAR = '/imgs/avatars/ai.svg';

const domainBadgeStyles: Record<string, string> = {
  grammar: 'bg-primary/10 text-primary border border-primary/20',
  vocabulary: 'bg-accent/10 text-accent border border-accent/20',
  cultural: 'bg-secondary text-foreground border border-border',
  pragmatics: 'bg-success/10 text-success border border-success/20',
  pronunciation: 'bg-foreground/10 text-foreground border border-foreground/20',
};

export function AppChatPage() {
  const { t } = useLanguage();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingChat, setLoadingChat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [assessmentResults, setAssessmentResults] = useState<AssessmentResults | null>(null);
  const [profileSummary, setProfileSummary] = useState<UserProfile | null>(null);
  const refreshTimeoutRef = useRef<number | null>(null);

  // Chat mode state
  type Mode = 'text' | 'realtime';
  const [mode, setMode] = useState<Mode>('realtime');
  const [inputValue, setInputValue] = useState('');
  const [isSendingText, setIsSendingText] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentChatIdRef = useRef<string | null>(null);
  currentChatIdRef.current = currentChatId;

  const handleRealtimeMessage = useCallback((role: 'user' | 'assistant', content: string) => {
    const chatId = currentChatIdRef.current;
    if (!chatId || !content.trim()) return;

    const message: ChatMessage = {
      id: `${chatId}-${Date.now()}-${role}`,
      role,
      content,
      timestamp: new Date().toISOString(),
    };

    setHistoryMessages((prev) => [...prev, message]);
    setSessions((prev) => {
      const target = prev.find((session) => session.id === chatId);
      if (!target) return prev;
      const updatedTitle =
        target.message_count === 0 && role === 'user'
          ? content.length > 30
            ? `${content.slice(0, 30)}...`
            : content
          : target.title;
      const updated = {
        ...target,
        title: updatedTitle,
        updated_at: message.timestamp,
        message_count: target.message_count + 1,
        last_message: content,
      };
      return [updated, ...prev.filter((session) => session.id !== chatId)];
    });

    saveMessageToChat(chatId, role, content).catch((err) => {
      console.error('Failed to save realtime message:', err);
    });
  }, []);

  const {
    isConnected,
    isListening,
    isSpeaking,
    error: realtimeError,
    connect,
    disconnect,
    clearMessages,
  } = useRealtimeChat({ onMessage: handleRealtimeMessage });

  const statusLabel = useMemo(() => {
    if (isConnecting) return t('app.learn.status.connecting');
    if (!isConnected) return t('app.learn.status.tapToConnect');
    if (isSpeaking) return t('app.learn.status.aiSpeaking');
    if (isListening) return t('app.learn.status.listening');
    return t('app.learn.status.ready');
  }, [isConnecting, isConnected, isSpeaking, isListening, t]);

  const micButtonLabel = useMemo(() => {
    if (isConnecting) return t('app.learn.status.connecting');
    if (isConnected) return t('app.learn.chat.input.connected');
    return t('app.learn.chat.input.disconnected');
  }, [isConnecting, isConnected, t]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [historyMessages]);

  const refreshSessions = useCallback(async () => {
    try {
      const updatedSessions = await getChatSessions();
      setSessions(updatedSessions);
    } catch (err) {
      console.error('Failed to refresh sessions:', err);
    }
  }, []);

  const scheduleRefreshSessions = useCallback(() => {
    if (refreshTimeoutRef.current) {
      window.clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = window.setTimeout(() => {
      refreshSessions();
    }, 1000);
  }, [refreshSessions]);

  const loadChat = useCallback(async (chatId: string) => {
    setLoadingChat(true);
    setError(null);
    clearMessages();
    disconnect();

    try {
      const chat = await getChatSession(chatId);
      const formattedMessages: ChatMessage[] = chat.messages.map((msg, index) => ({
        id: `${chatId}-${index}`,
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
        timestamp: msg.timestamp,
      }));
      setHistoryMessages(formattedMessages);
      setCurrentChatId(chatId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chat');
    } finally {
      setLoadingChat(false);
    }
  }, [clearMessages, disconnect]);

  const createNewChat = useCallback(async () => {
    setLoadingChat(true);
    setError(null);
    clearMessages();
    disconnect();

    try {
      const { chatId, title } = await createChatSession();
      const timestamp = new Date().toISOString();
      const newSession: ChatSession = {
        id: chatId,
        title,
        created_at: timestamp,
        updated_at: timestamp,
        message_count: 0,
      };
      setSessions((prev) => [newSession, ...prev]);
      setHistoryMessages([]);
      setCurrentChatId(chatId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create chat');
    } finally {
      setLoadingChat(false);
    }
  }, [clearMessages, disconnect]);

  useEffect(() => {
    let isActive = true;

    const init = async () => {
      setLoadingSessions(true);
      setError(null);
      try {
        const chatSessions = await getChatSessions();
        if (!isActive) return;
        setSessions(chatSessions);

        if (chatSessions.length > 0) {
          await loadChat(chatSessions[0].id);
        } else {
          await createNewChat();
        }
      } catch (err) {
        if (!isActive) return;
        setError(err instanceof Error ? err.message : 'Failed to load sessions');
      } finally {
        if (isActive) setLoadingSessions(false);
      }
    };

    init();
    return () => {
      isActive = false;
      disconnect();
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, [createNewChat, disconnect, loadChat]);

  useEffect(() => {
    let isActive = true;

    const loadSummary = async () => {
      try {
        const profile = await getUserProfile();
        if (!isActive) return;
        setProfileSummary(profile);

        if (profile.assessed) {
          try {
            const results = await getAssessmentResults();
            if (!isActive) return;
            setAssessmentResults(results);
          } catch (err) {
            console.error('Failed to load assessment results:', err);
          }
        }
      } catch (err) {
        console.error('Failed to load profile summary:', err);
      }
    };

    loadSummary();
    return () => {
      isActive = false;
    };
  }, []);

  const handleSelectSession = (chatId: string) => {
    if (chatId === currentChatId) return;
    loadChat(chatId);
  };

  const handleRecordToggle = async () => {
    setError(null);
    if (!currentChatId) return;

    try {
      if (isConnected) {
        disconnect();
        return;
      }

      setIsConnecting(true);
      await connect();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start realtime session');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleModeChange = (newMode: Mode) => {
    if (mode === 'realtime' && isConnected && newMode !== 'realtime') {
      disconnect();
    }
    setMode(newMode);
  };

  const handleSendText = async () => {
    if (!inputValue.trim() || isSendingText || !currentChatId) return;

    const message = inputValue.trim();
    setInputValue('');
    setIsSendingText(true);
    setError(null);

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };
    setHistoryMessages((prev) => [...prev, userMessage]);

    setSessions((prev) => {
      const target = prev.find((s) => s.id === currentChatId);
      if (!target) return prev;
      const updated = {
        ...target,
        title: target.message_count === 0 ? (message.length > 30 ? `${message.slice(0, 30)}...` : message) : target.title,
        updated_at: userMessage.timestamp,
        message_count: target.message_count + 1,
        last_message: message,
      };
      return [updated, ...prev.filter((s) => s.id !== currentChatId)];
    });

    try {
      const response = await sendChatMessage(currentChatId, message);
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response.response,
        timestamp: new Date().toISOString(),
      };
      setHistoryMessages((prev) => [...prev, assistantMessage]);

      setSessions((prev) => {
        const target = prev.find((s) => s.id === currentChatId);
        if (!target) return prev;
        const updated = {
          ...target,
          updated_at: assistantMessage.timestamp,
          message_count: target.message_count + 1,
          last_message: response.response,
        };
        return [updated, ...prev.filter((s) => s.id !== currentChatId)];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setIsSendingText(false);
    }
  };

  const handleDeleteChat = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(t('chat.deleteConfirm') || 'Are you sure you want to delete this chat?')) {
      return;
    }
    try {
      await deleteChatSession(chatId);
      setSessions((prev) => prev.filter((s) => s.id !== chatId));
      if (currentChatId === chatId) {
        setCurrentChatId(null);
        setHistoryMessages([]);
        clearMessages();
        disconnect();
        const remaining = sessions.filter((s) => s.id !== chatId);
        if (remaining.length > 0) {
          loadChat(remaining[0].id);
        } else {
          createNewChat();
        }
      }
    } catch (err) {
      console.error('Failed to delete chat:', err);
      setError('Failed to delete chat');
    }
  };

  const currentSession = sessions.find((session) => session.id === currentChatId);
  const mostRecentSession = sessions[0];
  const showResume =
    Boolean(currentChatId) &&
    Boolean(mostRecentSession) &&
    mostRecentSession?.id !== currentChatId;

  const focusAreas = profileSummary?.selectedCategories ?? [];
  const domainEntries = assessmentResults?.domainBands
    ? Object.entries(assessmentResults.domainBands).sort((a, b) => b[1] - a[1])
    : [];
  const getCategoryLabel = (area: string) => {
    const key = `categories.${area}`;
    const translated = t(key);
    if (translated !== key) return translated;
    return area.replace(/_/g, ' ');
  };
  const getDomainLabel = (domain: string) => {
    const key = `profile.${domain}`;
    const translated = t(key);
    if (translated !== key) return translated;
    return domain.replace(/_/g, ' ');
  };
  const topDomain = domainEntries[0];
  const focusBadge = focusAreas.length > 0
    ? `${getCategoryLabel(focusAreas[0])}${focusAreas.length > 1 ? ` +${focusAreas.length - 1}` : ''}`
    : '';
  const focusBadgeClass = focusAreas.length > 0
    ? domainBadgeStyles[focusAreas[0]] || 'bg-slate-100 text-slate-600'
    : 'bg-slate-100 text-slate-600';

  useEffect(() => {
    if (!currentChatId || historyMessages.length === 0) return;
    scheduleRefreshSessions();
  }, [currentChatId, historyMessages.length, scheduleRefreshSessions]);

  return (
    <div className="grid lg:grid-cols-12 gap-6 h-[calc(100vh-8rem)]">
      <div className="lg:col-span-4 flex flex-col h-full gap-6">
        {/* Learning Path Card */}
        <LearningPathCard
          assessmentResults={assessmentResults}
          profileSummary={profileSummary}
          t={t}
        />

        {/* Sessions Panel */}
        <ChatSessionsSidebar
          sessions={sessions}
          currentChatId={currentChatId}
          mostRecentSession={mostRecentSession}
          showResume={showResume}
          loading={loadingSessions}
          onSelectSession={handleSelectSession}
          onCreateNew={createNewChat}
          onDelete={handleDeleteChat}
          t={t}
        />
      </div>

      {/* Main Chat Panel */}
      <div className="lg:col-span-8 flex flex-col h-full bg-card rounded-2xl border-3 border-foreground shadow-stamp overflow-hidden relative">
        <div className="p-4 border-b-3 border-foreground flex justify-between items-center bg-card z-10">
          <div>
            <div className="flex items-center space-x-2 text-sm text-primary font-bold mb-0.5">
              <MessageSquare size={16} strokeWidth={2.5} />
              <span>{t('app.learn.chat.label')}</span>
            </div>
            <h2 className="text-lg font-display font-bold text-foreground">
              {currentSession?.title || t('app.learn.chat.title')}
            </h2>
            {(assessmentResults?.sklcLevel || focusBadge || topDomain) && (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {assessmentResults?.sklcLevel && (
                  <span className="text-xs font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-lg border border-primary/20">
                    {t('app.learn.chat.badges.level')} {assessmentResults.sklcLevel}
                  </span>
                )}
                {focusBadge && (
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${focusBadgeClass}`}>
                    {t('app.learn.chat.badges.focus')} {focusBadge}
                  </span>
                )}
                {topDomain && (
                  <span
                    className={`text-xs font-bold px-2.5 py-1 rounded-lg ${
                      domainBadgeStyles[topDomain[0]] || 'bg-secondary text-muted-foreground border border-border'
                    }`}
                  >
                    {t('app.learn.chat.badges.strength')} {getDomainLabel(topDomain[0])} &bull; {topDomain[1]}/10
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex bg-secondary rounded-xl p-1 border-2 border-border">
              <button
                type="button"
                onClick={() => handleModeChange('text')}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm font-bold transition-colors',
                  mode === 'text'
                    ? 'bg-card text-primary border-2 border-foreground shadow-stamp-sm'
                    : 'text-muted-foreground hover:text-foreground border-2 border-transparent'
                )}
              >
                {t('chat.textMode')}
              </button>
              <button
                type="button"
                onClick={() => handleModeChange('realtime')}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm font-bold transition-colors',
                  mode === 'realtime'
                    ? 'bg-card text-primary border-2 border-foreground shadow-stamp-sm'
                    : 'text-muted-foreground hover:text-foreground border-2 border-transparent'
                )}
              >
                {t('chat.voiceMode')}
              </button>
            </div>
            {mode === 'realtime' && (
              <div className="hidden sm:flex items-center space-x-2 bg-secondary px-3 py-1.5 rounded-xl border-2 border-border text-sm">
                <span className="text-muted-foreground">{t('app.learn.chat.status')}</span>
                <span className="font-bold text-foreground">{statusLabel}</span>
              </div>
            )}
            <button
              onClick={createNewChat}
              aria-label={t('app.learn.sessions.newChatTitle')}
              title={t('app.learn.sessions.newChatTitle')}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-xl border-2 border-transparent hover:border-border transition-colors"
            >
              <RefreshCcw size={20} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-secondary/50 relative">
          {error || realtimeError ? (
            <div className="mb-4 p-4 rounded-xl border-2 border-destructive bg-destructive/10 text-sm text-destructive font-medium">
              {error || realtimeError}
            </div>
          ) : null}

          {loadingChat ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('app.learn.chat.loading')}
            </div>
          ) : historyMessages.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t('app.learn.chat.empty')}</div>
          ) : (
            <div className="space-y-6 max-w-3xl mx-auto pb-32">
              {historyMessages.map((msg) => {
                const isUser = msg.role === 'user';
                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={clsx('flex gap-4', isUser ? 'flex-row-reverse' : 'flex-row')}
                  >
                    <img
                      src={isUser ? USER_AVATAR : AI_AVATAR}
                      alt={isUser ? 'You' : 'Lingual AI'}
                      className="w-10 h-10 rounded-xl bg-card border-2 border-foreground"
                    />
                    <div
                      className={clsx(
                        'max-w-[80%] p-4 rounded-2xl text-lg leading-relaxed border-2',
                        isUser
                          ? 'bg-primary text-primary-foreground border-foreground rounded-tr-none shadow-stamp-sm'
                          : 'bg-card text-foreground border-border rounded-tl-none'
                      )}
                    >
                      {msg.content}
                    </div>
                  </motion.div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-card via-card to-transparent">
          <AnimatePresence mode="wait">
            {mode === 'text' ? (
              <motion.div
                key="text-input"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <ChatInput
                  value={inputValue}
                  onChange={setInputValue}
                  onSend={handleSendText}
                  disabled={isSendingText || !currentChatId}
                  placeholder={t('chat.placeholder')}
                />
              </motion.div>
            ) : (
              <motion.div
                key="voice-input"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex items-center justify-between gap-4"
              >
                <div className="flex-1 bg-card border-2 border-border rounded-xl px-4 py-3 text-muted-foreground font-medium">
                  {isConnected
                    ? t('app.learn.chat.input.connected')
                    : t('app.learn.chat.input.disconnected')}
                </div>
                <button
                  onClick={handleRecordToggle}
                  disabled={!currentChatId || isConnecting}
                  aria-label={micButtonLabel}
                  aria-pressed={isConnected}
                  title={micButtonLabel}
                  className={clsx(
                    'w-14 h-14 rounded-xl flex items-center justify-center border-2 border-foreground transition-all',
                    isConnected
                      ? isSpeaking
                        ? 'bg-primary text-primary-foreground shadow-stamp'
                        : isListening
                        ? 'bg-destructive text-white animate-pulse shadow-stamp'
                        : 'bg-success text-white shadow-stamp'
                      : 'bg-primary hover:bg-primary/90 text-primary-foreground shadow-stamp hover:shadow-[6px_6px_0_0_var(--foreground)]',
                    (isConnecting || !currentChatId) && 'opacity-60 cursor-not-allowed'
                  )}
                >
                  <Mic size={20} strokeWidth={2.5} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
