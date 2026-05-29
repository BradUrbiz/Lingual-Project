import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Plus, MessageSquare, Trash2, ChevronLeft, Hand } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { useRealtimeChat } from '../hooks/useRealtimeChat';
import { useRealtimeSpeakingSpeed } from '../hooks/useRealtimeSpeakingSpeed';
import { getUserProfile } from '../api/user';
import {
  getChatSessions,
  createChatSession,
  getChatSession,
  deleteChatSession,
  sendChatMessage,
  saveMessageToChat,
} from '../api/chat';
// FLASHCARDFLIP
import { generateFlashcards, type Flashcard } from '../api/minigames';
import { FlashcardFlip, WordMatch } from '../components/minigames';
import { SpeakingSpeedControl } from '../components/chat/SpeakingSpeedControl';
// FLASHCARDFLIP
import {
  Card,
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { messageVariants } from '@/lib/animations';
import {
  ChatMessage,
  ChatInput,
  ProfileSidebar,
} from '../components/chat';
import type {
  UserProfile,
  ChatMessage as ChatMessageType,
  ChatSession,
  ChatSessionDetail,
} from '../types';

type Mode = 'text' | 'realtime';
type View = 'list' | 'chat';

export function ChatPage() {
  const { t } = useLanguage();
  const [view, setView] = useState<View>('list');
  const [mode, setMode] = useState<Mode>('realtime');
  const [inputValue, setInputValue] = useState('');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [aiState, setAiState] = useState<'speak' | 'notalk' | 'bruh'>('notalk');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Chat sessions state
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [currentChat, setCurrentChat] = useState<ChatSessionDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogChatId, setDeleteDialogChatId] = useState<string | null>(null);
  const [isDeletingChat, setIsDeletingChat] = useState(false);
  const [speakingSpeed, setSpeakingSpeed] = useRealtimeSpeakingSpeed();

  // FLASHCARDFLIP
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [loadingFlashcards, setLoadingFlashcards] = useState(false);
  const [showWordMatch, setShowWordMatch] = useState(false);
  const [wordMatchPairs, setWordMatchPairs] = useState<Flashcard[]>([]);
  const [loadingWordMatch, setLoadingWordMatch] = useState(false);
  // FLASHCARDFLIP

  // Use ref for currentChatId to avoid stale closures in callback
  const currentChatIdRef = useRef<string | null>(null);
  const realtimeSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const nextRealtimeMessageOrderRef = useRef(0);
  currentChatIdRef.current = currentChatId;

  // Callback to save realtime messages to database
  const handleRealtimeMessage = useCallback((role: 'user' | 'assistant', content: string) => {
    const chatId = currentChatIdRef.current;
    if (chatId && content.trim()) {
      const sortOrder = nextRealtimeMessageOrderRef.current;
      const timestamp = new Date().toISOString();
      nextRealtimeMessageOrderRef.current += 1;

      realtimeSaveQueueRef.current = realtimeSaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          await saveMessageToChat(chatId, role, content, { timestamp, sortOrder });
        })
        .catch((err) => {
          console.error('Failed to save realtime message:', err);
        });
    }
  }, []);

  // Realtime chat hook
  const {
    isConnected,
    isListening,
    isSpeaking,
    messages: realtimeMessages,
    error: realtimeError,
    isTutorHoldActive,
    hasHeldTutorResponse,
    connect,
    disconnect,
    updateSpeakingSpeed,
    clearMessages: clearRealtimeMessages,
    setTutorHoldActive,
  } = useRealtimeChat({ onMessage: handleRealtimeMessage });

  const handleSpeakingSpeedChange = useCallback((nextSpeed: number) => {
    setSpeakingSpeed(nextSpeed);
    if (isConnected) {
      updateSpeakingSpeed(nextSpeed);
    }
  }, [isConnected, setSpeakingSpeed, updateSpeakingSpeed]);

  // Use realtime messages when in realtime mode
  const displayMessages = mode === 'realtime' ? realtimeMessages : messages;
  const displayError = mode === 'realtime' ? realtimeError : error;

  useEffect(() => {
    loadProfile();
    loadChatSessions();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [displayMessages]);

  // Update AI state based on realtime status
  useEffect(() => {
    if (mode === 'realtime') {
      if (isSpeaking) {
        setAiState('speak');
      } else if (isListening) {
        setAiState('bruh');
      } else {
        setAiState('notalk');
      }
    }
  }, [mode, isSpeaking, isListening]);

  // Disconnect realtime when switching modes
  const handleModeChange = (newMode: Mode) => {
    if (mode === 'realtime' && isConnected && newMode !== 'realtime') {
      disconnect();
    }
    setMode(newMode);
  };

  const loadProfile = async () => {
    try {
      const data = await getUserProfile();
      setProfile(data);
    } catch (err) {
      console.error('Failed to load profile:', err);
    }
  };

  const loadChatSessions = async () => {
    setLoadingChats(true);
    try {
      const sessions = await getChatSessions();
      setChatSessions(sessions);
    } catch (err) {
      console.error('Failed to load chat sessions:', err);
    } finally {
      setLoadingChats(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSelectChat = async (chatId: string) => {
    setIsLoading(true);
    setError(null);
    // Clear realtime messages when switching chats
    clearRealtimeMessages();
    try {
      const chat = await getChatSession(chatId);
      setCurrentChatId(chatId);
      setCurrentChat(chat);
      // Convert messages to ChatMessageType format
      const formattedMessages: ChatMessageType[] = chat.messages.map((msg, index) => ({
        id: `${chatId}-${index}`,
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
        timestamp: msg.timestamp,
      }));
      realtimeSaveQueueRef.current = Promise.resolve();
      nextRealtimeMessageOrderRef.current = formattedMessages.length;
      setMessages(formattedMessages);
      setView('chat');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chat');
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewChat = async () => {
    setIsLoading(true);
    setError(null);
    // Clear realtime messages when creating new chat
    clearRealtimeMessages();
    try {
      const { chatId } = await createChatSession();
      realtimeSaveQueueRef.current = Promise.resolve();
      nextRealtimeMessageOrderRef.current = 0;
      setCurrentChatId(chatId);
      setCurrentChat({
        id: chatId,
        title: 'New Chat',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        messages: [],
      });
      // Add welcome message (don't save to DB - it's just UI)
      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          content: t('chat.welcome'),
          timestamp: new Date().toISOString(),
        },
      ]);
      setView('chat');
      // Refresh chat list
      loadChatSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create chat');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteChat = (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteDialogChatId(chatId);
  };

  const handleConfirmDeleteChat = async () => {
    if (!deleteDialogChatId || isDeletingChat) return;
    const chatId = deleteDialogChatId;
    setIsDeletingChat(true);

    try {
      await deleteChatSession(chatId);
      const remainingChats = chatSessions.filter((c) => c.id !== chatId);
      setChatSessions(remainingChats);
      if (currentChatId === chatId) {
        setCurrentChatId(null);
        setCurrentChat(null);
        setMessages([]);
        setView('list');
      }
    } catch (err) {
      console.error('Failed to delete chat:', err);
    } finally {
      setIsDeletingChat(false);
      setDeleteDialogChatId(null);
    }
  };

  const handleBackToList = () => {
    if (mode === 'realtime' && isConnected) {
      disconnect();
    }
    clearRealtimeMessages();
    setView('list');
    setCurrentChatId(null);
    setCurrentChat(null);
    setMessages([]);
    loadChatSessions();
  };

  // FLASHCARDFLIP
  const handleMinigameCommand = async (command: string): Promise<boolean> => {
    if (!currentChatId) return false;
    if (command.toLowerCase() === '!flashcardflip') {
      setLoadingFlashcards(true);
      try {
        const cards = await generateFlashcards(currentChatId);
        setFlashcards(cards);
        setShowFlashcards(true);
      } catch (err) {
        console.error('Failed to generate flashcards:', err);
        setError('Failed to generate flashcards');
      } finally {
        setLoadingFlashcards(false);
      }
      return true;
    }
    if (command.toLowerCase() === '!wordmatch') {
      setLoadingWordMatch(true);
      try {
        const cards = await generateFlashcards(currentChatId);
        setWordMatchPairs(cards);
        setShowWordMatch(true);
      } catch (err) {
        console.error('Failed to generate word match pairs:', err);
        setError('Failed to generate word match pairs');
      } finally {
        setLoadingWordMatch(false);
      }
      return true;
    }
    return false;
  };
  // FLASHCARDFLIP

  const handleSendText = async () => {
    if (!inputValue.trim() || isLoading || !currentChatId) return;

    const message = inputValue;
    
    // FLASHCARDFLIP
    // Check for minigame commands first
    if (message.startsWith('!')) {
      setInputValue('');
      const isCommand = await handleMinigameCommand(message.trim());
      if (isCommand) return;
      // If not a valid command, continue with normal message
      setInputValue(message);
    }
    // FLASHCARDFLIP

    setInputValue('');
    setIsLoading(true);
    setAiState('speak');

    // Add user message immediately
    const userMessage: ChatMessageType = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const response = await sendChatMessage(currentChatId, message);
      // Add assistant message
      const assistantMessage: ChatMessageType = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response.response,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setIsLoading(false);
      setAiState('notalk');
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return t('chat.today') || 'Today';
    } else if (days === 1) {
      return t('chat.yesterday') || 'Yesterday';
    } else if (days < 7) {
      return `${days} ${t('chat.daysAgo') || 'days ago'}`;
    } else {
      return date.toLocaleDateString();
    }
  };
  const pendingDeleteChat = deleteDialogChatId
    ? chatSessions.find((chat) => chat.id === deleteDialogChatId) ?? null
    : null;

  // Chat List View
  if (view === 'list') {
    return (
      <AnimatedPage className="min-h-screen bg-background p-4">
        <div className="max-w-2xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <h1 className="text-2xl font-bold text-accent mb-2">
              {t('chat.title')}
            </h1>
            <p className="text-muted-foreground">{t('chat.selectOrCreate')}</p>
          </motion.div>

          {/* New Chat Button */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-6"
          >
            <Button
              onClick={handleNewChat}
              className="w-full gap-2"
              size="lg"
              disabled={isLoading}
            >
              <Plus className="h-5 w-5" />
              {t('chat.newChat')}
            </Button>
          </motion.div>

          {/* Chat List */}
          {loadingChats ? (
            <div className="flex justify-center py-12">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              >
                <Loader2 className="h-8 w-8 text-primary" />
              </motion.div>
            </div>
          ) : chatSessions.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12"
            >
              <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">{t('chat.noChats')}</p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                {t('chat.startNewChat')}
              </p>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="space-y-3"
            >
              {chatSessions.map((chat, index) => (
                <motion.div
                  key={chat.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card
                    className="p-4 cursor-pointer hover:border-accent/50 transition-colors group"
                    onClick={() => handleSelectChat(chat.id)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium truncate">{chat.title}</h3>
                        {chat.last_message && (
                          <p className="text-sm text-muted-foreground truncate mt-1">
                            {chat.last_message}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground/70 mt-2">
                          {formatDate(chat.updated_at)} · {chat.message_count}{' '}
                          {t('chat.messages')}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={(e) => handleDeleteChat(chat.id, e)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </AnimatedPage>
    );
  }

  // Chat View
  return (
    <AnimatedPage className="h-full overflow-hidden bg-background p-4">
      <div className="max-w-6xl mx-auto flex gap-6 h-full">
        {/* Main Chat Area */}
        <Card className="flex-1 flex flex-col h-full shadow-lg">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 border-b border-gray-100"
          >
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBackToList}
                  className="h-8 w-8 p-0"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <div>
                  <h1 className="text-xl font-bold text-accent">
                    {currentChat?.title || t('chat.title')}
                  </h1>
                  <p className="text-sm text-muted-foreground">{t('chat.subtitle')}</p>
                </div>
              </div>
              {/* Custom Mode Toggle with Realtime option */}
              <div className="flex bg-gray-100 rounded-lg p-1">
                <button
                  type="button"
                  onClick={() => handleModeChange('text')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    mode === 'text'
                      ? 'bg-white text-primary shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t('chat.textMode')}
                </button>
                <button
                  type="button"
                  onClick={() => handleModeChange('realtime')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    mode === 'realtime'
                      ? 'bg-white text-primary shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Realtime
                </button>
              </div>
            </div>
          </motion.div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <AnimatePresence initial={false}>
              {displayMessages.map((message) => (
                <motion.div
                  key={message.id}
                  variants={messageVariants}
                  initial="initial"
                  animate="animate"
                  layout
                >
                  <ChatMessage
                    role={message.role}
                    content={message.content}
                  />
                </motion.div>
              ))}
            </AnimatePresence>

            <AnimatePresence>
              {isLoading && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex justify-start"
                >
                  <div className="bg-muted px-4 py-3 rounded-2xl rounded-bl-md">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    >
                      <Loader2 className="h-5 w-5 text-primary" />
                    </motion.div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {displayError && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                >
                  <Alert variant="destructive">
                    <AlertDescription>{displayError}</AlertDescription>
                  </Alert>
                </motion.div>
              )}
            </AnimatePresence>

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 border-t border-gray-100"
          >
            <AnimatePresence mode="wait">
              {mode === 'text' && (
                <motion.div
                  key="text-input"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                >
                  <ChatInput
                    value={inputValue}
                    onChange={setInputValue}
                    onSend={handleSendText}
                    disabled={isLoading}
                    placeholder={t('chat.placeholder')}
                  />
                </motion.div>
              )}
              {mode === 'realtime' && (
                <motion.div
                  key="realtime-input"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="flex flex-col items-center gap-4"
                >
                  {/* Connection Status */}
                  <div className="flex items-center gap-2 text-sm">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        isConnected ? 'bg-green-500' : 'bg-gray-400'
                      }`}
                    />
                    <span className="text-muted-foreground">
                      {isConnected ? 'Connected' : 'Waiting to connect'}
                    </span>
                  </div>

                  <SpeakingSpeedControl
                    value={speakingSpeed}
                    onChange={handleSpeakingSpeedChange}
                    className="justify-center"
                  />

                  {/* Voice Button */}
                  <button
                    type="button"
                    onClick={() => {
                      if (isConnected) {
                        disconnect();
                      } else {
                        void connect({ chatId: currentChatId, speakingSpeed });
                      }
                    }}
                    className={`relative w-20 h-20 rounded-full transition-all duration-300 ${
                      isConnected
                        ? isSpeaking
                          ? 'bg-purple-500 scale-110'
                          : isListening
                          ? 'bg-red-500'
                          : 'bg-green-500 hover:bg-green-600'
                        : 'bg-primary hover:bg-primary/90'
                    }`}
                  >
                    {/* Ripple effect when listening */}
                    {isListening && (
                      <span className="absolute inset-0 rounded-full bg-red-400 animate-ping opacity-25" />
                    )}

                    {/* Icon */}
                    <span className="relative text-white text-2xl">
                      {isConnected ? (
                        isSpeaking ? '🔊' : isListening ? '🎤' : '🎙️'
                      ) : (
                        '📞'
                      )}
                    </span>
                  </button>

                  {/* Status Text */}
                  <p className="text-muted-foreground text-sm">
                    {isConnected
                      ? isSpeaking
                        ? 'Lingu is speaking...'
                        : isTutorHoldActive
                        ? t('app.learn.status.tutorHold')
                        : isListening
                        ? 'Listening...'
                        : 'Speak to chat'
                      : 'Press button to start'}
                  </p>

                  <button
                    type="button"
                    onClick={() => setTutorHoldActive(!isTutorHoldActive)}
                    disabled={!isConnected}
                    aria-pressed={isTutorHoldActive}
                    aria-label={isTutorHoldActive ? t('app.learn.chat.hold.release') : t('app.learn.chat.hold.inactive')}
                    title={isTutorHoldActive ? t('app.learn.chat.hold.release') : t('app.learn.chat.hold.inactive')}
                    className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors ${
                      isTutorHoldActive
                        ? 'border-amber-700 bg-amber-100 text-amber-950'
                        : 'border-border bg-background text-foreground hover:bg-accent'
                    } ${!isConnected ? 'cursor-not-allowed opacity-50' : ''}`}
                  >
                    <Hand className="h-4 w-4" />
                    <span>
                      {isTutorHoldActive
                        ? hasHeldTutorResponse
                          ? t('app.learn.chat.hold.release')
                          : t('app.learn.chat.hold.active')
                        : t('app.learn.chat.hold.inactive')}
                    </span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </Card>

        {/* Sidebar */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          className="hidden lg:flex lg:flex-col w-72 h-full"
        >
          <ProfileSidebar
            level={profile?.proficiencyLevel || profile?.actflLevel || profile?.sklcLevel}
            goals={profile?.levelObjective}
            onClearChat={handleBackToList}
            onMinigameSelect={handleMinigameCommand}
            aiState={aiState}
          />
        </motion.div>
      </div>

      <Dialog
        open={Boolean(deleteDialogChatId)}
        onOpenChange={(open) => {
          if (!open && !isDeletingChat) {
            setDeleteDialogChatId(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{t('app.learn.sessions.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {pendingDeleteChat?.title
                ? `${pendingDeleteChat.title} — ${t('chat.deleteConfirm')}`
                : t('chat.deleteConfirm')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteDialogChatId(null)}
              disabled={isDeletingChat}
            >
              {t('logout.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmDeleteChat}
              loading={isDeletingChat}
            >
              {t('app.learn.sessions.deleteAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* FLASHCARDFLIP */}
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
      {loadingFlashcards && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 flex items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            <span>Generating flashcards...</span>
          </div>
        </div>
      )}
      {loadingWordMatch && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 flex items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            <span>Generating word match game...</span>
          </div>
        </div>
      )}
      {/* FLASHCARDFLIP */}
    </AnimatedPage>
  );
}
