
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Play,
  RefreshCcw,
  MessageSquare,
  Mic,
  Plus,
  History,
  Loader2,
  Gamepad2,
  Trash2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
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
import { generateFlashcards, type Flashcard } from '@/api/minigames';
import { FlashcardFlip, WordMatch } from '@/components/minigames';
import type { ChatMessage, ChatSession, AssessmentResults, UserProfile } from '@/types';
import { useLanguage } from '@/contexts/LanguageContext';


const USER_AVATAR = '/imgs/landing/student.jpg';
const AI_AVATAR = '/imgs/avatars/ai.svg';


const formatShortDate = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};


function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
  t,
}: {
  session: ChatSession;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  t: (key: string) => string;
}) {
  const hasMessages = session.message_count > 0;
  const lastMessage = session.last_message || t('app.learn.sessions.noMessages');


  return (
    <div
      onClick={() => onSelect(session.id)}
      className={clsx(
        'w-full text-left relative flex items-center p-4 rounded-xl border transition-all mb-2 cursor-pointer group',
        isActive
          ? 'bg-white border-purple-200 shadow-lg ring-2 ring-purple-100'
          : 'bg-white border-slate-100 hover:border-purple-200'
      )}
    >
      <div
        className={clsx(
          'w-10 h-10 rounded-full flex items-center justify-center mr-4 z-10',
          hasMessages ? 'bg-purple-600 text-white shadow-lg shadow-purple-200' : 'bg-slate-200 text-slate-400'
        )}
      >
        {hasMessages ? <CheckCircle2 size={20} /> : <Play size={18} fill="currentColor" />}
      </div>


      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-bold text-sm text-slate-900 truncate">
            {session.title || t('app.learn.sessions.newChatTitle')}
          </h4>
          <span className="text-xs text-slate-400">{formatShortDate(session.updated_at)}</span>
        </div>
        <p className="text-xs text-slate-500 mt-1 truncate">{lastMessage}</p>
      </div>


      {hasMessages && (
        <div className="ml-3 text-xs font-semibold text-purple-600 bg-purple-50 px-2 py-1 rounded-full">
          {session.message_count}
        </div>
      )}


      {/* Delete button - shows on hover */}
      <button
        onClick={(e) => onDelete(session.id, e)}
        className="absolute right-2 top-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-red-500 hover:bg-red-50"
        title={t('chat.deleteConfirm') || 'Delete chat'}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}


export function AppLearningPage() {
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


  // Minigames state
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [loadingFlashcards, setLoadingFlashcards] = useState(false);
  const [showWordMatch, setShowWordMatch] = useState(false);
  const [wordMatchPairs, setWordMatchPairs] = useState<Flashcard[]>([]);
  const [loadingWordMatch, setLoadingWordMatch] = useState(false);


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


  // Minigame handlers
  const handleFlashcardGame = async () => {
    if (!currentChatId) return;
    setLoadingFlashcards(true);
    try {
      const cards = await generateFlashcards(currentChatId);
      setFlashcards(cards);
      setShowFlashcards(true);
    } catch (err) {
      setError('Failed to generate flashcards');
    } finally {
      setLoadingFlashcards(false);
    }
  };


  const handleWordMatchGame = async () => {
    if (!currentChatId) return;
    setLoadingWordMatch(true);
    try {
      const cards = await generateFlashcards(currentChatId);
      setWordMatchPairs(cards);
      setShowWordMatch(true);
    } catch (err) {
      setError('Failed to generate word match pairs');
    } finally {
      setLoadingWordMatch(false);
    }
  };


  // Mode change handler
  const handleModeChange = (newMode: Mode) => {
    if (mode === 'realtime' && isConnected && newMode !== 'realtime') {
      disconnect();
    }
    setMode(newMode);
  };


  // Text message handler
  const handleSendText = async () => {
    if (!inputValue.trim() || isSendingText || !currentChatId) return;


    const message = inputValue.trim();
    setInputValue('');
    setIsSendingText(true);
    setError(null);


    // Add user message immediately
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };
    setHistoryMessages((prev) => [...prev, userMessage]);


    // Update session in sidebar
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


      // Update session again for assistant message
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


  // Delete chat handler
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
        // Load another chat or create new one
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
  const domainStyles: Record<string, string> = {
    grammar: 'bg-purple-500',
    vocabulary: 'bg-blue-500',
    pragmatics: 'bg-amber-500',
    pronunciation: 'bg-emerald-500',
  };
  const domainBadgeStyles: Record<string, string> = {
    grammar: 'bg-purple-50 text-purple-700',
    vocabulary: 'bg-blue-50 text-blue-700',
    cultural: 'bg-indigo-50 text-indigo-700',
    pragmatics: 'bg-amber-50 text-amber-700',
    pronunciation: 'bg-emerald-50 text-emerald-700',
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
  <div className="grid lg:grid-cols-12 gap-8 h-full">
      <div className="lg:col-span-4 flex flex-col h-full gap-2">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-2">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">
                {t('app.learn.path.label')}
              </p>
              <p className="text-sm font-bold text-slate-900">
                {t('app.learn.path.title')}
              </p>
            </div>
            {assessmentResults?.sklcLevel ? (
              <span className="text-xs font-semibold text-purple-700 bg-purple-50 px-3 py-1 rounded-full">
                {t('app.learn.path.level')} {assessmentResults.sklcLevel}
              </span>
            ) : (
              <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                {t('app.learn.path.pending')}
              </span>
            )}
          </div>
          {assessmentResults?.sklcDescription ? (
            <p className="text-sm text-slate-500 mb-2">{assessmentResults.sklcDescription}</p>
          ) : (
            <div className="mb-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
              <p className="text-sm font-semibold text-slate-900">
                {t('app.learn.path.empty.title')}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {t('app.learn.path.empty.description')}
              </p>
              <button
                onClick={() => (window.location.href = '/assessment')}
                className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-purple-600 hover:text-purple-700"
              >
                {t('app.learn.path.empty.cta')}
              </button>
            </div>
          )}


          {focusAreas.length > 0 && (
            <div className="mb-2">
              <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">
                {t('app.learn.path.focus')}
              </p>
              <div className="flex flex-wrap gap-2">
                {focusAreas.map((area) => (
                  <span
                    key={area}
                    className="text-xs font-semibold text-slate-600 bg-slate-100 px-3 py-1 rounded-full"
                  >
                    {getCategoryLabel(area)}
                  </span>
                ))}
              </div>
            </div>
          )}


          {domainEntries.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">
                {t('app.learn.path.strengths')}
              </p>
              {domainEntries.slice(0, 3).map(([domain, score]) => (
                <div key={domain} className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="font-medium text-slate-700 capitalize">
                      {domain.replace(/_/g, ' ')}
                    </span>
                    <span>{score}/10</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full ${domainStyles[domain] || 'bg-slate-400'}`}
                      style={{ width: `${score * 10}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>


        {/* Minigames Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-1">
          <div className="flex items-center gap-2 mb-2">
            <Gamepad2 size={18} className="text-purple-600" />
            <p className="font-bold text-xs text-slate-900">{t('app.learn.minigames.title') || 'Practice Games'}</p>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <button
              onClick={handleFlashcardGame}
              disabled={!currentChatId || loadingFlashcards}
              className={clsx(
                'p-4 rounded-xl border transition-all text-left',
                currentChatId
                  ? 'border-purple-100 bg-purple-50 hover:bg-purple-100 hover:border-purple-200'
                  : 'border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed'
              )}
            >
              <span className="text-2xl mb-2 block">🃏</span>
              <span className="text-xs font-semibold text-slate-900">
                {t('app.learn.minigames.flashcards') || 'Flashcard Flip'}
              </span>
              <p className="text-xs text-slate-500 mt-1">
                {t('app.learn.minigames.flashcardsDesc') || 'Review vocabulary'}
              </p>
            </button>
            <button
              onClick={handleWordMatchGame}
              disabled={!currentChatId || loadingWordMatch}
              className={clsx(
                'p-4 rounded-xl border transition-all text-left',
                currentChatId
                  ? 'border-blue-100 bg-blue-50 hover:bg-blue-100 hover:border-blue-200'
                  : 'border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed'
              )}
            >
              <span className="text-2xl mb-2 block">🔗</span>
              <span className="text-xs font-semibold text-slate-900">
                {t('app.learn.minigames.wordMatch') || 'Word Match'}
              </span>
              <p className="text-xs text-slate-500 mt-1">
                {t('app.learn.minigames.wordMatchDesc') || 'Match pairs'}
              </p>
            </button>
          </div>
          {!currentChatId && (
            <p className="text-xs text-slate-400 mt-3 text-center">
              {t('app.learn.minigames.selectChat') || 'Start a chat to unlock games'}
            </p>
          )}
        </div>


        <div className="flex-1 min-h-0 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-slate-100 bg-slate-50 flex items-start justify-between gap-1">
            <div>
              <p className="text-xs font-bold text-slate-900">
                {t('app.learn.sessions.title')}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {t('app.learn.sessions.subtitle')}
              </p>
            </div>
            <button
              onClick={createNewChat}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold text-purple-600 bg-white border border-purple-100 hover:bg-purple-50"
            >
              <Plus size={16} />
              {t('app.learn.sessions.new')}
            </button>
          </div>


          {/* Practice Sessions */}
          <div className="flex-1 overflow-y-auto p-2">
            {showResume && mostRecentSession ? (
              <button
                onClick={() => handleSelectSession(mostRecentSession.id)}
                className="w-full mb-2 p-2 rounded-xl border border-purple-100 bg-purple-50 text-left hover:bg-purple-100 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="w-10 h-10 rounded-full bg-white text-purple-600 flex items-center justify-center shadow-sm">
                    <History size={18} />
                  </span>
                <div className="min-w-0">
                  <p className="text-xs text-purple-600 font-semibold uppercase tracking-wide">
                    {t('app.learn.sessions.resume')}
                  </p>
                  <p className="text-xs font-semibold text-slate-900 truncate">
                    {mostRecentSession.title || t('app.learn.sessions.latest')}
                  </p>
                    {mostRecentSession.last_message ? (
                      <p className="text-xs text-slate-500 truncate">{mostRecentSession.last_message}</p>
                    ) : null}
                  </div>
                </div>
              </button>
          ) : null}
          {loadingSessions ? (
            <div className="text-xs text-slate-500">{t('app.learn.sessions.loading')}</div>
          ) : sessions.length === 0 ? (
            <div className="text-xs text-slate-500">{t('app.learn.sessions.empty')}</div>
          ) : (
            sessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={session.id === currentChatId}
                onSelect={handleSelectSession}
                onDelete={handleDeleteChat}
                t={t}
              />
            ))
          )}
          </div>
        </div>
      </div>


      <div className="lg:col-span-8 flex flex-col h-full bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-white z-10 shadow-sm">
          <div>
            <div className="flex items-center space-x-2 text-sm text-purple-600 font-medium mb-0.5">
              <MessageSquare size={16} />
              <span className="text-xs">{t('app.learn.chat.label')}</span>
            </div>
            <h2 className="text-lg font-bold text-slate-900">
              {currentSession?.title || t('app.learn.chat.title')}
            </h2>
            {(assessmentResults?.sklcLevel || focusBadge || topDomain) && (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {assessmentResults?.sklcLevel && (
                  <span className="text-xs font-semibold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-full">
                    {t('app.learn.chat.badges.level')} {assessmentResults.sklcLevel}
                  </span>
                )}
                {focusBadge && (
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${focusBadgeClass}`}>
                    {t('app.learn.chat.badges.focus')} {focusBadge}
                  </span>
                )}
                {topDomain && (
                  <span
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                      domainBadgeStyles[topDomain[0]] || 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {t('app.learn.chat.badges.strength')} {getDomainLabel(topDomain[0])} • {topDomain[1]}/10
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center space-x-4">
            {/* Mode Toggle */}
            <div className="flex bg-slate-100 rounded-lg p-1">
              <button
                type="button"
                onClick={() => handleModeChange('text')}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  mode === 'text'
                    ? 'bg-white text-purple-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {t('chat.textMode')}
              </button>
              <button
                type="button"
                onClick={() => handleModeChange('realtime')}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  mode === 'realtime'
                    ? 'bg-white text-purple-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {t('chat.voiceMode')}
              </button>
            </div>
            {mode === 'realtime' && (
              <div className="hidden sm:flex items-center space-x-2 bg-slate-100 px-3 py-1.5 rounded-lg text-sm">
                <span className="text-slate-500">{t('app.learn.chat.status')}</span>
                <span className="font-semibold text-xs text-slate-800">{statusLabel}</span>
              </div>
            )}
            <button
              onClick={createNewChat}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg"
            >
              <RefreshCcw size={20} />
            </button>
          </div>
        </div>


        <div className="flex-1 overflow-y-auto p-2 bg-slate-50/50 relative">
          {error || realtimeError ? (
            <div className="mb-2 p-2 rounded-lg border border-red-100 bg-red-50 text-sm text-red-600">
              {error || realtimeError}
            </div>
          ) : null}


          {loadingChat ? (
            <div className="text-sm text-slate-500">{t('app.learn.chat.loading')}</div>
          ) : historyMessages.length === 0 ? (
            <div className="text-sm text-slate-500">{t('app.learn.chat.empty')}</div>
          ) : (
            <div className="space-y-6 max-w-3xl mx-auto pb-32">
              {historyMessages.map((msg) => {
                const isUser = msg.role === 'user';
                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={clsx('flex gap-2', isUser ? 'flex-row-reverse' : 'flex-row')}
                  >
                    <img
                      src={isUser ? USER_AVATAR : AI_AVATAR}
                      alt={isUser ? 'You' : 'Lingual AI'}
                      className="w-10 h-10 rounded-full bg-white border border-slate-200 shadow-sm"
                    />
                    <div
                      className={clsx(
                        'max-w-[80%] p-4 rounded-2xl shadow-sm text-lg leading-relaxed',
                        isUser
                          ? 'bg-purple-600 text-white rounded-tr-none'
                          : 'bg-white text-slate-800 border border-slate-100 rounded-tl-none'
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


        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-white via-white to-transparent">
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
                className="flex items-center justify-between gap-2"
              >
                <div className="flex-1 bg-white border border-slate-200 rounded-2xl px-4 py-3 text-slate-400">
                  {isConnected
                    ? t('app.learn.chat.input.connected')
                    : t('app.learn.chat.input.disconnected')}
                </div>
                <button
                  onClick={handleRecordToggle}
                  disabled={!currentChatId || isConnecting}
                  className={clsx(
                    'w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all',
                    isConnected
                      ? isSpeaking
                        ? 'bg-purple-500 text-white'
                        : isListening
                        ? 'bg-red-500 text-white animate-pulse'
                        : 'bg-emerald-500 text-white'
                      : 'bg-purple-600 hover:bg-purple-700 text-white',
                    (isConnecting || !currentChatId) && 'opacity-60 cursor-not-allowed'
                  )}
                >
                  <Mic size={20} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>


      {/* Minigame Modals */}
      <AnimatePresence>
        {showFlashcards && flashcards.length > 0 && (
          <FlashcardFlip
            flashcards={flashcards}
            onClose={() => setShowFlashcards(false)}
          />
        )}
        {showWordMatch && wordMatchPairs.length > 0 && (
          <WordMatch
            wordPairs={wordMatchPairs}
            onClose={() => setShowWordMatch(false)}
          />
        )}
      </AnimatePresence>


      {/* Loading Overlays */}
      {loadingFlashcards && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-2 flex items-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-purple-600" />
            <span>{t('app.learn.minigames.loadingFlashcards') || 'Generating flashcards...'}</span>
          </div>
        </div>
      )}
      {loadingWordMatch && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-2 flex items-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            <span>{t('app.learn.minigames.loadingWordMatch') || 'Generating word match game...'}</span>
          </div>
        </div>
      )}
    </div>
  );
}
