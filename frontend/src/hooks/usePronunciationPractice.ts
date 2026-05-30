import { useCallback, useRef, useState } from 'react';
import { getSpeechToken } from '@/api/pronunciation';
import type * as SpeechSDKTypes from 'microsoft-cognitiveservices-speech-sdk';
import type {
  LearningLocale,
  PronunciationAttempt,
  PronunciationScoreSet,
  PronunciationWord,
} from '@/types';

type PracticeStatus = 'idle' | 'listening' | 'processing';
type AssessOptions = {
  debugPhonemePayload?: boolean;
};

const TOKEN_REFRESH_BUFFER_MS = 60_000;
type SpeechSdkModule = typeof SpeechSDKTypes;
type RecognitionEvent = {
  result?: {
    text?: string;
    reason?: unknown;
  };
};
type CancellationEvent = {
  reason?: unknown;
  errorDetails?: unknown;
};

let speechSdkModule: SpeechSdkModule | null = null;

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

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const getNBestPhonemeCandidates = (entry: Record<string, unknown>): Record<string, unknown>[] => {
  const topLevel = entry['NBestPhonemes'] ?? entry['nBestPhonemes'];
  if (Array.isArray(topLevel) && topLevel.length) {
    return topLevel
      .map((candidate) => asRecord(candidate))
      .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));
  }

  const pronunciationAssessment = asRecord(
    entry['PronunciationAssessment'] ?? entry['pronunciationAssessment']
  );
  if (!pronunciationAssessment) return [];

  const nested = pronunciationAssessment['NBestPhonemes'] ?? pronunciationAssessment['nBestPhonemes'];
  if (!Array.isArray(nested) || !nested.length) return [];

  return nested
    .map((candidate) => asRecord(candidate))
    .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));
};

const getNBestPhonemeLabel = (entry: Record<string, unknown>): string => {
  const [firstNBest] = getNBestPhonemeCandidates(entry);
  if (!firstNBest) return '';

  return pickFirstString(
    firstNBest['Phoneme'],
    firstNBest['phoneme'],
    firstNBest['Symbol'],
    firstNBest['symbol']
  );
};

const getPhonemeLabel = (entry: Record<string, unknown>): string => {
  const nestedNBestLabel = getNBestPhonemeLabel(entry);
  if (nestedNBestLabel) return nestedNBestLabel;

  return pickFirstString(
    entry['Phoneme'],
    entry['phoneme'],
    entry['Syllable'],
    entry['syllable'],
    entry['Grapheme'],
    entry['grapheme'],
    entry['Symbol'],
    entry['symbol']
  );
};

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
      const syllableLabels = parsedSyllables.flatMap((entry) => (entry.phoneme ? [entry.phoneme] : []));
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

const getNBestPhonemeLabels = (entry: Record<string, unknown>): string[] => {
  return getNBestPhonemeCandidates(entry)
    .flatMap((candidate) => {
      const label = pickFirstString(
        candidate['Phoneme'],
        candidate['phoneme'],
        candidate['Symbol'],
        candidate['symbol']
      );
      return label ? [label] : [];
    });
};

const getPhonemeAccuracy = (entry: Record<string, unknown>): number | undefined => {
  const pronunciationAssessment = asRecord(
    entry['PronunciationAssessment'] ?? entry['pronunciationAssessment']
  );
  const accuracy = pronunciationAssessment?.['AccuracyScore'];
  return typeof accuracy === 'number' ? accuracy : undefined;
};

const logRawWordPhonemePayload = (
  wordsRaw: Array<Record<string, unknown>>,
  locale: LearningLocale,
  promptId: string
) => {
  console.groupCollapsed(`[Pronunciation Debug] ${locale} ${promptId} raw Words/Phonemes`);
  wordsRaw.forEach((word, wordIndex) => {
    const wordText = pickFirstString(word['Word'], word['word']) || `word-${wordIndex + 1}`;
    const rawPhonemes = Array.isArray(word['Phonemes']) ? word['Phonemes'] : [];

    const phonemeRows = rawPhonemes.map((entry, phonemeIndex) => {
      const phoneme = asRecord(entry) || {};
      return {
        index: phonemeIndex,
        topLevelLabel: pickFirstString(
          phoneme['Phoneme'],
          phoneme['phoneme'],
          phoneme['Symbol'],
          phoneme['symbol'],
          phoneme['Syllable'],
          phoneme['syllable'],
          phoneme['Grapheme'],
          phoneme['grapheme']
        ),
        nBestLabels: getNBestPhonemeLabels(phoneme),
        accuracy: getPhonemeAccuracy(phoneme),
      };
    });

    console.log({
      wordIndex,
      word: wordText,
      phonemeCount: phonemeRows.length,
      phonemes: phonemeRows,
    });
  });
  console.groupEnd();
};

const formatNoMatchReason = (reason: number | string | undefined) => {
  if (reason === undefined || reason === null) return '';
  if (typeof reason === 'string') return reason;
  const noMatchReasonMap = speechSdkModule?.NoMatchReason as Record<number | string, string> | undefined;
  return noMatchReasonMap?.[reason] ?? `${reason}`;
};

const formatCancellationReason = (reason: number | string | undefined) => {
  if (reason === undefined || reason === null) return '';
  if (typeof reason === 'string') return reason;
  const cancellationReasonMap = speechSdkModule?.CancellationReason as Record<number | string, string> | undefined;
  return cancellationReasonMap?.[reason] ?? `${reason}`;
};

const loadSpeechSdk = async (): Promise<SpeechSdkModule> => {
  if (speechSdkModule) return speechSdkModule;
  try {
    speechSdkModule = await import('microsoft-cognitiveservices-speech-sdk') as SpeechSdkModule;
    return speechSdkModule;
  } catch {
    throw new Error(
      'Speech SDK is not available in this environment. Install microsoft-cognitiveservices-speech-sdk to enable pronunciation practice.'
    );
  }
};

const getMicrophoneStream = async (): Promise<MediaStream> => {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access is not supported in this browser.');
  }
  return navigator.mediaDevices.getUserMedia({ audio: true });
};

const createAudioConfigFromStream = (
  stream: MediaStream,
  SpeechSDK: SpeechSdkModule
): SpeechSDKTypes.AudioConfig => {
  const maybeFromStream = (SpeechSDK.AudioConfig as {
    fromStreamInput?: (input: MediaStream) => SpeechSDKTypes.AudioConfig;
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
      promptId: string,
      options: AssessOptions = {}
    ): Promise<{ attempt: PronunciationAttempt; audioBlob: Blob | null }> => {
      setError(null);
      setStatus('listening');

      const [SpeechSDK, { token, region }] = await Promise.all([
        loadSpeechSdk(),
        ensureToken(),
      ]);
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

      let audioConfig: SpeechSDKTypes.AudioConfig;
      let micStream: MediaStream | null = null;
      let mediaRecorder: MediaRecorder | null = null;
      let audioBlobPromise: Promise<Blob | null> | null = null;
      try {
        micStream = await getMicrophoneStream();
        audioConfig = createAudioConfigFromStream(micStream, SpeechSDK);

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
      const localeSupportsProsody = (locale as string) === 'en-US';
      if (localeSupportsProsody && typeof maybeEnableProsody === 'function') {
        maybeEnableProsody.call(pronunciationConfig);
      }
      pronunciationConfig.applyTo(recognizer);

      // Helpful debug hooks for NoMatch issues
      recognizer.recognizing = (_sender: unknown, event: RecognitionEvent) => {
        if (event?.result?.text) {
          console.log('Recognizing:', event.result.text);
        }
      };
      recognizer.recognized = (_sender: unknown, event: RecognitionEvent) => {
        console.log('Recognized:', event?.result?.text, event?.result?.reason);
      };
      recognizer.canceled = (_sender: unknown, event: CancellationEvent) => {
        console.error('Recognition canceled:', event?.reason, event?.errorDetails);
      };

      try {
        const result = await new Promise<SpeechSDKTypes.SpeechRecognitionResult>((resolve, reject) => {
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
        const wordsRaw = (nBest?.Words || []) as Array<Record<string, unknown>>;
        if (options.debugPhonemePayload) {
          logRawWordPhonemePayload(wordsRaw, locale, promptId);
        }
        const words = parseWords(wordsRaw);
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
