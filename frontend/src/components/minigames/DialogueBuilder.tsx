// DialogueBuilder - Warm Brutalism Edition

import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Sparkles, Trophy } from 'lucide-react';
import { Button } from '@/components/ui';

interface DialogueItem {
  prompt: string; // e.g. "A: 안녕하세요! B: ___"
  options: string[]; // e.g. ["안녕하세요!", "감사합니다!", "잘 지냈어요?", "네, 맞아요!"]
  answer: string; // e.g. "안녕하세요!"
}

interface DialogueBuilderProps {
  items: DialogueItem[];
  onClose: () => void;
}

export function DialogueBuilder({ items, onClose }: DialogueBuilderProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [showResult, setShowResult] = useState<null | boolean>(null);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);

  const current = items[currentIndex];

  const handleSelect = (idx: number) => {
    if (showResult !== null) return;
    setSelected(idx);
    const isCorrect = current.options[idx] === current.answer;
    setShowResult(isCorrect);
    if (isCorrect) setScore((s) => s + 1);
    setTimeout(() => {
      setShowResult(null);
      setSelected(null);
      if (currentIndex + 1 >= items.length) {
        setGameOver(true);
      } else {
        setCurrentIndex((i) => i + 1);
      }
    }, 900);
  };

  if (gameOver) {
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
          className="bg-card rounded-2xl border-3 border-foreground shadow-stamp p-8 max-w-md w-full text-center"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-16 h-16 rounded-2xl bg-accent text-accent-foreground border-2 border-foreground flex items-center justify-center mx-auto mb-6 shadow-stamp-sm">
            <Trophy size={32} strokeWidth={2.5} />
          </div>
          <h2 className="text-3xl font-display font-bold text-foreground mb-2">게임 종료!</h2>
          <p className="text-muted-foreground mb-6">대화 완성 연습이 끝났어요!</p>
          <div className="bg-secondary rounded-xl border-2 border-border p-6 mb-6">
            <p className="text-5xl font-display font-bold text-primary mb-2">
              {score}/{items.length}
            </p>
            <p className="text-muted-foreground">정답 개수</p>
          </div>
          <Button onClick={onClose} className="w-40">
            닫기
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
        className="bg-card rounded-2xl border-3 border-foreground shadow-stamp p-8 max-w-xl w-full relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-accent text-accent-foreground border-2 border-foreground flex items-center justify-center shadow-stamp-sm">
              <Sparkles size={28} strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Minigame</p>
              <span className="text-2xl font-display font-bold text-foreground">Dialogue Builder</span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialogue builder"
            title="Close"
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-xl border-2 border-transparent hover:border-border transition-colors"
          >
            <X size={28} strokeWidth={2.5} />
          </button>
        </div>
        <div className="mb-8">
          <p className="text-2xl font-display font-bold text-foreground text-center mb-4">대화를 완성하세요!</p>
          <p className="text-xl text-center text-muted-foreground mb-2">{current.prompt}</p>
        </div>
        <div className="flex flex-row gap-6 justify-center mb-8">
          {current.options.map((word, i) => (
            <button
              key={i}
              className={`px-8 py-4 rounded-xl border-2 text-lg font-display font-bold transition-all
                ${selected === i && showResult === true ? 'bg-success/10 text-success border-success' : ''}
                ${selected === i && showResult === false ? 'bg-destructive/10 text-destructive border-destructive' : ''}
                ${selected !== i ? 'bg-card border-border hover:border-foreground hover:shadow-stamp-sm text-foreground' : ''}
              `}
              disabled={showResult !== null}
              onClick={() => handleSelect(i)}
            >
              {word}
            </button>
          ))}
        </div>
        {showResult !== null && (
          <div className="text-center text-lg font-semibold mt-2">
            {showResult ? '정답입니다!' : `오답! 정답: ${current.answer}`}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
