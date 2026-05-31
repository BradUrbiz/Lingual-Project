import { KeyboardEvent } from 'react';
import { Textarea as TextArea } from '@/components/ui/textarea';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({
  value,
  onChange,
  onSend,
  disabled = false,
  placeholder = 'Type a message...',
}: ChatInputProps) {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) {
        onSend();
      }
    }
  };

  return (
    <div className="flex items-end gap-3">
      <TextArea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoResize
        rows={1}
        className="flex-1 min-h-[48px] text-[10.4px] leading-[1.45]"
      />
      <button type="button"
        onClick={onSend}
        aria-label="Send message"
        disabled={!value.trim() || disabled}
        className="p-3 bg-primary text-primary-foreground rounded-xl border-2 border-foreground shadow-stamp hover:shadow-[6px_6px_0_0_var(--foreground)] hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[2px_2px_0_0_var(--foreground)] disabled:bg-secondary disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:cursor-not-allowed transition-all"
      >
        <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
          />
        </svg>
      </button>
    </div>
  );
}
