import curriculumExampleEs from '@/data/curriculum_example_es.json';
import curriculumExampleKo from '@/data/curriculum_example_ko.json';
import {
  buildListeningQuizQuestions,
  buildGrammarChallengeQuestions,
} from '@/lib/minigameContent';

const curriculum = curriculumExampleKo as {
  practice_scenarios: Array<{
    id: string;
    title: string;
    target_phrases: string[];
  }>;
};

const spanishCurriculum = curriculumExampleEs as {
  practice_scenarios: Array<{
    id: string;
    title: string;
    target_phrases: string[];
    grammar_challenges?: Array<{
      answer: string;
      choices: string[];
      explanation: string;
      masked_sentence: string;
      sentence: string;
    }>;
  }>;
};

describe('minigameContent', () => {
  it('builds listening quiz questions from scenario target phrases', () => {
    const scenario = curriculum.practice_scenarios.find((item) => item.id === 'SCN-ORDER-01');
    expect(scenario).toBeDefined();

    const questions = buildListeningQuizQuestions(
      scenario!,
      curriculum.practice_scenarios,
      4
    );

    expect(questions.length).toBeGreaterThan(0);
    questions.forEach((question) => {
      expect(question.choices.length).toBeGreaterThanOrEqual(2);
      expect(question.choices[question.correctIndex]).toBe(question.promptText);
      expect(scenario!.target_phrases).toContain(question.promptText);
    });
  });

  it('builds grammar challenge questions with blanks and correct answer choices', () => {
    const scenario = curriculum.practice_scenarios.find((item) => item.id === 'SCN-DIR-01');
    expect(scenario).toBeDefined();

    const questions = buildGrammarChallengeQuestions(
      scenario!,
      curriculum.practice_scenarios,
      5
    );

    expect(questions.length).toBeGreaterThan(0);
    questions.forEach((question) => {
      expect(question.maskedSentence).toContain('(__)');
      expect(question.choices).toContain(question.answer);
      expect(question.correctIndex).toBeGreaterThanOrEqual(0);
      expect(question.correctIndex).toBeLessThan(question.choices.length);
    });
  });

  it('builds curated grammar challenge questions for non-Korean curricula', () => {
    const scenario = spanishCurriculum.practice_scenarios.find((item) => item.id === 'SCN-ORDER-ES-01');
    expect(scenario).toBeDefined();

    const questions = buildGrammarChallengeQuestions(
      scenario!,
      spanishCurriculum.practice_scenarios,
      4
    );

    expect(questions.length).toBeGreaterThan(0);
    questions.forEach((question) => {
      expect(question.maskedSentence).toContain('(__)');
      expect(question.choices[question.correctIndex]).toBe(question.answer);
      expect(question.explanation.length).toBeGreaterThan(0);
    });
  });
});
