import * as React from 'react';
import { cn } from '@/lib/utils';
import { Label } from './label';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, error, ...props }, ref) => {
    return (
      <div className="w-full">
        {label && <Label className="text-sm font-medium text-foreground mb-1.5">{label}</Label>}
        <input
          type={type}
          className={cn(
            'flex h-12 w-full rounded-2xl border-2 border-transparent bg-secondary/50 px-4 py-3 text-sm shadow-sm transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
            'placeholder:text-muted-foreground',
            'focus:outline-none focus:border-primary focus:bg-white focus:shadow-[0_0_0_4px_rgba(13,148,136,0.1)]',
            'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-secondary',
            'file:border-0 file:bg-transparent file:text-sm file:font-medium',
            error && 'border-destructive focus:border-destructive focus:shadow-[0_0_0_4px_rgba(244,63,94,0.1)]',
            className
          )}
          ref={ref}
          {...props}
        />
        {error && <p className="mt-1.5 text-sm text-destructive">{error}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';

export { Input };
