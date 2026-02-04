// WordMatch - Warm Brutalism Edition

import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Trophy, Link2 } from 'lucide-react';
import { Button } from '@/components/ui';

// Use public path for Vite static asset
const wordMatchLogo = '/minigamelogos/wordmatchlogo.png';

interface WordPair {
  korean: string;
  english: string;
}

interface WordMatchProps {
  wordPairs: WordPair[];
  onClose: () => void;
}

export function WordMatch({ wordPairs, onClose }: WordMatchProps) {
  // Shuffle words for columns
  const [leftWords] = useState(() => wordPairs.map((w) => w.korean).sort(() => Math.random() - 0.5));
  const [rightWords] = useState(() =>
    wordPairs.map((w) => w.english).sort(() => Math.random() - 0.5)
  );
  const [selectedLeft, setSelectedLeft] = useState<number | null>(null);
  const [selectedRight, setSelectedRight] = useState<number | null>(null);
  const [matched, setMatched] = useState<{ left: number[]; right: number[] }>({ left: [], right: [] });
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);

  // Find the original pair for checking
  const isMatch = (leftIdx: number, rightIdx: number) => {
    return wordPairs.some(
      (pair) => pair.korean === leftWords[leftIdx] && pair.english === rightWords[rightIdx]
    );
  };

  // Handle selection and matching
  const handleSelect = (side: 'left' | 'right', idx: number) => {
    if (matched[side].includes(idx)) return;
    if (side === 'left') setSelectedLeft(idx);
    else setSelectedRight(idx);
  };

  // Check for match when both selected
  if (
    selectedLeft !== null &&
    selectedRight !== null &&
    !matched.left.includes(selectedLeft) &&
    !matched.right.includes(selectedRight)
  ) {
    if (isMatch(selectedLeft, selectedRight)) {
      setMatched((prev) => ({
        left: [...prev.left, selectedLeft],
        right: [...prev.right, selectedRight],
      }));
      setScore((s) => s + 10);
      if (matched.left.length + 1 === wordPairs.length) setGameOver(true);
    }
    setTimeout(() => {
      setSelectedLeft(null);
      setSelectedRight(null);
    }, 500);
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
        className="bg-card rounded-xl border border-border shadow-lg p-8 max-w-2xl w-full relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-accent text-accent-foreground flex items-center justify-center shadow-sm overflow-hidden">
              {wordMatchLogo ? (
                <img src={wordMatchLogo} alt="Word Match Logo" className="w-full h-full object-cover" />
              ) : (
                <Link2 size={24} strokeWidth={2.5} />
              )}
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Minigame
              </p>
              <span className="text-2xl font-display font-bold text-foreground">Word Match</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-xl border-2 border-transparent hover:border-border transition-colors"
          >
            <X size={28} strokeWidth={2.5} />
          </button>
        </div>

        {/* Score */}
        <div className="flex items-center justify-between mb-6">
          <div className="bg-success/10 text-success px-4 py-2 rounded-xl border-2 border-success/30">
            <span className="text-lg font-bold">Score: {score}</span>
          </div>
          <div className="bg-secondary text-muted-foreground px-4 py-2 rounded-xl border-2 border-border">
            <span className="text-sm font-semibold">
              {matched.left.length}/{wordPairs.length} matched
            </span>
          </div>
        </div>

        {/* Game Over */}
        {gameOver ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="w-20 h-20 rounded-xl bg-accent text-accent-foreground flex items-center justify-center mb-6 shadow-sm">
              <Trophy size={40} strokeWidth={2.5} />
            </div>
            <div className="text-4xl font-display font-bold text-foreground mb-2">Excellent!</div>
            <p className="text-muted-foreground mb-2">All words matched!</p>
            <div className="bg-secondary rounded-xl border-2 border-border px-6 py-4 mb-6">
              <p className="text-3xl font-display font-bold text-primary">
                {score} points
              </p>
            </div>
            <Button onClick={onClose} className="w-40">
              Close
            </Button>
          </div>
        ) : (
          <div className="flex flex-row gap-8 justify-center">
            {/* Left Column (Korean) */}
            <div className="flex flex-col gap-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold text-center mb-2">
                Korean
              </p>
              {leftWords.map((word, i) => (
                <button
                  key={i}
                  className={`
                    px-6 py-3 rounded-lg border text-lg font-display font-bold transition-all
                    ${matched.left.includes(i) ? 'bg-success/10 text-success border-success cursor-default' : ''}
                    ${selectedLeft === i && !matched.left.includes(i) ? 'bg-primary/10 text-primary border-primary shadow-sm' : ''}
                    ${selectedLeft !== i && !matched.left.includes(i) ? 'bg-card border-border hover:border-primary/50 hover:shadow-sm text-foreground' : ''}
                  `}
                  disabled={matched.left.includes(i)}
                  onClick={() => handleSelect('left', i)}
                >
                  {word}
                </button>
              ))}
            </div>

            {/* Connector Line Visual */}
            <div className="flex items-center justify-center">
              <div className="w-8 h-0.5 bg-border rounded-full" />
            </div>

            {/* Right Column (English) */}
            <div className="flex flex-col gap-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold text-center mb-2">
                English
              </p>
              {rightWords.map((word, i) => (
                <button
                  key={i}
                  className={`
                    px-6 py-3 rounded-lg border text-lg font-medium transition-all
                    ${matched.right.includes(i) ? 'bg-success/10 text-success border-success cursor-default' : ''}
                    ${selectedRight === i && !matched.right.includes(i) ? 'bg-accent/10 text-accent border-accent shadow-sm' : ''}
                    ${selectedRight !== i && !matched.right.includes(i) ? 'bg-card border-border hover:border-accent/50 hover:shadow-sm text-foreground' : ''}
                  `}
                  disabled={matched.right.includes(i)}
                  onClick={() => handleSelect('right', i)}
                >
                  {word}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Instructions */}
        {!gameOver && (
          <p className="text-center text-sm text-muted-foreground mt-6">
            Click a word on each side to match them together
          </p>
        )}
      </motion.div>
    </motion.div>
  );
}
