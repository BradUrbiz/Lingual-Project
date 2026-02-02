import * as React from 'react';
import { cn } from '@/lib/utils';
import { Label } from './label';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  autoResize?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, autoResize = false, onChange, ...props }, ref) => {
    const internalRef = React.useRef<HTMLTextAreaElement>(null);
    const textareaRef =
      (ref as React.RefObject<HTMLTextAreaElement>) || internalRef;

    const handleResize = () => {
      if (autoResize && textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
      }
    };

    React.useEffect(() => {
      handleResize();
    }, [props.value]);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange?.(e);
      handleResize();
    };

    return (
      <div className="w-full">
        {label && <Label>{label}</Label>}
        <textarea
          className={cn(
            'flex min-h-[80px] w-full rounded-xl border-2 border-border bg-card px-4 py-3 text-base font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:shadow-stamp-sm transition-all disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-secondary resize-none',
            error && 'border-destructive',
            className
          )}
          ref={textareaRef}
          onChange={handleChange}
          {...props}
        />
        {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
