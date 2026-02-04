// FLASHCARDFLIP - Warm Brutalism Edition

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trophy, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui';

interface Flashcard {
  korean: string;
  english: string;
}

interface FlashcardFlipProps {
  flashcards: Flashcard[];
  onClose: () => void;
}

export function FlashcardFlip({ flashcards, onClose }: FlashcardFlipProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [score, setScore] = useState(0);
  const [showResult, setShowResult] = useState<'correct' | 'wrong' | null>(null);
  const [gameOver, setGameOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentCard = flashcards[currentIndex];

  useEffect(() => {
    inputRef.current?.focus();
  }, [currentIndex]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const isCorrect = answer.toLowerCase().trim() === currentCard.english.toLowerCase().trim();

    if (isCorrect) {
      setScore(score + 1);
      setShowResult('correct');
    } else {
      setShowResult('wrong');
    }

    setTimeout(() => {
      setShowResult(null);
      setAnswer('');

      if (currentIndex + 1 >= flashcards.length) {
        setGameOver(true);
      } else {
        setCurrentIndex(currentIndex + 1);
      }
    }, 1000);
  };

  if (gameOver) {
    const percentage = Math.round((score / flashcards.length) * 100);
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-foreground/60 flex items-center justify-center z-50 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-card rounded-xl border border-border shadow-lg p-8 max-w-md w-full text-center"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-16 h-16 rounded-xl bg-accent text-accent-foreground flex items-center justify-center mx-auto mb-6 shadow-sm">
            <Trophy size={32} strokeWidth={2.5} />
          </div>
          <h2 className="text-3xl font-display font-bold text-foreground mb-2">Game Over!</h2>
          <p className="text-muted-foreground mb-6">Great effort on this practice session</p>

          <div className="bg-secondary rounded-xl border-2 border-border p-6 mb-6">
            <p className="text-5xl font-display font-bold text-primary mb-2">
              {score}/{flashcards.length}
            </p>
            <p className="text-sm text-muted-foreground font-medium">
              {percentage}% accuracy
            </p>
          </div>

          <Button onClick={onClose} className="w-full">
            Close
          </Button>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-foreground/60 flex items-center justify-center z-50 p-4"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-card rounded-xl border border-border shadow-lg p-8 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary border-2 border-primary/30 flex items-center justify-center">
              <Sparkles size={20} strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Card</p>
              <p className="font-display font-bold text-foreground">
                {currentIndex + 1} of {flashcards.length}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="bg-success/10 text-success px-3 py-1.5 rounded-lg border border-success/20">
              <span className="text-sm font-bold">Score: {score}</span>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-xl border-2 border-transparent hover:border-border transition-colors"
            >
              <X size={24} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="h-2 w-full rounded-lg bg-secondary border border-border overflow-hidden mb-6">
          <motion.div
            className="h-full bg-primary rounded-lg"
            initial={{ width: 0 }}
            animate={{ width: `${((currentIndex + 1) / flashcards.length) * 100}%` }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          />
        </div>

        {/* Flashcard */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ x: 50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -50, opacity: 0 }}
            className={`
              rounded-xl p-8 mb-6 text-center border-2 transition-colors
              ${showResult === 'correct' ? 'bg-success/10 border-success' : ''}
              ${showResult === 'wrong' ? 'bg-destructive/10 border-destructive' : ''}
              ${!showResult ? 'bg-secondary border-border' : ''}
            `}
          >
            <p className="text-4xl font-display font-bold text-foreground mb-4">
              {currentCard.korean}
            </p>
            {showResult === 'wrong' && (
              <p className="text-lg text-destructive font-semibold">
                Correct: {currentCard.english}
              </p>
            )}
            {showResult === 'correct' && (
              <p className="text-lg text-success font-semibold">
                Correct!
              </p>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Input */}
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type the English translation..."
            disabled={showResult !== null}
            className="w-full px-4 py-3 text-lg bg-card border-2 border-border rounded-xl focus:border-primary focus:outline-none disabled:bg-secondary disabled:text-muted-foreground font-medium placeholder:text-muted-foreground transition-colors"
          />
          <Button
            type="submit"
            disabled={!answer.trim() || showResult !== null}
            className="w-full mt-4"
          >
            Submit Answer
          </Button>
        </form>
      </motion.div>
    </motion.div>
  );
}

// FLASHCARDFLIP
