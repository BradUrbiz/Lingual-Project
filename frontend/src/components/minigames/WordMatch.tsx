import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
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
  const [leftWords] = useState(() => wordPairs.map(w => w.korean).sort(() => Math.random() - 0.5));
  const [rightWords] = useState(() => wordPairs.map(w => w.english).sort(() => Math.random() - 0.5));
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
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl p-8 max-w-2xl w-full mx-4 relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <img src={wordMatchLogo} alt="Word Match Logo" className="w-12 h-12 rounded-lg shadow" />
            <span className="text-2xl font-bold text-blue-700">Word Match</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={28} />
          </button>
        </div>
        {/* Score */}
        <div className="text-lg font-semibold text-green-700 mb-4">Score: {score}</div>
        {/* Game Over */}
        {gameOver ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="text-3xl font-bold text-green-700 mb-2">Excellent!</div>
            <div className="text-lg mb-6">All words matched!</div>
            <Button onClick={onClose} className="w-40">Close</Button>
          </div>
        ) : (
          <div className="flex flex-row gap-8 justify-center">
            {/* Left Column (Korean) */}
            <div className="flex flex-col gap-2">
              {leftWords.map((word, i) => (
                <button
                  key={i}
                  className={`px-6 py-3 rounded-lg border text-lg font-medium transition-all
                    ${matched.left.includes(i) ? 'bg-gray-200 text-gray-400 cursor-default' : ''}
                    ${selectedLeft === i ? 'bg-blue-200 text-blue-800 border-blue-400' : 'bg-white border-gray-300 hover:bg-blue-50'}
                  `}
                  disabled={matched.left.includes(i)}
                  onClick={() => handleSelect('left', i)}
                >
                  {word}
                </button>
              ))}
            </div>
            {/* Right Column (English) */}
            <div className="flex flex-col gap-2">
              {rightWords.map((word, i) => (
                <button
                  key={i}
                  className={`px-6 py-3 rounded-lg border text-lg font-medium transition-all
                    ${matched.right.includes(i) ? 'bg-gray-200 text-gray-400 cursor-default' : ''}
                    ${selectedRight === i ? 'bg-blue-200 text-blue-800 border-blue-400' : 'bg-white border-gray-300 hover:bg-blue-50'}
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
      </motion.div>
    </motion.div>
  );
}
