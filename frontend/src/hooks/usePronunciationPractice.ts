import { useCallback, useRef, useState } from 'react';
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import { getSpeechToken } from '@/api/pronunciation';
import type {
  LearningLocale,
  PronunciationAttempt,
  PronunciationScoreSet,
  PronunciationWord,
} from '@/types';

type PracticeStatus = 'idle' | 'listening' | 'processing';

const TOKEN_REFRESH_BUFFER_MS = 60_000;

const parseScores = (assessment?: Record<string, unknown>): PronunciationScoreSet => ({
  accuracy: typeof assessment?.AccuracyScore === 'number' ? assessment.AccuracyScore : undefined,
  fluency: typeof assessment?.FluencyScore === 'number' ? assessment.FluencyScore : undefined,
  completeness: typeof assessment?.CompletenessScore === 'number' ? assessment.CompletenessScore : undefined,
  prosody: typeof assessment?.ProsodyScore === 'number' ? assessment.ProsodyScore : null,
});

const readString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const pickFirstString = (...values: unknown[]): string => {
  for (const value of values) {
    const text = readString(value);
    if (text) return text;
  }
  return '';
};

const getPhonemeLabel = (entry: Record<string, unknown>): string =>
  pickFirstString(
    entry['Phoneme'],
    entry['phoneme'],
    entry['Syllable'],
    entry['syllable'],
    entry['Grapheme'],
    entry['grapheme'],
    entry['Symbol'],
    entry['symbol']
  );

const spreadLabelsToLength = (labels: string[], targetLength: number): string[] => {
  if (!labels.length || targetLength <= 0) return [];
  if (labels.length === targetLength) return [...labels];
  return Array.from({ length: targetLength }, (_unused, index) => {
    const labelIndex = Math.floor((index * labels.length) / targetLength);
    return labels[labelIndex] ?? labels[labels.length - 1] ?? '';
  });
};

const parseWords = (words: Array<Record<string, unknown>> = []): PronunciationWord[] =>
  words.map((word) => {
    const assessment = (word.PronunciationAssessment || {}) as Record<string, unknown>;
    const phonemesRaw = (word.Phonemes || []) as Array<Record<string, unknown>>;
    const syllablesRaw = (word.Syllables || []) as Array<Record<string, unknown>>;
    const wordText = typeof word.Word === 'string' ? word.Word : '';
    const graphemes = Array.from(wordText);

    const parsedPhonemes = phonemesRaw.map((phoneme) => {
      const phonemeAssessment = (phoneme.PronunciationAssessment || {}) as Record<string, unknown>;
      return {
        phoneme: getPhonemeLabel(phoneme),
        accuracy:
          typeof phonemeAssessment.AccuracyScore === 'number'
            ? phonemeAssessment.AccuracyScore
            : undefined,
      };
    });

    const parsedSyllables = syllablesRaw.map((syllable) => {
      const syllableAssessment = (syllable.PronunciationAssessment || {}) as Record<string, unknown>;
      return {
        phoneme: getPhonemeLabel(syllable),
        accuracy:
          typeof syllableAssessment.AccuracyScore === 'number'
            ? syllableAssessment.AccuracyScore
            : undefined,
      };
    });

    const hasPhonemeLabels = parsedPhonemes.some((entry) => entry.phoneme);
    let phonemes = parsedPhonemes;

    if (!hasPhonemeLabels && parsedSyllables.length) {
      phonemes = parsedSyllables;
    } else if (parsedSyllables.length && parsedSyllables.length === parsedPhonemes.length) {
      phonemes = parsedPhonemes.map((entry, index) => ({
        ...entry,
        phoneme: entry.phoneme || parsedSyllables[index]?.phoneme || '',
      }));
    }

    const needsFallbackLabels = phonemes.length && phonemes.some((entry) => !entry.phoneme);
    if (needsFallbackLabels) {
      const syllableLabels = parsedSyllables.map((entry) => entry.phoneme).filter(Boolean);
      const fallbackSource = syllableLabels.length ? syllableLabels : graphemes;
      if (fallbackSource.length) {
        const fallbackLabels = spreadLabelsToLength(fallbackSource, phonemes.length);
        phonemes = phonemes.map((entry, index) => ({
          ...entry,
          phoneme: entry.phoneme || fallbackLabels[index] || '',
        }));
      }
    }

    return {
      word: wordText,
      accuracy: typeof assessment.AccuracyScore === 'number' ? assessment.AccuracyScore : undefined,
      errorType: typeof word.ErrorType === 'string' ? word.ErrorType : undefined,
      phonemes,
    };
  });

const formatNoMatchReason = (reason: number | string | undefined) => {
  if (reason === undefined || reason === null) return '';
  if (typeof reason === 'string') return reason;
  return SpeechSDK.NoMatchReason[reason] ?? `${reason}`;
};

const formatCancellationReason = (reason: number | string | undefined) => {
  if (reason === undefined || reason === null) return '';
  if (typeof reason === 'string') return reason;
  return SpeechSDK.CancellationReason[reason] ?? `${reason}`;
};

const getMicrophoneStream = async (): Promise<MediaStream> => {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access is not supported in this browser.');
  }
  return navigator.mediaDevices.getUserMedia({ audio: true });
};

const createAudioConfigFromStream = (stream: MediaStream): SpeechSDK.AudioConfig => {
  const maybeFromStream = (SpeechSDK.AudioConfig as unknown as {
    fromStreamInput?: (input: MediaStream) => SpeechSDK.AudioConfig;
  }).fromStreamInput;
  if (typeof maybeFromStream === 'function') {
    return maybeFromStream(stream);
  }
  return SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
};

export function usePronunciationPractice() {
  const [status, setStatus] = useState<PracticeStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<{ token: string; region: string; expiresAt: string } | null>(null);

  const ensureToken = useCallback(async () => {
    const cached = tokenRef.current;
    if (cached) {
      const expiresAtMs = new Date(cached.expiresAt).getTime();
      if (!Number.isNaN(expiresAtMs) && expiresAtMs - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
        return cached;
      }
    }
    const fresh = await getSpeechToken();
    tokenRef.current = { token: fresh.token, region: fresh.region, expiresAt: fresh.expiresAt };
    return tokenRef.current;
  }, []);

  const assess = useCallback(
    async (
      referenceText: string,
      locale: LearningLocale,
      promptId: string
    ): Promise<{ attempt: PronunciationAttempt; audioBlob: Blob | null }> => {
      setError(null);
      setStatus('listening');

      const { token, region } = await ensureToken();
      const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region);
      speechConfig.speechRecognitionLanguage = locale;
      speechConfig.outputFormat = SpeechSDK.OutputFormat.Detailed;
      speechConfig.setProperty(
        SpeechSDK.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
        '10000'
      );
      speechConfig.setProperty(
        SpeechSDK.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
        '2000'
      );

      let audioConfig: SpeechSDK.AudioConfig;
      let micStream: MediaStream | null = null;
      let mediaRecorder: MediaRecorder | null = null;
      let audioBlobPromise: Promise<Blob | null> | null = null;
      try {
        micStream = await getMicrophoneStream();
        audioConfig = createAudioConfigFromStream(micStream);

        if (typeof MediaRecorder !== 'undefined' && micStream) {
          const preferredMime =
            MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
              ? 'audio/webm;codecs=opus'
              : MediaRecorder.isTypeSupported('audio/webm')
                ? 'audio/webm'
                : '';
          const chunks: BlobPart[] = [];
          mediaRecorder = new MediaRecorder(
            micStream,
            preferredMime ? { mimeType: preferredMime } : undefined
          );
          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              chunks.push(event.data);
            }
          };
          audioBlobPromise = new Promise((resolve) => {
            mediaRecorder!.onstop = () => {
              if (!chunks.length) {
                resolve(null);
                return;
              }
              const blob = new Blob(chunks, { type: preferredMime || 'audio/webm' });
              resolve(blob);
            };
          });
          mediaRecorder.start();
        }
      } catch (err) {
        console.error('Microphone permission error:', err);
        throw new Error('Microphone permission is required for pronunciation practice.');
      }
      const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

      const pronunciationConfig = new SpeechSDK.PronunciationAssessmentConfig(
        referenceText,
        SpeechSDK.PronunciationAssessmentGradingSystem.HundredMark,
        SpeechSDK.PronunciationAssessmentGranularity.Phoneme,
        true
      );
      // Prosody assessment is only supported for certain locales (e.g. en-US),
      // and some SDK builds don't expose the helper method.
      const maybeEnableProsody = (pronunciationConfig as unknown as { enableProsodyAssessment?: () => void })
        .enableProsodyAssessment;
      if (locale === 'en-US' && typeof maybeEnableProsody === 'function') {
        maybeEnableProsody.call(pronunciationConfig);
      }
      pronunciationConfig.applyTo(recognizer);

      // Helpful debug hooks for NoMatch issues
      recognizer.recognizing = (_sender, event) => {
        if (event?.result?.text) {
          console.log('Recognizing:', event.result.text);
        }
      };
      recognizer.recognized = (_sender, event) => {
        console.log('Recognized:', event?.result?.text, event?.result?.reason);
      };
      recognizer.canceled = (_sender, event) => {
        console.error('Recognition canceled:', event?.reason, event?.errorDetails);
      };

      try {
        const result: SpeechSDK.SpeechRecognitionResult = await new Promise((resolve, reject) => {
          recognizer.recognizeOnceAsync(resolve, reject);
        });

        if (result.reason === SpeechSDK.ResultReason.NoMatch) {
          const details = SpeechSDK.NoMatchDetails.fromResult(result);
          const reason = formatNoMatchReason(details?.reason);
          const suffix = reason ? ` (${reason})` : '';
          throw new Error(`No recognizable audio detected${suffix}. Try speaking a bit longer and closer to the mic.`);
        }

        if (result.reason === SpeechSDK.ResultReason.Canceled) {
          const details = SpeechSDK.CancellationDetails.fromResult(result);
          const reason = formatCancellationReason(details?.reason);
          const errorDetails = details?.errorDetails ? ` - ${details.errorDetails}` : '';
          throw new Error(`Recognition canceled${reason ? ` (${reason})` : ''}${errorDetails}`);
        }

        if (result.reason !== SpeechSDK.ResultReason.RecognizedSpeech) {
          throw new Error('No speech recognized. Please try again.');
        }

        setStatus('processing');

        const jsonString = result.properties.getProperty(
          SpeechSDK.PropertyId.SpeechServiceResponse_JsonResult
        );
        const rawResult = jsonString ? JSON.parse(jsonString) : null;
        const nBest = rawResult?.NBest?.[0] ?? rawResult ?? {};
        const assessment = nBest?.PronunciationAssessment ?? {};
        const words = parseWords(nBest?.Words || []);
        const recognizedText =
          typeof nBest?.Display === 'string'
            ? nBest.Display
            : typeof result.text === 'string'
              ? result.text
              : '';

        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }

        const audioBlob = audioBlobPromise ? await audioBlobPromise : null;

        const attempt: PronunciationAttempt = {
          promptId,
          referenceText,
          recognizedText,
          locale,
          scores: parseScores(assessment),
          words,
          rawResult,
        };

        setStatus('idle');
        return { attempt, audioBlob };
      } catch (err) {
        console.error('Pronunciation assessment failed:', err);
        setStatus('idle');
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Pronunciation assessment failed.';
        setError(message);
        throw err;
      } finally {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
        recognizer.close();
        if (typeof audioConfig.close === 'function') {
          audioConfig.close();
        }
        if (micStream) {
          micStream.getTracks().forEach((track) => track.stop());
        }
      }
    },
    [ensureToken]
  );

  return {
    status,
    error,
    assess,
  };
}
