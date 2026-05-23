import type { LearningLocale } from '@/types';

export type PronunciationPrompt = {
  id: string;
  locale: LearningLocale;
  text: string;
};

export const PRONUNCIATION_PROMPTS: PronunciationPrompt[] = [
  { id: 'ko-hello', locale: 'ko-KR', text: '안녕하세요. 만나서 반갑습니다.' },
  { id: 'ko-order', locale: 'ko-KR', text: '아이스 아메리카노 한 잔 주세요.' },
  { id: 'ko-travel', locale: 'ko-KR', text: '지하철역은 어디에 있어요?' },
  { id: 'es-hello', locale: 'es-ES', text: 'Hola, mucho gusto. ¿Cómo estás?' },
  { id: 'es-order', locale: 'es-ES', text: 'Quisiera un café con leche, por favor.' },
  { id: 'es-travel', locale: 'es-ES', text: '¿Dónde está la estación de metro?' },
  { id: 'fr-hello', locale: 'fr-FR', text: 'Bonjour, enchanté. Comment ça va ?' },
  { id: 'fr-order', locale: 'fr-FR', text: "Je voudrais un café, s'il vous plaît." },
  { id: 'fr-travel', locale: 'fr-FR', text: 'Où se trouve la station de métro ?' },
  { id: 'ru-hello', locale: 'ru-RU', text: 'Здравствуйте, очень приятно познакомиться. Как дела?' },
  { id: 'ru-order', locale: 'ru-RU', text: 'Я хотел бы чашку кофе, пожалуйста.' },
  { id: 'ru-travel', locale: 'ru-RU', text: 'Где находится станция метро?' },
  { id: 'he-hello', locale: 'he-IL', text: 'שלום, נעים מאוד. מה שלומך?' },
  { id: 'he-order', locale: 'he-IL', text: 'אפשר קפה אחד, בבקשה?' },
  { id: 'he-travel', locale: 'he-IL', text: 'איפה תחנת הרכבת התחתית?' },
];
