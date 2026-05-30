import { m } from 'framer-motion';
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
    <m.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="space-y-3"
    >
      {options.map((option, index) => (
        <m.button
          key={option.id}
          variants={staggerItem}
          onClick={() => onChange(option.id)}
          className={cn(
            'group w-full text-left px-5 py-4 rounded-2xl border-2 transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 flex items-center gap-4',
            selectedId === option.id
              ? 'bg-primary/10 border-primary text-foreground shadow-stamp-sm'
              : 'bg-card border-border hover:border-foreground text-foreground hover:shadow-stamp-sm'
          )}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
        >
          <span
            className={cn(
              'h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold transition-colors border-2',
              selectedId === option.id
                ? 'bg-primary text-primary-foreground border-foreground'
                : 'bg-secondary text-muted-foreground border-border group-hover:border-foreground group-hover:text-foreground'
            )}
          >
            {letters[index] || index + 1}
          </span>
          <span
            className={cn(
              'flex-1 text-base font-medium',
              selectedId === option.id ? 'text-foreground' : 'text-foreground'
            )}
          >
            {option.text}
          </span>
          {selectedId === option.id && <Check className="size-4 text-primary" />}
        </m.button>
      ))}
    </m.div>
  );
}
