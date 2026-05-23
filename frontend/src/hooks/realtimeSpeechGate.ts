export type RealtimeInputTurnMetrics = {
  peakRms: number;
  durationMs: number;
  hadMicSignal: boolean;
  assistantPromptedUser: boolean;
};

const DIRECT_ADDRESS_TERMS = [
  'lingu',
  'ling',
  'lingual',
  'tutor',
  'teacher',
  'assistant',
  'ai',
] as const;

const GREETING_CUES = new Set([
  'hi',
  'hello',
  'hey',
  'hola',
  'buenas',
  'bonjour',
  'salut',
  'coucou',
  '안녕',
  '안녕하세요',
  '여보세요',
  'привет',
  'здравствуйте',
  'سلام',
  'שלום',
  'היי',
]);

const SHORT_ACKNOWLEDGEMENTS = new Set([
  'uh',
  'um',
  'hmm',
  'mm',
  'mhm',
  'huh',
  'yeah',
  'yes',
  'no',
  'nope',
  'ok',
  'okay',
  'sure',
  'right',
  'thanks',
  'thank you',
  '네',
  '응',
  '어',
  '음',
  '그래',
  '맞아',
  '아니',
  'sí',
  'si',
  'oui',
  'non',
  'да',
  'нет',
  'כן',
  'לא',
]);

const LEARNER_INTENT_PREFIXES = [
  'i want',
  "i'd like",
  'i would like',
  'i need',
  'i am trying',
  "i'm trying",
  'let us',
  "let's",
  'maybe we can',
  'can we practice',
  'i want to practice',
  'i want to order',
  'i want food',
  'quiero',
  'me gustaria',
  'me gustaría',
  'vamos a',
  'je veux',
  "j'aimerais",
  'on peut',
  'я хочу',
  'давай',
  'אני רוצה',
  'בוא',
  '저는',
  '제가',
  '하고 싶어요',
  '연습하고 싶어요',
];

const QUESTION_STARTERS = new Set([
  'what',
  'why',
  'how',
  'when',
  'where',
  'who',
  'which',
  'can',
  'could',
  'would',
  'will',
  'do',
  'does',
  'did',
  'is',
  'are',
  'am',
  'please',
  'help',
  'que',
  'qué',
  'como',
  'cómo',
  'porque',
  'por',
  'donde',
  'dónde',
  'cuando',
  'cuándo',
  'peux',
  'pouvez',
  'pourquoi',
  'comment',
  'où',
  'quand',
  'можешь',
  'как',
  'почему',
  'где',
  'когда',
  'למה',
  'איך',
  'איפה',
  'מתי',
  'אפשר',
  '왜',
  '어떻게',
  '언제',
  '어디',
  '도와줘',
  '해주세요',
]);

const DIRECTED_SPEECH_RMS_THRESHOLD = 0.012;

function normalizeTranscript(transcript: string): string {
  return transcript
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function tokenizeTranscript(transcript: string): string[] {
  return transcript.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu) ?? [];
}

function hasDirectAddressCue(normalizedTranscript: string): boolean {
  return DIRECT_ADDRESS_TERMS.some((term) => normalizedTranscript.includes(term));
}

function hasGreetingCue(normalizedTranscript: string, tokens: string[]): boolean {
  if (GREETING_CUES.has(normalizedTranscript)) {
    return true;
  }

  return tokens.length > 0
    && tokens.length <= 2
    && tokens.some((token) => GREETING_CUES.has(token));
}

function hasLearnerIntentCue(normalizedTranscript: string): boolean {
  return LEARNER_INTENT_PREFIXES.some((prefix) => normalizedTranscript.startsWith(prefix))
    || normalizedTranscript.includes('practice ')
    || normalizedTranscript.includes('order food')
    || normalizedTranscript.includes('restaurant')
    || normalizedTranscript.includes('shopping')
    || normalizedTranscript.includes('travel')
    || normalizedTranscript.includes('directions');
}

function hasQuestionCue(normalizedTranscript: string, tokens: string[]): boolean {
  if (/[?？¿]$/.test(normalizedTranscript)) {
    return true;
  }

  const firstToken = tokens[0];
  if (firstToken && QUESTION_STARTERS.has(firstToken)) {
    return true;
  }

  return normalizedTranscript.startsWith('can you ')
    || normalizedTranscript.startsWith('could you ')
    || normalizedTranscript.startsWith('would you ')
    || normalizedTranscript.startsWith('will you ')
    || normalizedTranscript.startsWith('do you ')
    || normalizedTranscript.startsWith('help me ')
    || normalizedTranscript.startsWith('please ')
    || normalizedTranscript.startsWith('tu peux ')
    || normalizedTranscript.startsWith('vous pouvez ')
    || normalizedTranscript.startsWith('puedes ')
    || normalizedTranscript.startsWith('por favor ')
    || normalizedTranscript.startsWith('можешь ')
    || normalizedTranscript.startsWith('אפשר ')
    || normalizedTranscript.startsWith('도와줘 ');
}

function isShortAcknowledgement(normalizedTranscript: string, tokens: string[]): boolean {
  if (SHORT_ACKNOWLEDGEMENTS.has(normalizedTranscript)) {
    return true;
  }

  return tokens.length > 0
    && tokens.length <= 2
    && tokens.every((token) => SHORT_ACKNOWLEDGEMENTS.has(token));
}

export function assistantPromptLikelyExpectsReply(transcript: string): boolean {
  const normalizedTranscript = normalizeTranscript(transcript);
  if (!normalizedTranscript) return false;
  if (/[?？¿]$/.test(normalizedTranscript)) return true;

  return normalizedTranscript.includes('your turn')
    || normalizedTranscript.includes('what about you')
    || normalizedTranscript.includes('tell me')
    || normalizedTranscript.includes('say it')
    || normalizedTranscript.includes('repeat after me');
}

export function shouldRespondToRealtimeTurn(
  transcript: string,
  metrics: RealtimeInputTurnMetrics
): boolean {
  const normalizedTranscript = normalizeTranscript(transcript);
  if (!normalizedTranscript) {
    return false;
  }

  const tokens = tokenizeTranscript(normalizedTranscript);
  if (tokens.length === 0) {
    return false;
  }

  const directAddress = hasDirectAddressCue(normalizedTranscript);
  const greetingCue = hasGreetingCue(normalizedTranscript, tokens);
  const intentCue = hasLearnerIntentCue(normalizedTranscript);
  const questionCue = hasQuestionCue(normalizedTranscript, tokens);
  const shortAcknowledgement = isShortAcknowledgement(normalizedTranscript, tokens);
  const nearFieldSpeech = !metrics.hadMicSignal || metrics.peakRms >= DIRECTED_SPEECH_RMS_THRESHOLD;

  if (shortAcknowledgement) {
    return metrics.assistantPromptedUser && nearFieldSpeech;
  }

  if (greetingCue && nearFieldSpeech) {
    return true;
  }

  if (tokens.length === 1 && !directAddress && !questionCue && !greetingCue && !intentCue) {
    return false;
  }

  if (
    tokens.length <= 2
    && metrics.durationMs < 650
    && !directAddress
    && !questionCue
    && !greetingCue
    && !intentCue
    && !nearFieldSpeech
  ) {
    return false;
  }

  if (!nearFieldSpeech && !directAddress && !questionCue && !greetingCue && !intentCue) {
    return false;
  }

  return true;
}

export function createEmptyRealtimeInputTurnMetrics(): RealtimeInputTurnMetrics {
  return {
    peakRms: 0,
    durationMs: 0,
    hadMicSignal: false,
    assistantPromptedUser: false,
  };
}
