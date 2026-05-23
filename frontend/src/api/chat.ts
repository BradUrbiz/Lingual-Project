import api from './index';
import type { ChatSession, ChatSessionDetail, LanguageMixLevel } from '../types';

interface GetChatsResponse {
  success: boolean;
  chats: ChatSession[];
  error?: string;
}

interface CreateChatResponse {
  success: boolean;
  chatId: string;
  title: string;
  language_mix_level?: LanguageMixLevel;
  languageMixLevel?: LanguageMixLevel;
  error?: string;
}

interface GetChatResponse {
  success: boolean;
  chat: ChatSessionDetail & {
    language_mix_level?: LanguageMixLevel;
    languageMixLevel?: LanguageMixLevel;
  };
  error?: string;
}

interface UpdateChatSettingsResponse {
  success: boolean;
  chat: ChatSessionDetail & {
    language_mix_level?: LanguageMixLevel;
    languageMixLevel?: LanguageMixLevel;
  };
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

interface SendMessageOptions {
  assignmentId?: string;
  practiceSessionId?: string;
  uiLanguage?: 'en' | 'ko';
}

interface SaveMessageResponse {
  success: boolean;
  message: { role: string; content: string; timestamp: string; sort_order?: number };
  title?: string | null;
  error?: string;
}

interface SaveMessageOptions {
  timestamp?: string;
  sortOrder?: number;
}

function normalizeLanguageMixLevel(
  value?: LanguageMixLevel | string | null
): LanguageMixLevel | undefined {
  if (
    value === 'english_first' ||
    value === 'english_led' ||
    value === 'balanced' ||
    value === 'target_led' ||
    value === 'target_only'
  ) {
    return value;
  }
  return undefined;
}

function mapChatSession(
  session: ChatSession & { language_mix_level?: LanguageMixLevel; languageMixLevel?: LanguageMixLevel }
): ChatSession {
  return {
    ...session,
    languageMixLevel: normalizeLanguageMixLevel(
      session.languageMixLevel || session.language_mix_level
    ),
  };
}

function mapChatSessionDetail(
  session: ChatSessionDetail & { language_mix_level?: LanguageMixLevel; languageMixLevel?: LanguageMixLevel }
): ChatSessionDetail {
  return {
    ...session,
    languageMixLevel: normalizeLanguageMixLevel(
      session.languageMixLevel || session.language_mix_level
    ),
  };
}

export const getChatSessions = async (): Promise<ChatSession[]> => {
  const response = await api.get<GetChatsResponse>('/chats');
  if (response.data.success) {
    return response.data.chats.map(mapChatSession);
  }
  throw new Error(response.data.error || 'Failed to get chat sessions');
};

export const createChatSession = async (
  title?: string
): Promise<{ chatId: string; title: string; languageMixLevel?: LanguageMixLevel }> => {
  const response = await api.post<CreateChatResponse>('/chats', { title });
  if (response.data.success) {
    return {
      chatId: response.data.chatId,
      title: response.data.title,
      languageMixLevel: normalizeLanguageMixLevel(
        response.data.languageMixLevel || response.data.language_mix_level
      ),
    };
  }
  throw new Error(response.data.error || 'Failed to create chat session');
};

export const getChatSession = async (chatId: string): Promise<ChatSessionDetail> => {
  const response = await api.get<GetChatResponse>(`/chats/${chatId}`);
  if (response.data.success) {
    return mapChatSessionDetail(response.data.chat);
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

export const updateChatSettings = async (
  chatId: string,
  settings: { languageMixLevel: LanguageMixLevel }
): Promise<ChatSessionDetail> => {
  const response = await api.patch<UpdateChatSettingsResponse>(`/chats/${chatId}/settings`, settings);
  if (response.data.success) {
    return mapChatSessionDetail(response.data.chat);
  }
  throw new Error(response.data.error || 'Failed to update chat settings');
};

export const sendChatMessage = async (
  chatId: string,
  message: string,
  options?: SendMessageOptions,
): Promise<SendMessageResponse> => {
  const response = await api.post<SendMessageResponse>(`/chats/${chatId}/messages`, {
    message,
    ...(options?.assignmentId ? { assignmentId: options.assignmentId } : {}),
    ...(options?.practiceSessionId ? { practiceSessionId: options.practiceSessionId } : {}),
    ...(options?.uiLanguage ? { uiLanguage: options.uiLanguage } : {}),
  });
  if (response.data.success) {
    return response.data;
  }
  throw new Error(response.data.error || 'Failed to send message');
};

// Save a single message to chat (for realtime mode - no AI response)
export const saveMessageToChat = async (
  chatId: string,
  role: 'user' | 'assistant',
  content: string,
  options?: SaveMessageOptions
): Promise<SaveMessageResponse> => {
  const response = await api.post<SaveMessageResponse>(
    `/chats/${chatId}/messages/save`,
    {
      role,
      content,
      ...(options?.timestamp ? { timestamp: options.timestamp } : {}),
      ...(options?.sortOrder !== undefined ? { sortOrder: options.sortOrder } : {}),
    }
  );
  if (response.data.success) {
    return response.data;
  }
  if (!response.data.success) {
    throw new Error(response.data.error || 'Failed to save message');
  }
  throw new Error('Failed to save message');
};
