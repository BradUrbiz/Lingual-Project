import * as React from 'react';
import { cn } from '@/lib/utils';
import { Label } from './label';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  autoResize?: boolean;
  ref?: React.Ref<HTMLTextAreaElement>;
}

function Textarea({ className, label, error, autoResize = false, onChange, id, ref, ...props }: TextareaProps) {
  const internalRef = React.useRef<HTMLTextAreaElement>(null);
  const generatedId = React.useId();
  const textareaId = id || generatedId;
  const errorId = `${textareaId}-error`;
  const describedBy = error ? errorId : props['aria-describedby'];

  const setTextareaRef = React.useCallback((node: HTMLTextAreaElement | null) => {
    internalRef.current = node;
    if (typeof ref === 'function') {
      ref(node);
    } else if (ref) {
      ref.current = node;
    }
  }, [ref]);

  const handleResize = React.useCallback(() => {
    if (autoResize && internalRef.current) {
      internalRef.current.style.height = 'auto';
      internalRef.current.style.height = `${Math.min(internalRef.current.scrollHeight, 120)}px`;
    }
  }, [autoResize]);

  React.useEffect(() => {
    handleResize();
  }, [props.value, handleResize]);

  const resizeAfterTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange?.(e);
    handleResize();
  };

  return (
    <div className="w-full">
      {label && <Label htmlFor={textareaId}>{label}</Label>}
      <textarea
        id={textareaId}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={describedBy}
        className={cn(
          'flex min-h-[80px] w-full rounded-xl border-2 border-border bg-card px-4 py-3 text-base font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:shadow-stamp-sm transition-all disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-secondary resize-none',
          error && 'border-destructive',
          className
        )}
        ref={setTextareaRef}
        onChange={resizeAfterTextareaChange}
        {...props}
      />
      {error && <p id={errorId} className="mt-1 text-sm text-destructive">{error}</p>}
    </div>
  );
}
Textarea.displayName = 'Textarea';

export { Textarea };
