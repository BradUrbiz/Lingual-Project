import { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useChat } from '../hooks/useChat';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { getUserProfile } from '../api/user';
import { LoadingSpinner } from '../components/common';
import {
  ChatMessage,
  ChatInput,
  VoiceRecorder,
  ModeToggle,
  ProfileSidebar,
} from '../components/chat';
import type { UserProfile, ChatMessage as ChatMessageType } from '../types';

type Mode = 'text' | 'voice';

export function ChatPage() {
  const { t } = useLanguage();
  const [mode, setMode] = useState<Mode>('text');
  const [inputValue, setInputValue] = useState('');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [aiState, setAiState] = useState<'speak' | 'notalk' | 'bruh'>('notalk');
  const [audioElement] = useState(() => new Audio());

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const initialMessages: ChatMessageType[] = [
    {
      id: 'welcome',
      role: 'assistant',
      content: t('chat.welcome'),
      timestamp: new Date().toISOString(),
    },
  ];

  const {
    messages,
    isLoading,
    error,
    sendTextMessage,
    sendAudioMessage,
    clearChat,
  } = useChat(initialMessages);

  const {
    isRecording,
    audioBlob,
    startRecording,
    stopRecording,
    clearAudio,
  } = useVoiceRecorder();

  useEffect(() => {
    loadProfile();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (audioBlob && !isRecording) {
      handleSendVoiceMessage();
    }
  }, [audioBlob, isRecording]);

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

  const handleToggleRecording = async () => {
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  };

  const handleSendVoiceMessage = async () => {
    if (!audioBlob) return;

    setAiState('speak');
    const result = await sendAudioMessage(audioBlob);

    if (result?.audioUrl) {
      audioElement.src = result.audioUrl;
      audioElement.play();
    }

    clearAudio();
    setAiState('notalk');
  };

  const handleClearChat = async () => {
    if (confirm('Are you sure you want to clear the chat history?')) {
      await clearChat();
    }
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-6xl mx-auto flex gap-6">
        {/* Main Chat Area */}
        <div className="flex-1 bg-card rounded-2xl shadow-lg flex flex-col h-[calc(100vh-2rem)]">
          {/* Header */}
          <div className="p-4 border-b border-gray-100">
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-xl font-bold text-purple-accent">
                  {t('chat.title')}
                </h1>
                <p className="text-sm text-text-secondary">{t('chat.subtitle')}</p>
              </div>
              <ModeToggle mode={mode} onModeChange={setMode} />
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                role={message.role}
                content={message.content}
              />
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 px-4 py-3 rounded-2xl rounded-bl-md">
                  <LoadingSpinner size="sm" />
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-4 border-t border-gray-100">
            {mode === 'text' ? (
              <ChatInput
                value={inputValue}
                onChange={setInputValue}
                onSend={handleSendText}
                disabled={isLoading}
                placeholder={t('chat.placeholder')}
              />
            ) : (
              <div className="flex justify-center">
                <VoiceRecorder
                  isRecording={isRecording}
                  onToggleRecording={handleToggleRecording}
                  disabled={isLoading}
                />
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="hidden lg:block w-72">
          <ProfileSidebar
            level={profile?.sklcLevel}
            goals={profile?.goals}
            onClearChat={handleClearChat}
            aiState={aiState}
          />
        </div>
      </div>
    </div>
  );
}
