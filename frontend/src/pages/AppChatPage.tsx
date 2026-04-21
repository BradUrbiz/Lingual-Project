import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  RefreshCcw,
  MessageSquare,
  Mic,
  Loader2,
  Menu,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  MonitorPlay,
  CircleUserRound,
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
  updateChatSettings,
} from '@/api/chat';
import { ChatInput } from '@/components/chat';
import { buildLive2DAvatarStateFromPerformance } from '@/components/avatar/live2dAdapter';
import { useAvatarPerformance } from '@/components/avatar/useAvatarPerformance';
import { getUserProfile } from '@/api/user';
import { getAssessmentResults } from '@/api/assessment';
import { ChatSessionsSidebar } from '@/components/learning';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui';
import type {
  ChatMessage,
  ChatSession,
  AssessmentResults,
  UserProfile,
  LanguageMixLevel,
} from '@/types';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';

const AI_AVATAR = '/imgs/avatars/ai.svg';
const CHAT_AVATAR_ENABLED_KEY = 'lingual:chat:avatarEnabled';
const TEXT_AVATAR_SPEAK_MIN_MS = 1200;
const TEXT_AVATAR_SPEAK_MAX_MS = 4200;
declare const __CUBISM_SDK_AVAILABLE__: boolean;
const PILOT_AVATAR_ENABLED = (import.meta.env.VITE_ENABLE_PILOT_AVATAR ?? 'false') === 'true';
const LIVE2D_CHAT_ENABLED =
  import.meta.env.VITE_ENABLE_LIVE2D_CHAT !== undefined
    ? import.meta.env.VITE_ENABLE_LIVE2D_CHAT !== 'false'
    : import.meta.env.MODE === 'test' || __CUBISM_SDK_AVAILABLE__;
const REALTIME_AVATAR_DIRECTIVES_ENABLED = (import.meta.env.VITE_ENABLE_REALTIME_AVATAR_DIRECTIVES ?? 'false') === 'true';
const CHAT_AVATAR_AVAILABLE = PILOT_AVATAR_ENABLED && LIVE2D_CHAT_ENABLED;
const DEFAULT_LANGUAGE_MIX_LEVEL: LanguageMixLevel = 'balanced';

const Live2DAvatarPanel = lazy(() => import('@/components/avatar/Live2DAvatarPanel'));

type AvatarActivity = 'idle' | 'listening' | 'thinking' | 'speaking';

const domainBadgeStyles: Record<string, string> = {
  grammar: 'bg-primary/10 text-primary border border-primary/20',
  vocabulary: 'bg-accent/10 text-accent border border-accent/20',
  cultural: 'bg-secondary text-foreground border border-border',
  pragmatics: 'bg-success/10 text-success border border-success/20',
  pronunciation: 'bg-foreground/10 text-foreground border border-foreground/20',
  interpretive_comprehension: 'bg-primary/10 text-primary border border-primary/20',
  interpersonal_communication: 'bg-accent/10 text-accent border border-accent/20',
  presentational_communication: 'bg-success/10 text-success border border-success/20',
  language_control: 'bg-foreground/10 text-foreground border border-foreground/20',
};

function getTextAvatarSpeechDuration(content: string): number {
  const trimmed = content.trim();
  if (!trimmed) return 0;

  return Math.min(
    TEXT_AVATAR_SPEAK_MAX_MS,
    Math.max(TEXT_AVATAR_SPEAK_MIN_MS, trimmed.length * 45)
  );
}

function getClientNow(): number {
  try {
    return window.performance?.now() ?? Date.now();
  } catch {
    return Date.now();
  }
}

export function AppChatPage() {
  const { lang, t } = useLanguage();
  const { avatarUrl } = useAuth();
  const userAvatar = avatarUrl || null;
  const [searchParams] = useSearchParams();
  const requestedChatId = searchParams.get('chatId');
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingChat, setLoadingChat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [assessmentResults, setAssessmentResults] = useState<AssessmentResults | null>(null);
  const [profileSummary, setProfileSummary] = useState<UserProfile | null>(null);
  const [languageMixLevel, setLanguageMixLevel] = useState<LanguageMixLevel>(DEFAULT_LANGUAGE_MIX_LEVEL);
  const [languageMixNotice, setLanguageMixNotice] = useState<string | null>(null);

  // Chat mode state
  type Mode = 'text' | 'realtime';
  const [mode, setMode] = useState<Mode>('realtime');
  const [inputValue, setInputValue] = useState('');
  const [isSendingText, setIsSendingText] = useState(false);
  const [isDeletingChat, setIsDeletingChat] = useState(false);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [isSidebarDialogOpen, setIsSidebarDialogOpen] = useState(false);
  const [textAvatarActivity, setTextAvatarActivity] = useState<AvatarActivity>('idle');
  const [textAssistantTranscriptDelta, setTextAssistantTranscriptDelta] = useState('');
  const [textAssistantTranscriptFinal, setTextAssistantTranscriptFinal] = useState('');
  const [textAssistantSpeechStartedAt, setTextAssistantSpeechStartedAt] = useState<number | null>(null);
  const [textAssistantSpeechEndedAt, setTextAssistantSpeechEndedAt] = useState<number | null>(null);
  const [isAvatarEnabled, setIsAvatarEnabled] = useState(() => {
    if (!CHAT_AVATAR_AVAILABLE) return false;
    try {
      const stored = window.localStorage.getItem(CHAT_AVATAR_ENABLED_KEY);
      if (stored === null) return false;
      return stored === 'true';
    } catch {
      return true;
    }
  });
  const [isDesktop, setIsDesktop] = useState(() => {
    try {
      return window.matchMedia?.('(min-width: 1024px)')?.matches ?? false;
    } catch {
      return false;
    }
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentChatIdRef = useRef<string | null>(null);
  const previousMessageCountRef = useRef(0);
  const textAvatarTimeoutRef = useRef<number | null>(null);
  const realtimeSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const nextRealtimeMessageOrderRef = useRef(0);
  currentChatIdRef.current = currentChatId;

  const clearTextAvatarTimeout = useCallback(() => {
    if (textAvatarTimeoutRef.current === null) return;
    window.clearTimeout(textAvatarTimeoutRef.current);
    textAvatarTimeoutRef.current = null;
  }, []);

  const resetTextAvatarPerformance = useCallback(() => {
    setTextAssistantTranscriptDelta('');
    setTextAssistantTranscriptFinal('');
    setTextAssistantSpeechStartedAt(null);
    setTextAssistantSpeechEndedAt(null);
  }, []);

  const resetRealtimePersistence = useCallback((messageCount = 0) => {
    realtimeSaveQueueRef.current = Promise.resolve();
    nextRealtimeMessageOrderRef.current = messageCount;
  }, []);

  const playTextAvatarSpeech = useCallback((content: string) => {
    clearTextAvatarTimeout();

    if (!content.trim()) {
      setTextAvatarActivity('idle');
      return;
    }

    setTextAssistantTranscriptDelta(content);
    setTextAssistantTranscriptFinal(content);
    setTextAssistantSpeechStartedAt(getClientNow());
    setTextAssistantSpeechEndedAt(null);
    setTextAvatarActivity('speaking');
    textAvatarTimeoutRef.current = window.setTimeout(() => {
      setTextAvatarActivity('idle');
      setTextAssistantSpeechEndedAt(getClientNow());
      textAvatarTimeoutRef.current = null;
    }, getTextAvatarSpeechDuration(content));
  }, [clearTextAvatarTimeout]);

  const handleRealtimeMessage = useCallback((role: 'user' | 'assistant', content: string) => {
    const chatId = currentChatIdRef.current;
    if (!chatId || !content.trim()) return;

    const timestamp = new Date().toISOString();
    const sortOrder = nextRealtimeMessageOrderRef.current;
    nextRealtimeMessageOrderRef.current += 1;

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
        updated_at: timestamp,
        message_count: target.message_count + 1,
        last_message: content,
      };
      return [updated, ...prev.filter((session) => session.id !== chatId)];
    });

    realtimeSaveQueueRef.current = realtimeSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const response = await saveMessageToChat(chatId, role, content, { timestamp, sortOrder });
        const resolvedTitle = response.title?.trim();
        if (!resolvedTitle) return;
        setSessions((prev) => prev.map((session) => (
          session.id === chatId
            ? { ...session, title: resolvedTitle }
            : session
        )));
      })
      .catch((err) => {
        console.error('Failed to save realtime message:', err);
      });
  }, []);

  const realtimeSessionParams = useMemo(
    () => ({
      chatId: currentChatId,
      uiLanguage: lang,
      avatarDirectives: CHAT_AVATAR_AVAILABLE && isAvatarEnabled && REALTIME_AVATAR_DIRECTIVES_ENABLED,
    }),
    [currentChatId, isAvatarEnabled, lang]
  );
  const legacyRealtimeSession = useRealtimeChat({
    onMessage: handleRealtimeMessage,
    sessionParams: realtimeSessionParams,
  });
  const {
    isConnected,
    isListening,
    isSpeaking,
    messages: realtimeMessages,
    error: realtimeError,
    connect,
    disconnect,
    clearMessages,
    queueAvatarHit,
  } = legacyRealtimeSession;
  const remoteAudioStream = legacyRealtimeSession.remoteAudioStream;

  const displayMessages = useMemo(
    () => [...historyMessages, ...realtimeMessages],
    [historyMessages, realtimeMessages]
  );

  const avatarSource = useMemo(() => {
    if (mode === 'realtime') {
      return {
        mode,
        isConnected: legacyRealtimeSession.isConnected,
        isListening: legacyRealtimeSession.isListening,
        isSpeaking: legacyRealtimeSession.isSpeaking,
        remoteAudioStream,
        assistantTranscriptDelta: legacyRealtimeSession.assistantTranscriptDelta,
        assistantTranscriptFinal: legacyRealtimeSession.assistantTranscriptFinal,
        assistantSpeechStartedAt: legacyRealtimeSession.assistantSpeechStartedAt,
        assistantSpeechEndedAt: legacyRealtimeSession.assistantSpeechEndedAt,
        avatarDirective: legacyRealtimeSession.avatarDirective,
      };
    }

    return {
      mode,
      isConnected: true,
      isListening: false,
      isSpeaking: textAvatarActivity === 'speaking',
      remoteAudioStream: null,
      assistantTranscriptDelta:
        textAvatarActivity === 'thinking' && !textAssistantTranscriptDelta
          ? '…'
          : textAssistantTranscriptDelta,
      assistantTranscriptFinal: textAssistantTranscriptFinal,
      assistantSpeechStartedAt: textAssistantSpeechStartedAt,
      assistantSpeechEndedAt: textAssistantSpeechEndedAt,
      avatarDirective: null,
    };
  }, [
    legacyRealtimeSession.avatarDirective,
    legacyRealtimeSession.assistantSpeechEndedAt,
    legacyRealtimeSession.assistantSpeechStartedAt,
    legacyRealtimeSession.assistantTranscriptDelta,
    legacyRealtimeSession.assistantTranscriptFinal,
    legacyRealtimeSession.isConnected,
    legacyRealtimeSession.isListening,
    legacyRealtimeSession.isSpeaking,
    mode,
    remoteAudioStream,
    textAssistantSpeechEndedAt,
    textAssistantSpeechStartedAt,
    textAssistantTranscriptDelta,
    textAssistantTranscriptFinal,
      textAvatarActivity,
  ]);

  const live2dPerformance = useAvatarPerformance(avatarSource);
  const live2dAvatarState = useMemo(
    () => buildLive2DAvatarStateFromPerformance(live2dPerformance),
    [live2dPerformance]
  );
  const live2dDiagnostics = useMemo(
    () => ({
      ...legacyRealtimeSession.avatarDiagnostics,
      audioLevel: live2dPerformance.debug.audioLevel,
      rmsLevel: live2dPerformance.debug.rmsLevel,
      mouthDrive: live2dPerformance.debug.mouthDrive,
      mouthTarget: live2dPerformance.debug.mouthTarget,
      source: live2dPerformance.debug.directiveSource,
      lastExplicitDirective: live2dPerformance.debug.lastExplicitDirective,
    }),
    [legacyRealtimeSession.avatarDiagnostics, live2dPerformance.debug]
  );

  const statusLabel = useMemo(() => {
    if (isConnecting) return t('app.learn.status.connecting');
    if (!isConnected) return t('app.learn.status.tapToConnect');
    if (
      LIVE2D_CHAT_ENABLED &&
      CHAT_AVATAR_AVAILABLE &&
      mode === 'realtime' &&
      (live2dPerformance.dialogueState === 'thinking' || live2dPerformance.dialogueState === 'pre_speaking')
    ) {
      return t('app.learn.status.aiResponding');
    }
    if (isSpeaking || (CHAT_AVATAR_AVAILABLE && mode === 'realtime' && live2dPerformance.dialogueState === 'speaking')) {
      return t('app.learn.status.aiSpeaking');
    }
    if (isListening) return t('app.learn.status.listening');
    return t('app.learn.status.ready');
  }, [isConnecting, isConnected, isListening, isSpeaking, live2dPerformance.dialogueState, mode, t]);

  const avatarStatusLabel = useMemo(() => {
    if (mode === 'realtime') {
      return statusLabel;
    }

    if (textAvatarActivity === 'thinking') {
      return t('app.learn.status.aiResponding');
    }

    if (textAvatarActivity === 'speaking') {
      return t('app.learn.status.aiSpeaking');
    }

    return t('app.learn.status.ready');
  }, [mode, statusLabel, t, textAvatarActivity]);

  const micButtonLabel = useMemo(() => {
    if (isConnecting) return t('app.learn.status.connecting');
    if (isConnected) return t('app.learn.chat.input.connected');
    return t('app.learn.chat.input.disconnected');
  }, [isConnecting, isConnected, t]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    const previousCount = previousMessageCountRef.current;
    const nextCount = displayMessages.length;
    const behavior = previousCount === 0 ? 'auto' : nextCount > previousCount ? 'smooth' : 'auto';
    scrollToBottom(behavior);
    previousMessageCountRef.current = nextCount;
  }, [displayMessages, scrollToBottom]);

  useEffect(() => () => {
    clearTextAvatarTimeout();
  }, [clearTextAvatarTimeout]);

  const loadChat = useCallback(async (chatId: string) => {
    setLoadingChat(true);
    setError(null);
    clearTextAvatarTimeout();
    setTextAvatarActivity('idle');
    resetTextAvatarPerformance();
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
      resetRealtimePersistence(formattedMessages.length);
      setHistoryMessages(formattedMessages);
      setCurrentChatId(chatId);
      setLanguageMixLevel(chat.languageMixLevel || DEFAULT_LANGUAGE_MIX_LEVEL);
      setLanguageMixNotice(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chat');
    } finally {
      setLoadingChat(false);
    }
  }, [clearMessages, clearTextAvatarTimeout, disconnect, resetRealtimePersistence, resetTextAvatarPerformance]);

  const createNewChat = useCallback(async () => {
    setLoadingChat(true);
    setError(null);
    clearTextAvatarTimeout();
    setTextAvatarActivity('idle');
    resetTextAvatarPerformance();
    clearMessages();
    disconnect();

    try {
      const { chatId, title, languageMixLevel: createdLanguageMixLevel } = await createChatSession();
      const timestamp = new Date().toISOString();
      const newSession: ChatSession = {
        id: chatId,
        title,
        created_at: timestamp,
        updated_at: timestamp,
        message_count: 0,
        languageMixLevel: createdLanguageMixLevel || DEFAULT_LANGUAGE_MIX_LEVEL,
      };
      resetRealtimePersistence(0);
      setSessions((prev) => [newSession, ...prev]);
      setHistoryMessages([]);
      setCurrentChatId(chatId);
      setLanguageMixLevel(createdLanguageMixLevel || DEFAULT_LANGUAGE_MIX_LEVEL);
      setLanguageMixNotice(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create chat');
    } finally {
      setLoadingChat(false);
    }
  }, [clearMessages, clearTextAvatarTimeout, disconnect, resetRealtimePersistence, resetTextAvatarPerformance]);

  useEffect(() => {
    let isActive = true;

    const init = async () => {
      setLoadingSessions(true);
      setError(null);
      try {
        const chatSessions = await getChatSessions();
        if (!isActive) return;
        setSessions(chatSessions);

        const requestedSession = requestedChatId
          ? chatSessions.find((session) => session.id === requestedChatId)
          : null;

        if (requestedSession) {
          await loadChat(requestedSession.id);
        } else if (chatSessions.length > 0) {
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
    };
  }, [createNewChat, disconnect, loadChat, requestedChatId]);

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
    setIsSidebarDialogOpen(false);
    if (chatId === currentChatId) return;
    loadChat(chatId);
  };

  const handleCreateChatFromSidebar = () => {
    setIsSidebarDialogOpen(false);
    createNewChat();
  };

  const handleRecordToggle = async () => {
    setError(null);
    if (!currentChatId) return;

    try {
      clearTextAvatarTimeout();
      setTextAvatarActivity('idle');
      resetTextAvatarPerformance();

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
    clearTextAvatarTimeout();
    setTextAvatarActivity('idle');
    resetTextAvatarPerformance();
    if (mode === 'realtime' && isConnected && newMode !== 'realtime') {
      disconnect();
    }
    setMode(newMode);
  };

  const handleLanguageMixChange = async (nextValue: string) => {
    if (!currentChatId) return;

    const nextLanguageMixLevel = nextValue as LanguageMixLevel;
    const previousLanguageMixLevel = languageMixLevel;
    setLanguageMixLevel(nextLanguageMixLevel);
    setLanguageMixNotice(
      isConnected ? 'Reconnect voice to apply this language mix.' : null
    );

    try {
      const updatedChat = await updateChatSettings(currentChatId, {
        languageMixLevel: nextLanguageMixLevel,
      });
      setLanguageMixLevel(updatedChat.languageMixLevel || nextLanguageMixLevel);
      setSessions((prev) => prev.map((session) => (
        session.id === currentChatId
          ? { ...session, languageMixLevel: updatedChat.languageMixLevel || nextLanguageMixLevel }
          : session
      )));
    } catch (err) {
      setLanguageMixLevel(previousLanguageMixLevel);
      setLanguageMixNotice(null);
      setError(err instanceof Error ? err.message : 'Failed to update language mix');
    }
  };

  const handleSendText = async () => {
    if (!inputValue.trim() || isSendingText || !currentChatId) return;

    const message = inputValue.trim();
    setInputValue('');
    setIsSendingText(true);
    setError(null);
    clearTextAvatarTimeout();
    setTextAvatarActivity('thinking');
    setTextAssistantTranscriptDelta('…');
    setTextAssistantTranscriptFinal('');
    setTextAssistantSpeechStartedAt(null);
    setTextAssistantSpeechEndedAt(null);

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
      setTextAssistantTranscriptDelta(response.response);
      setTextAssistantTranscriptFinal(response.response);
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
          title: response.title || target.title,
          updated_at: assistantMessage.timestamp,
          message_count: target.message_count + 1,
          last_message: response.response,
        };
        return [updated, ...prev.filter((s) => s.id !== currentChatId)];
      });

      playTextAvatarSpeech(response.response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
      setTextAvatarActivity('idle');
      resetTextAvatarPerformance();
    } finally {
      setIsSendingText(false);
    }
  };

  const handleDeleteChat = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDeletingChat) return;
    setIsDeletingChat(true);

    try {
      await deleteChatSession(chatId);
      const remaining = sessions.filter((s) => s.id !== chatId);
      setSessions(remaining);

      if (currentChatId === chatId) {
        setCurrentChatId(null);
        setHistoryMessages([]);
        clearTextAvatarTimeout();
        setTextAvatarActivity('idle');
        resetTextAvatarPerformance();
        clearMessages();
        disconnect();
        if (remaining.length > 0) {
          await loadChat(remaining[0].id);
        } else {
          await createNewChat();
        }
      }
    } catch (err) {
      console.error('Failed to delete chat:', err);
      setError('Failed to delete chat');
    } finally {
      setIsDeletingChat(false);
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
  const levelLabel =
    assessmentResults?.proficiencyLevel ||
    assessmentResults?.actflLevel ||
    assessmentResults?.sklcLevel;
  const levelDescription =
    assessmentResults?.proficiencyDescription ||
    assessmentResults?.actflDescription ||
    assessmentResults?.sklcDescription;
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
  const languageMixOptions: Array<{ value: LanguageMixLevel; label: string }> = [
    { value: 'english_first', label: t('chat.languageMix.english_first') },
    { value: 'english_led', label: t('chat.languageMix.english_led') },
    { value: 'balanced', label: t('chat.languageMix.balanced') },
    { value: 'target_led', label: t('chat.languageMix.target_led') },
    { value: 'target_only', label: t('chat.languageMix.target_only') },
  ];

  useEffect(() => {
    if (!CHAT_AVATAR_AVAILABLE) {
      setIsAvatarEnabled(false);
      return;
    }
  }, []);

  useEffect(() => {
    if (!CHAT_AVATAR_AVAILABLE) return;
    try {
      window.localStorage.setItem(CHAT_AVATAR_ENABLED_KEY, String(isAvatarEnabled));
    } catch {
      // ignore storage failures
    }
  }, [isAvatarEnabled]);

  useEffect(() => {
    let mediaQueryList: MediaQueryList | null = null;

    try {
      mediaQueryList = window.matchMedia?.('(min-width: 1024px)') ?? null;
    } catch {
      mediaQueryList = null;
    }

    if (!mediaQueryList) return;

    setIsDesktop(mediaQueryList.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      setIsDesktop(event.matches);
    };

    if (mediaQueryList.addEventListener) {
      mediaQueryList.addEventListener('change', handleChange);
      return () => mediaQueryList?.removeEventListener('change', handleChange);
    }

    mediaQueryList.addListener(handleChange);
    return () => mediaQueryList?.removeListener(handleChange);
  }, []);

  return (
    <div className="relative flex h-[calc(100vh-7rem)] min-h-0 gap-3 -mx-2 sm:-mx-3 lg:-mx-3">
      {/* Sidebar: icon bar is in-flow, expanded panel overlays */}
      <div className="hidden h-full shrink-0 lg:block w-14">
        <div className="flex h-full w-14 flex-col items-center gap-3 rounded-2xl border-3 border-foreground bg-card py-3 shadow-stamp">
          <button
            type="button"
            onClick={() => setIsSidebarExpanded((prev) => !prev)}
            aria-label={isSidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            title={isSidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border-2 border-border bg-card text-foreground transition-colors hover:bg-secondary"
          >
            {isSidebarExpanded ? <ChevronLeft size={18} strokeWidth={2.5} /> : <ChevronRight size={18} strokeWidth={2.5} />}
          </button>
          <button
            type="button"
            onClick={() => setIsSidebarExpanded(true)}
            aria-label={t('app.learn.path.title')}
            title={t('app.learn.path.title')}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border-2 border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <BookOpen size={18} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* Sidebar expanded overlay panel */}
      <AnimatePresence initial={false}>
        {isSidebarExpanded ? (
          <>
            <motion.div
              key="sidebar-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-20 hidden lg:block"
              onClick={() => setIsSidebarExpanded(false)}
            />
            <motion.div
              key="desktop-sidebar-content"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              className="absolute left-[calc(3.5rem+0.75rem)] top-0 z-30 hidden h-full w-[22rem] flex-col gap-4 overflow-hidden lg:flex"
            >
              <ChatSessionsSidebar
                sessions={sessions}
                currentChatId={currentChatId}
                mostRecentSession={mostRecentSession}
                showResume={showResume}
                loading={loadingSessions}
                onSelectSession={handleSelectSession}
                onCreateNew={handleCreateChatFromSidebar}
                onDelete={handleDeleteChat}
                t={t}
              />
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>

      {/* Main Content: Avatar (5) + Chat (3) */}
      <div className="flex h-full min-h-0 min-w-0 flex-1 gap-3">
        {/* Virtual Avatar Panel — only available when Live2D SDK is present */}
        {CHAT_AVATAR_AVAILABLE && isAvatarEnabled && isDesktop && (
          <div className="hidden h-full min-h-0 flex-[5] overflow-hidden rounded-2xl border-3 border-foreground bg-card shadow-stamp lg:flex lg:flex-col">
            <Suspense
              fallback={
                <div className="flex flex-1 items-center justify-center">
                  <div className="text-center text-muted-foreground">
                    <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-2xl border-3 border-border bg-secondary">
                      <span className="text-3xl">🧑‍🏫</span>
                    </div>
                    <p className="text-sm font-bold">{t('app.learn.chat.title')}</p>
                    <p className="mt-1 text-xs">Loading avatar…</p>
                  </div>
                </div>
              }
            >
              <Live2DAvatarPanel
                enabled={isAvatarEnabled}
                avatarState={live2dAvatarState}
                avatarReaction={null}
                performanceFrame={live2dPerformance}
                audioLevel={live2dPerformance.debug.audioLevel}
                avatarDiagnostics={live2dDiagnostics}
                fallbackSrc={AI_AVATAR}
                statusLabel={avatarStatusLabel}
                title={t('app.learn.chat.title')}
                onAvatarHit={mode === 'realtime' ? queueAvatarHit : undefined}
              />
            </Suspense>
          </div>
        )}

        {/* Chat Panel */}
        <div className={clsx(
          'relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border-3 border-foreground bg-card shadow-stamp',
          CHAT_AVATAR_AVAILABLE && isAvatarEnabled ? 'flex-[3]' : 'flex-1'
        )}>
          <div className="z-10 flex items-center justify-between border-b-3 border-foreground bg-card p-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center space-x-2 text-sm text-primary font-bold mb-0.5">
                <MessageSquare size={16} strokeWidth={2.5} />
                <span>{t('app.learn.chat.label')}</span>
              </div>
              <h2 className="text-base font-display font-bold text-foreground truncate">
                {currentSession?.title || t('app.learn.chat.title')}
              </h2>
              {levelDescription && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{levelDescription}</p>
              )}
              {(levelLabel || focusBadge || topDomain) && (
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  {levelLabel && (
                    <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-lg border border-primary/20">
                      {levelLabel}
                    </span>
                  )}
                  {focusBadge && (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${focusBadgeClass}`}>
                      {focusBadge}
                    </span>
                  )}
                  {topDomain && (
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-lg ${
                        domainBadgeStyles[topDomain[0]] || 'bg-secondary text-muted-foreground border border-border'
                      }`}
                    >
                      {getDomainLabel(topDomain[0])} {topDomain[1]}/10
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center space-x-2 shrink-0 ml-3">
              <div className="flex flex-col items-end gap-1 mr-1">
                <select
                  aria-label={t('chat.languageMix.label')}
                  value={languageMixLevel}
                  onChange={(event) => void handleLanguageMixChange(event.target.value)}
                  disabled={!currentChatId}
                  className="h-8 rounded-xl border-2 border-border bg-card px-2 text-xs font-bold text-foreground focus:border-primary focus:outline-none"
                >
                  {languageMixOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {languageMixNotice ? (
                  <p className="max-w-48 text-right text-[10px] font-medium text-muted-foreground">
                    {languageMixNotice}
                  </p>
                ) : null}
              </div>
              <div className="flex bg-secondary rounded-xl p-1 border-2 border-border">
                <button
                  type="button"
                  onClick={() => handleModeChange('text')}
                  className={clsx(
                    'h-8 px-2.5 rounded-lg text-xs font-bold transition-colors',
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
                    'h-8 px-2.5 rounded-lg text-xs font-bold transition-colors',
                    mode === 'realtime'
                      ? 'bg-card text-primary border-2 border-foreground shadow-stamp-sm'
                      : 'text-muted-foreground hover:text-foreground border-2 border-transparent'
                  )}
                >
                  {t('chat.voiceMode')}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setIsSidebarDialogOpen(true)}
                aria-label={t('app.learn.sessions.title')}
                title={t('app.learn.sessions.title')}
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl border-2 border-border bg-card text-foreground transition-colors hover:bg-secondary lg:hidden"
              >
                <Menu size={14} strokeWidth={2.5} />
              </button>
              {CHAT_AVATAR_AVAILABLE && (
                <button
                  type="button"
                  onClick={() => setIsAvatarEnabled((prev) => !prev)}
                  aria-label={isAvatarEnabled ? 'Hide avatar' : 'Show avatar'}
                  title={isAvatarEnabled ? 'Hide avatar' : 'Show avatar'}
                  className={clsx(
                    'hidden lg:inline-flex h-8 w-8 items-center justify-center rounded-xl border-2 transition-colors',
                    isAvatarEnabled
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary hover:border-border'
                  )}
                >
                  <MonitorPlay size={16} strokeWidth={2.5} />
                </button>
              )}
              <button
                type="button"
                onClick={createNewChat}
                aria-label={t('app.learn.sessions.newChatTitle')}
                title={t('app.learn.sessions.newChatTitle')}
                className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-xl border-2 border-transparent hover:border-border transition-colors"
              >
                <RefreshCcw size={16} strokeWidth={2.5} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 bg-secondary/50 relative">
            {error || realtimeError ? (
              <div className="mb-4 p-3 rounded-xl border-2 border-destructive bg-destructive/10 text-sm text-destructive font-medium">
                {error || realtimeError}
              </div>
            ) : null}

            {loadingChat ? (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('app.learn.chat.loading')}
              </div>
            ) : displayMessages.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t('app.learn.chat.empty')}</div>
            ) : (
              <div className="space-y-3 pb-20">
                {displayMessages.map((msg) => {
                  const isUser = msg.role === 'user';
                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={clsx('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}
                    >
                      {isUser && !userAvatar ? (
                        <div
                          aria-label="You"
                          className="w-10 h-10 shrink-0 rounded-xl bg-secondary border-2 border-foreground flex items-center justify-center text-muted-foreground"
                        >
                          <CircleUserRound className="h-6 w-6" strokeWidth={1.75} />
                        </div>
                      ) : (
                        <img
                          src={isUser ? (userAvatar as string) : AI_AVATAR}
                          alt={isUser ? 'You' : 'Lingual AI'}
                          className="w-10 h-10 shrink-0 rounded-xl bg-card border-2 border-foreground object-cover object-center"
                        />
                      )}
                      <div
                        className={clsx(
                          'max-w-[85%] px-3 py-2.5 rounded-xl text-[11.7px] leading-[1.45] border-2',
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

          <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-card via-card to-transparent">
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
                  {statusLabel}
                </div>
                <button
                  type="button"
                  onClick={handleRecordToggle}
                  disabled={!currentChatId || isConnecting}
                  aria-label={micButtonLabel}
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

      <Dialog open={isSidebarDialogOpen} onOpenChange={setIsSidebarDialogOpen}>
        <DialogContent className="grid h-[calc(100vh-2rem)] w-[calc(100vw-1.5rem)] max-w-[34rem] grid-rows-[auto_minmax(0,1fr)] gap-4 rounded-2xl border-3 border-foreground bg-background p-4 shadow-stamp lg:hidden">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle className="font-display text-lg text-foreground">
              {t('app.learn.sessions.title')}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {t('app.learn.sessions.subtitle')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
            <div className="min-h-0 flex-1">
              <ChatSessionsSidebar
                sessions={sessions}
                currentChatId={currentChatId}
                mostRecentSession={mostRecentSession}
                showResume={showResume}
                loading={loadingSessions}
                onSelectSession={handleSelectSession}
                onCreateNew={handleCreateChatFromSidebar}
                onDelete={handleDeleteChat}
                t={t}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
