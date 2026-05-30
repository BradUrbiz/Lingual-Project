// WordMatch - Warm Brutalism Edition

import { useMemo, useReducer } from 'react';
import { m } from 'framer-motion';
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

type WordMatchState = {
  selectedLeft: number | null;
  selectedRight: number | null;
  matched: { left: number[]; right: number[] };
  score: number;
  gameOver: boolean;
};

type WordMatchAction =
  | {
      type: 'select';
      side: 'left' | 'right';
      idx: number;
      wordPairs: WordPair[];
      leftWords: string[];
      rightWords: string[];
    }
  | { type: 'clearSelection' };

const INITIAL_WORD_MATCH_STATE: WordMatchState = {
  selectedLeft: null,
  selectedRight: null,
  matched: { left: [], right: [] },
  score: 0,
  gameOver: false,
};

function shuffleWords(words: string[]): string[] {
  return Array.from(words).sort(() => Math.random() - 0.5);
}

function isWordMatch(
  wordPairs: WordPair[],
  leftWords: string[],
  rightWords: string[],
  leftIdx: number,
  rightIdx: number
) {
  return wordPairs.some(
    (pair) => pair.korean === leftWords[leftIdx] && pair.english === rightWords[rightIdx]
  );
}

function wordMatchReducer(state: WordMatchState, action: WordMatchAction): WordMatchState {
  switch (action.type) {
    case 'select': {
      if (state.matched[action.side].includes(action.idx)) return state;
      const selectedLeft = action.side === 'left' ? action.idx : state.selectedLeft;
      const selectedRight = action.side === 'right' ? action.idx : state.selectedRight;
      const hasPair = selectedLeft !== null && selectedRight !== null;
      const alreadyMatched =
        hasPair &&
        state.matched.left.includes(selectedLeft) &&
        state.matched.right.includes(selectedRight);

      if (!hasPair || alreadyMatched) {
        return { ...state, selectedLeft, selectedRight };
      }

      const matched = isWordMatch(
        action.wordPairs,
        action.leftWords,
        action.rightWords,
        selectedLeft,
        selectedRight
      );
      if (!matched) {
        return { ...state, selectedLeft, selectedRight };
      }

      const nextMatched = {
        left: [...state.matched.left, selectedLeft],
        right: [...state.matched.right, selectedRight],
      };
      return {
        ...state,
        selectedLeft,
        selectedRight,
        matched: nextMatched,
        score: state.score + 10,
        gameOver: nextMatched.left.length === action.wordPairs.length,
      };
    }
    case 'clearSelection':
      return { ...state, selectedLeft: null, selectedRight: null };
    default:
      return state;
  }
}

export function WordMatch({ wordPairs, onClose }: WordMatchProps) {
  // Shuffle words for columns
  const leftWords = useMemo(() => shuffleWords(wordPairs.map((w) => w.korean)), [wordPairs]);
  const rightWords = useMemo(
    () => shuffleWords(wordPairs.map((w) => w.english)),
    [wordPairs]
  );
  const [wordMatchState, dispatchWordMatch] = useReducer(
    wordMatchReducer,
    INITIAL_WORD_MATCH_STATE
  );
  const { selectedLeft, selectedRight, matched, score, gameOver } = wordMatchState;

  // Handle selection and matching
  const handleSelect = (side: 'left' | 'right', idx: number) => {
    if (matched[side].includes(idx)) return;
    const willCompletePair =
      (side === 'left' && selectedRight !== null) ||
      (side === 'right' && selectedLeft !== null);
    dispatchWordMatch({ type: 'select', side, idx, wordPairs, leftWords, rightWords });
    if (willCompletePair) {
      setTimeout(() => dispatchWordMatch({ type: 'clearSelection' }), 500);
    }
  }

  return (
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-foreground/60 flex items-center justify-center z-50 p-4"
    >
      <m.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-card rounded-2xl border-3 border-foreground shadow-stamp p-8 max-w-2xl w-full relative max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="size-12 rounded-xl bg-accent text-accent-foreground border-2 border-foreground flex items-center justify-center shadow-stamp-sm overflow-hidden">
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
          <button type="button"
            onClick={onClose}
            aria-label="Close word match"
            title="Close"
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
            <div className="size-20 rounded-2xl bg-accent text-accent-foreground border-3 border-foreground flex items-center justify-center mb-6 shadow-stamp">
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
                <button type="button"
                  key={word}
                  className={`
                    px-6 py-3 rounded-xl border-2 text-lg font-display font-bold transition-all
                    ${matched.left.includes(i) ? 'bg-success/10 text-success border-success cursor-default' : ''}
                    ${selectedLeft === i && !matched.left.includes(i) ? 'bg-primary/10 text-primary border-primary shadow-stamp-sm' : ''}
                    ${selectedLeft !== i && !matched.left.includes(i) ? 'bg-card border-border hover:border-foreground hover:shadow-stamp-sm text-foreground' : ''}
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
                <button type="button"
                  key={word}
                  className={`
                    px-6 py-3 rounded-xl border-2 text-lg font-medium transition-all
                    ${matched.right.includes(i) ? 'bg-success/10 text-success border-success cursor-default' : ''}
                    ${selectedRight === i && !matched.right.includes(i) ? 'bg-accent/10 text-accent border-accent shadow-stamp-sm' : ''}
                    ${selectedRight !== i && !matched.right.includes(i) ? 'bg-card border-border hover:border-foreground hover:shadow-stamp-sm text-foreground' : ''}
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
      </m.div>
    </m.div>
  );
}
