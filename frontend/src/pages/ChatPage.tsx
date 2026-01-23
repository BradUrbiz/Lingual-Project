import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { useChat } from '../hooks/useChat';
import { useRealtimeChat } from '../hooks/useRealtimeChat';
import { getUserProfile } from '../api/user';
import { Card, Alert, AlertDescription } from '@/components/ui';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { messageVariants } from '@/lib/animations';
import {
  ChatMessage,
  ChatInput,
  ProfileSidebar,
} from '../components/chat';
import type { UserProfile, ChatMessage as ChatMessageType } from '../types';

type Mode = 'text' | 'realtime';

export function ChatPage() {
  const { t } = useLanguage();
  const [mode, setMode] = useState<Mode>('realtime');
  const [inputValue, setInputValue] = useState('');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [aiState, setAiState] = useState<'speak' | 'notalk' | 'bruh'>('notalk');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const initialMessages: ChatMessageType[] = [
    {
      id: 'welcome',
      role: 'assistant',
      content: t('chat.welcome'),
      timestamp: new Date().toISOString(),
    },
  ];

  // Text chat hook
  const {
    messages: textMessages,
    isLoading,
    error: textError,
    sendTextMessage,
    clearChat,
  } = useChat(initialMessages);

  // Realtime chat hook
  const {
    isConnected,
    isListening,
    isSpeaking,
    messages: realtimeMessages,
    error: realtimeError,
    connect,
    disconnect,
  } = useRealtimeChat();

  // Current messages and error based on mode
  const messages = mode === 'realtime' ? realtimeMessages : textMessages;
  const error = mode === 'realtime' ? realtimeError : textError;

  useEffect(() => {
    loadProfile();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendText = async () => {
    if (!inputValue.trim() || isLoading) return;

    const message = inputValue;
    setInputValue('');
    setAiState('speak');

    await sendTextMessage(message);
    setAiState('notalk');
  };

  const handleClearChat = async () => {
    if (confirm('Are you sure you want to clear the chat history?')) {
      await clearChat();
    }
  };

  return (
    <AnimatedPage className="min-h-screen bg-background p-4">
      <div className="max-w-6xl mx-auto flex gap-6">
        {/* Main Chat Area */}
        <Card className="flex-1 flex flex-col h-[calc(100vh-2rem)] shadow-lg">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 border-b border-gray-100"
          >
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-xl font-bold text-accent">
                  {t('chat.title')}
                </h1>
                <p className="text-sm text-muted-foreground">{t('chat.subtitle')}</p>
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
              {messages.map((message) => (
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
              {error && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                >
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
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

                  {/* Voice Button */}
                  <button
                    type="button"
                    onClick={isConnected ? disconnect : connect}
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
                        : isListening
                        ? 'Listening...'
                        : 'Speak to chat'
                      : 'Press button to start'}
                  </p>
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
          className="hidden lg:block w-72"
        >
          <ProfileSidebar
            level={profile?.sklcLevel}
            goals={profile?.goals}
            onClearChat={handleClearChat}
            aiState={aiState}
          />
        </motion.div>
      </div>
    </AnimatedPage>
  );
}
