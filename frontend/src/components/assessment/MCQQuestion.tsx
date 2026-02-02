import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { staggerContainer, staggerItem } from '@/lib/animations';

interface Option {
  id: string;
  text: string;
}

interface MCQQuestionProps {
  options: Option[];
  selectedId: string | null;
  onChange: (id: string) => void;
}

export function MCQQuestion({ options, selectedId, onChange }: MCQQuestionProps) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="space-y-3"
    >
      {options.map((option, index) => (
        <motion.button
          key={option.id}
          variants={staggerItem}
          onClick={() => onChange(option.id)}
          className={cn(
            'group w-full text-left px-5 py-4 rounded-2xl border transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-200 flex items-center gap-4',
            selectedId === option.id
              ? 'bg-purple-50 border-purple-200 text-purple-700'
              : 'bg-white border-slate-200 hover:border-purple-200 text-slate-900'
          )}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
        >
          <span
            className={cn(
              'h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold transition-colors',
              selectedId === option.id
                ? 'bg-purple-600 text-white'
                : 'bg-slate-100 text-slate-500 group-hover:bg-purple-50 group-hover:text-purple-700'
            )}
          >
            {letters[index] || index + 1}
          </span>
          <span
            className={cn(
              'flex-1 text-base font-medium',
              selectedId === option.id ? 'text-purple-700' : 'text-slate-900'
            )}
          >
            {option.text}
          </span>
          {selectedId === option.id && <Check className="h-4 w-4 text-purple-600" />}
        </motion.button>
      ))}
    </motion.div>
  );
}
