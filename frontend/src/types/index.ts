// User Types
export interface User {
  uid: string;
  email: string;
  name: string;
}

// Profile form data for GeneralPage
export type Gender = 'male' | 'female' | 'other' | 'prefer_not_to_say';
export type Rigor = 'light' | 'casual' | 'moderate' | 'serious' | 'intense';
export type FrequencyUnit = 'day' | 'week' | 'month';

export interface ProfileFormData {
  displayName: string;
  age: number | null;
  gender: Gender | null;
  rigor: Rigor | null;
  frequency: number | null;
  frequencyUnit: FrequencyUnit | null;
  levelObjective: string;
  learningLocale?: LearningLocale;
  avatarUrl?: string;
  contactEmail?: string;
  gradeLevel?: string;
  nativeLanguage?: string;
  location?: string;
  schoolName?: string;
}

export interface UserProfile {
  // Profile completion status
  profileCompleted: boolean;
  assessed: boolean;

  // Basic info
  displayName?: string;
  age?: number;
  gender?: Gender;
  avatarUrl?: string;
  contactEmail?: string;
  gradeLevel?: string;
  nativeLanguage?: string;
  location?: string;
  schoolName?: string;

  // Learning preferences
  rigor?: Rigor;
  frequency?: number;
  frequencyUnit?: FrequencyUnit;
  levelObjective?: string;
  learningLocale?: LearningLocale;

  // Assessment results
  globalStage?: number;
  sklcLevel?: string;
  sklcDescription?: string;
  domainBands?: {
    grammar: number;
    vocabulary: number;
    pragmatics: number;
    pronunciation: number;
  };
  selectedCategories?: string[];
}

// Assessment Types
export interface AssessmentItem {
  id: string;
  section: string;
  item_type: 'mcq_single' | 'text_short' | 'audio_read';
  order: number;
  domains: Record<string, number>;
  ui: {
    prompt_en: string;
    prompt_ko: string;
    context?: string;
    instructions_en?: string;
    instructions_ko?: string;
  };
  content: {
    options?: Array<{ id: string; text: string }>;
    word_list?: string[];
    sentences?: string[];
  };
  scoring: {
    response_type: string;
    method: string;
    rules?: Array<{
      condition: Record<string, string>;
      score: number;
    }>;
  };
}

export interface AssessmentState {
  items: AssessmentItem[];
  currentIndex: number;
  responses: Record<string, string>;
  totalItems: number;
}

export interface AssessmentResults {
  globalStage: number;
  domainBands: {
    grammar: number;
    vocabulary: number;
    pragmatics: number;
    pronunciation: number;
  };
  sklcLevel: string;
  sklcDescription: string;
}

// Chat Types
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

// Raw message from API (no id)
export interface RawChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message?: string;
}

export interface ChatSessionDetail {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: RawChatMessage[];
}

export interface ChatResponse {
  success: boolean;
  response?: string;
  error?: string;
}

// Pronunciation Types
export type PronunciationScoreSet = {
  accuracy?: number;
  fluency?: number;
  completeness?: number;
  prosody?: number | null;
};

export type PronunciationPhoneme = {
  phoneme: string;
  accuracy?: number;
};

export type PronunciationWord = {
  word: string;
  accuracy?: number;
  errorType?: string;
  phonemes?: PronunciationPhoneme[];
};

export interface PronunciationAttempt {
  id?: string;
  sessionId?: string;
  promptId: string;
  objectiveId?: string;
  referenceText: string;
  recognizedText: string;
  locale: LearningLocale;
  scores: PronunciationScoreSet;
  words: PronunciationWord[];
  audioUrl?: string;
  createdAt?: string;
  rawResult?: unknown;
}

export interface PronunciationSession {
  id: string;
  locale: LearningLocale;
  createdAt: string;
  updatedAt: string;
}

// API Response Types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// Language Type
export type Language = 'en' | 'ko';
export type LearningLocale = 'ko-KR' | 'es-ES' | 'fr-FR';
