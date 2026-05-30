export interface CurriculumScenarioForMinigames {
  id: string;
  title: string;
  objective_id?: string;
  target_phrases: string[];
  grammar_challenges?: GrammarChallengeSeed[];
}

export interface GrammarChallengeSeed {
  id?: string;
  sentence: string;
  masked_sentence: string;
  answer: string;
  choices: string[];
  explanation: string;
}

export interface ListeningQuizQuestion {
  id: string;
  promptText: string;
  choices: string[];
  correctIndex: number;
}

export interface GrammarChallengeQuestion {
  id: string;
  sentence: string;
  maskedSentence: string;
  answer: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
}

const PARTICLE_FAMILIES: string[][] = [
  ['은', '는'],
  ['이', '가'],
  ['을', '를'],
  ['와', '과'],
  ['에', '에서'],
  ['으로', '로'],
];

const PARTICLES_BY_LENGTH = Array.from(new Set(PARTICLE_FAMILIES.flat())).sort(
  (left, right) => right.length - left.length
);

const COMMON_PARTICLE_CHOICES = ['은', '는', '이', '가', '을', '를', '에', '에서', '으로', '로'];

function uniquePhrases(scenarios: CurriculumScenarioForMinigames[]): string[] {
  const seen = new Set<string>();
  const phrases: string[] = [];
  scenarios.forEach((scenario) => {
    scenario.target_phrases.forEach((phrase) => {
      const cleaned = phrase.trim();
      if (!cleaned || seen.has(cleaned)) return;
      seen.add(cleaned);
      phrases.push(cleaned);
    });
  });
  return phrases;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    const current = result[index];
    result[index] = result[randomIndex];
    result[randomIndex] = current;
  }
  return result;
}

function stripTrailingPunctuation(phrase: string): string {
  return phrase.replace(/[.!?]+$/gu, '').trim();
}

function findParticleTarget(phrase: string): { stem: string; particle: string } | null {
  const normalized = stripTrailingPunctuation(phrase);
  const tokens = normalized.split(/\s+/u).filter(Boolean);
  for (const token of tokens) {
    for (const particle of PARTICLES_BY_LENGTH) {
      if (token.endsWith(particle) && token.length > particle.length) {
        return {
          stem: token.slice(0, -particle.length),
          particle,
        };
      }
    }
  }
  return null;
}

function buildChoiceSet(correct: string, targetCount = 4): string[] {
  const family = PARTICLE_FAMILIES.find((items) => items.includes(correct)) ?? [];
  const distractors = [...family, ...COMMON_PARTICLE_CHOICES].filter(
    (particle) => particle !== correct
  );
  const deduped = [...new Set(distractors)];
  const selected = deduped.slice(0, Math.max(1, targetCount - 1));
  return shuffle([correct, ...selected]);
}

export function buildListeningQuizQuestions(
  selectedScenario: CurriculumScenarioForMinigames,
  allScenarios: CurriculumScenarioForMinigames[],
  count = 5
): ListeningQuizQuestion[] {
  const selectedPhrases = [...new Set(selectedScenario.target_phrases.map((phrase) => phrase.trim()))].filter(
    Boolean
  );
  const pool = uniquePhrases(allScenarios);
  if (!selectedPhrases.length || !pool.length) return [];

  const questionCount = Math.min(Math.max(1, count), selectedPhrases.length);
  return selectedPhrases.slice(0, questionCount).map((phrase, index) => {
    const distractorPool = pool.filter((item) => item !== phrase);
    const choiceCount = Math.min(4, Math.max(2, pool.length));
    const wrongChoices = shuffle(distractorPool).slice(0, choiceCount - 1);
    const choices = shuffle([phrase, ...wrongChoices]);
    return {
      id: `listen-${selectedScenario.id}-${index}`,
      promptText: phrase,
      choices,
      correctIndex: choices.findIndex((choice) => choice === phrase),
    };
  });
}

export function buildGrammarChallengeQuestions(
  selectedScenario: CurriculumScenarioForMinigames,
  allScenarios: CurriculumScenarioForMinigames[],
  count = 5
): GrammarChallengeQuestion[] {
  const curatedQuestions = (selectedScenario.grammar_challenges ?? [])
    .slice(0, Math.max(1, count))
    .map((question, index) => {
      const normalizedChoices = [...new Set(question.choices.flatMap((choice) => {
        const value = choice.trim();
        return value ? [value] : [];
      }))];
      const answer = question.answer.trim();
      const choices = normalizedChoices.includes(answer)
        ? shuffle(normalizedChoices)
        : shuffle([answer, ...normalizedChoices]);
      const correctIndex = choices.findIndex((choice) => choice === answer);

      if (!question.sentence.trim() || !question.masked_sentence.trim() || correctIndex < 0) {
        return null;
      }

      return {
        id: question.id ?? `grammar-${selectedScenario.id}-${index}`,
        sentence: question.sentence.trim(),
        maskedSentence: question.masked_sentence.trim(),
        answer,
        choices,
        correctIndex,
        explanation: question.explanation.trim(),
      };
    })
    .filter((question): question is GrammarChallengeQuestion => question !== null);

  if (curatedQuestions.length) {
    return curatedQuestions;
  }

  const phrasePool = [
    ...selectedScenario.target_phrases,
    ...allScenarios.flatMap((scenario) => scenario.target_phrases),
  ];
  const dedupedPhrases = [...new Set(phrasePool.map((phrase) => phrase.trim()))].filter(Boolean);

  const questions: GrammarChallengeQuestion[] = [];
  for (const phrase of dedupedPhrases) {
    if (questions.length >= count) break;
    const target = findParticleTarget(phrase);
    if (!target) continue;

    const maskedSentence = stripTrailingPunctuation(phrase).replace(
      `${target.stem}${target.particle}`,
      `${target.stem}(__)`
    );
    const choices = buildChoiceSet(target.particle);
    const choiceIndexByValue = new Map(choices.map((choice, index) => [choice, index]));
    const correctIndex = choiceIndexByValue.get(target.particle) ?? -1;

    questions.push({
      id: `grammar-${selectedScenario.id}-${questions.length}`,
      sentence: stripTrailingPunctuation(phrase),
      maskedSentence,
      answer: target.particle,
      choices,
      correctIndex,
      explanation: `${target.stem} 뒤에 알맞은 조사(문법)를 선택하세요.`,
    });
  }

  return questions;
}
