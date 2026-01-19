import { useState, useCallback } from 'react';
import { sendMessage, sendVoiceMessage, resetChat } from '../api/chat';
import type { ChatMessage } from '../types';

interface UseChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  sendTextMessage: (text: string) => Promise<void>;
  sendAudioMessage: (audioBlob: Blob) => Promise<{ transcript: string; audioUrl?: string } | null>;
  clearChat: () => Promise<void>;
  clearError: () => void;
}

export function useChat(initialMessages: ChatMessage[] = []): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addMessage = useCallback((role: 'user' | 'assistant', content: string) => {
    const message: ChatMessage = {
      id: Date.now().toString(),
      role,
      content,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, message]);
    return message;
  }, []);

  const sendTextMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      setIsLoading(true);
      setError(null);

      addMessage('user', text);

      try {
        const response = await sendMessage(text);

        if (response.success && response.response) {
          addMessage('assistant', response.response);
        } else {
          throw new Error(response.error || 'Failed to send message');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to send message';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [addMessage]
  );

  const sendAudioMessage = useCallback(
    async (audioBlob: Blob) => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await sendVoiceMessage(audioBlob);

        if (response.success && response.transcript && response.response) {
          addMessage('user', response.transcript);
          addMessage('assistant', response.response);
          return {
            transcript: response.transcript,
            audioUrl: response.audioUrl,
          };
        } else {
          throw new Error(response.error || 'Failed to process voice message');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to send voice message';
        setError(message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [addMessage]
  );

  const clearChat = useCallback(async () => {
    try {
      await resetChat();
      setMessages([]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to clear chat';
      setError(message);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    messages,
    isLoading,
    error,
    sendTextMessage,
    sendAudioMessage,
    clearChat,
    clearError,
  };
}
