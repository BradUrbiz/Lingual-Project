import api from './index';
import type { LearningLocale, PronunciationAttempt, PronunciationSession } from '@/types';
import { auth, storage } from '@/config/firebase';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

interface SpeechTokenResponse {
  success: boolean;
  token?: string;
  region?: string;
  expires_at?: string;
  error?: string;
}

interface CreateSessionResponse {
  success: boolean;
  sessionId?: string;
  session?: PronunciationSession;
  error?: string;
}

interface SaveAttemptResponse {
  success: boolean;
  attemptId?: string;
  attempt?: PronunciationAttempt;
  error?: string;
}

interface GetAttemptsResponse {
  success: boolean;
  attempts?: PronunciationAttempt[];
  error?: string;
}

export const getSpeechToken = async (): Promise<{ token: string; region: string; expiresAt: string }> => {
  const response = await api.post<SpeechTokenResponse>('/azure/speech-token');
  if (response.data.success && response.data.token && response.data.region && response.data.expires_at) {
    return {
      token: response.data.token,
      region: response.data.region,
      expiresAt: response.data.expires_at,
    };
  }
  throw new Error(response.data.error || 'Failed to get speech token');
};

export const createPronunciationSession = async (
  locale: LearningLocale,
  options?: { promptSetId?: string; objectiveId?: string }
): Promise<{ sessionId: string }> => {
  const response = await api.post<CreateSessionResponse>('/pronunciation/sessions', {
    locale,
    kind: 'practice',
    promptSetId: options?.promptSetId,
    objectiveId: options?.objectiveId,
  });
  if (response.data.success && response.data.sessionId) {
    return { sessionId: response.data.sessionId };
  }
  throw new Error(response.data.error || 'Failed to create session');
};

export const savePronunciationAttempt = async (
  payload: PronunciationAttempt
): Promise<{ attemptId: string }> => {
  const response = await api.post<SaveAttemptResponse>('/pronunciation/attempts', payload);
  if (response.data.success && response.data.attemptId) {
    return { attemptId: response.data.attemptId };
  }
  throw new Error(response.data.error || 'Failed to save attempt');
};

export const getPronunciationAttempts = async (sessionId: string): Promise<PronunciationAttempt[]> => {
  const response = await api.get<GetAttemptsResponse>(`/pronunciation/sessions/${sessionId}/attempts`);
  if (response.data.success && response.data.attempts) {
    return response.data.attempts;
  }
  throw new Error(response.data.error || 'Failed to load attempts');
};

export const uploadPronunciationAudio = async (payload: {
  sessionId: string;
  promptId: string;
  blob: Blob;
}): Promise<string> => {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User not authenticated');
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = `users/${user.uid}/pronunciation/${payload.sessionId}/${payload.promptId}-${timestamp}.webm`;
  const fileRef = ref(storage, filePath);
  const contentType = payload.blob.type || 'audio/webm';

  await uploadBytes(fileRef, payload.blob, { contentType });
  return getDownloadURL(fileRef);
};
