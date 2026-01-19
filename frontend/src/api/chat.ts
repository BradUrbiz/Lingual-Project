import api from './index';
import type { ChatResponse, VoiceChatResponse } from '../types';

export const sendMessage = async (message: string): Promise<ChatResponse> => {
  const response = await api.post<ChatResponse>('/chat', { message });
  return response.data;
};

export const sendVoiceMessage = async (audioBlob: Blob): Promise<VoiceChatResponse> => {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');

  const response = await api.post<VoiceChatResponse>('/chat/voice', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};

export const resetChat = async (): Promise<void> => {
  await api.post('/chat/reset');
};

export const getAudioUrl = (filename: string): string => {
  return `/api/audio/${filename}`;
};
