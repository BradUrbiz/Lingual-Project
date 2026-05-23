import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Puzzle, X, Trophy } from 'lucide-react';
import { Button } from '@/components/ui';
import type { GrammarChallengeQuestion } from '@/lib/minigameContent';
import type { MinigameCompletionResult } from './ListeningQuiz';

interface GrammarChallengeProps {
  questions: GrammarChallengeQuestion[];
  scenarioTitle: string;
  onClose: () => void;
  onComplete: (result: MinigameCompletionResult) => void;
}

export function GrammarChallenge({
  questions,
  scenarioTitle,
  onClose,
  onComplete,
}: GrammarChallengeProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [correctAnswers, setCorrectAnswers] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [gameOver, setGameOver] = useState(false);

  const currentQuestion = questions[currentIndex];
  const totalQuestions = questions.length;
  const progress = useMemo(
    () => Math.round(((currentIndex + (gameOver ? 1 : 0)) / Math.max(totalQuestions, 1)) * 100),
    [currentIndex, gameOver, totalQuestions]
  );

  const finishGame = (finalCorrectAnswers: number) => {
    const durationSeconds = Math.max(totalQuestions * 5, 1);
    const score = finalCorrectAnswers * 10;
    onComplete({
      score,
      correctAnswers: finalCorrectAnswers,
      totalQuestions,
      durationSeconds,
      metadata: { scenarioTitle },
    });
    setGameOver(true);
  };

  const handleSelectChoice = (index: number) => {
    if (!currentQuestion || isAnswered) return;
    setSelectedIndex(index);
    setIsAnswered(true);

    const isCorrect = index === currentQuestion.correctIndex;
    const nextCorrect = isCorrect ? correctAnswers + 1 : correctAnswers;
    if (isCorrect) {
      setCorrectAnswers(nextCorrect);
    }

    window.setTimeout(() => {
      if (currentIndex >= totalQuestions - 1) {
        finishGame(nextCorrect);
        return;
      }
      setCurrentIndex((prev) => prev + 1);
      setSelectedIndex(null);
      setIsAnswered(false);
    }, 650);
  };

  if (!currentQuestion || totalQuestions === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-foreground/60 flex items-center justify-center z-50 p-4"
    >
      <motion.div
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-card rounded-2xl border-3 border-foreground shadow-stamp p-8 w-full max-w-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary text-primary-foreground border-2 border-foreground flex items-center justify-center">
              <Puzzle size={24} strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Minigame</p>
              <h2 className="text-2xl font-display font-bold text-foreground">Grammar Challenge</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close grammar challenge"
            className="p-2 rounded-xl border-2 border-transparent hover:border-border hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={24} strokeWidth={2.5} />
          </button>
        </div>

        {gameOver ? (
          <div className="text-center py-8">
            <div className="w-20 h-20 rounded-2xl bg-accent text-accent-foreground border-3 border-foreground flex items-center justify-center mx-auto mb-6 shadow-stamp">
              <Trophy size={38} strokeWidth={2.5} />
            </div>
            <h3 className="text-3xl font-display font-bold text-foreground mb-2">Challenge Complete</h3>
            <p className="text-muted-foreground mb-5">{scenarioTitle}</p>
            <div className="bg-secondary rounded-xl border-2 border-border px-6 py-5 mb-6 inline-block">
              <p className="text-4xl font-display font-bold text-primary">
                {correctAnswers}/{totalQuestions}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {Math.round((correctAnswers / Math.max(totalQuestions, 1)) * 100)}% accuracy
              </p>
            </div>
            <Button onClick={onClose} className="w-48">Close</Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-muted-foreground">
                Question {currentIndex + 1} of {totalQuestions}
              </p>
              <p className="text-sm font-semibold text-success">Correct: {correctAnswers}</p>
            </div>

            <div className="h-2 w-full rounded-lg bg-secondary border border-border overflow-hidden mb-6">
              <div
                className="h-full bg-primary rounded-lg transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>

            <div className="rounded-xl border-2 border-border bg-secondary p-5 mb-5">
              <p className="text-sm text-muted-foreground mb-2">Fill the blank with the best word or phrase:</p>
              <p className="text-2xl font-display font-bold text-foreground">
                {currentQuestion.maskedSentence}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {currentQuestion.choices.map((choice, index) => {
                const isCorrectChoice = index === currentQuestion.correctIndex;
                const isSelected = selectedIndex === index;

                return (
                  <button
                    key={`${currentQuestion.id}-${choice}`}
                    onClick={() => handleSelectChoice(index)}
                    disabled={isAnswered}
                    className={[
                      'rounded-xl border-2 px-4 py-3 font-display font-bold text-lg transition-all',
                      !isAnswered && 'border-border bg-card hover:border-foreground hover:shadow-stamp-sm',
                      isAnswered && isCorrectChoice && 'border-success bg-success/10 text-success',
                      isAnswered && isSelected && !isCorrectChoice && 'border-destructive bg-destructive/10 text-destructive',
                      isAnswered && !isSelected && !isCorrectChoice && 'opacity-70',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {choice}
                  </button>
                );
              })}
            </div>

            {isAnswered && (
              <p className="text-xs text-muted-foreground mt-4">{currentQuestion.explanation}</p>
            )}
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
