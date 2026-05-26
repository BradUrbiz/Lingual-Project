import api from './index';

export interface SentenceItem {
  sentence: string;
  options: string[];
  answer: string;
}

export async function generateSentenceBuilderItems(chatId: string): Promise<SentenceItem[]> {
  const response = await api.post('/minigames/sentencebuilder', { chatId });
  return response.data.items;
}
