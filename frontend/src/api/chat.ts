import api from './index';
import type { ChatSession, ChatSessionDetail } from '../types';

interface GetChatsResponse {
  success: boolean;
  chats: ChatSession[];
  error?: string;
}

interface CreateChatResponse {
  success: boolean;
  chatId: string;
  title: string;
  error?: string;
}

interface GetChatResponse {
  success: boolean;
  chat: ChatSessionDetail;
  error?: string;
}

interface SendMessageResponse {
  success: boolean;
  response: string;
  userMessage: { role: string; content: string; timestamp: string };
  assistantMessage: { role: string; content: string; timestamp: string };
  title?: string | null;
  error?: string;
}

interface SaveMessageResponse {
  success: boolean;
  message: { role: string; content: string; timestamp: string };
  title?: string | null;
  error?: string;
}

export const getChatSessions = async (): Promise<ChatSession[]> => {
  const response = await api.get<GetChatsResponse>('/chats');
  if (response.data.success) {
    return response.data.chats;
  }
  throw new Error(response.data.error || 'Failed to get chat sessions');
};

export const createChatSession = async (title?: string): Promise<{ chatId: string; title: string }> => {
  const response = await api.post<CreateChatResponse>('/chats', { title });
  if (response.data.success) {
    return { chatId: response.data.chatId, title: response.data.title };
  }
  throw new Error(response.data.error || 'Failed to create chat session');
};

export const getChatSession = async (chatId: string): Promise<ChatSessionDetail> => {
  const response = await api.get<GetChatResponse>(`/chats/${chatId}`);
  if (response.data.success) {
    return response.data.chat;
  }
  throw new Error(response.data.error || 'Failed to get chat session');
};

export const deleteChatSession = async (chatId: string): Promise<void> => {
  const response = await api.delete<{ success: boolean; error?: string }>(`/chats/${chatId}`);
  if (!response.data.success) {
    throw new Error(response.data.error || 'Failed to delete chat session');
  }
};

export const updateChatTitle = async (chatId: string, title: string): Promise<void> => {
  const response = await api.put<{ success: boolean; error?: string }>(`/chats/${chatId}/title`, { title });
  if (!response.data.success) {
    throw new Error(response.data.error || 'Failed to update chat title');
  }
};

export const sendChatMessage = async (chatId: string, message: string): Promise<SendMessageResponse> => {
  const response = await api.post<SendMessageResponse>(`/chats/${chatId}/messages`, { message });
  if (response.data.success) {
    return response.data;
  }
  throw new Error(response.data.error || 'Failed to send message');
};

// Save a single message to chat (for realtime mode - no AI response)
export const saveMessageToChat = async (
  chatId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<SaveMessageResponse> => {
  const response = await api.post<SaveMessageResponse>(
    `/chats/${chatId}/messages/save`,
    { role, content }
  );
  if (response.data.success) {
    return response.data;
  }
  if (!response.data.success) {
    throw new Error(response.data.error || 'Failed to save message');
  }
  throw new Error('Failed to save message');
};
