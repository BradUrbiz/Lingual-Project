import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Label } from './label';

const inputVariants = cva(
  'flex w-full rounded-xl text-base ring-offset-background file:border-0 file:bg-transparent file:text-base file:font-medium placeholder:text-muted-foreground focus:outline-none transition-all disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        // Default - Warm Brutalism chunky input
        default:
          'h-12 px-4 py-3 bg-card border-3 border-border focus:border-primary focus:ring-2 focus:ring-primary/20',
        // Filled - warm background
        filled:
          'h-12 px-4 py-3 bg-secondary border-2 border-transparent focus:border-primary focus:bg-card',
        // Ghost - minimal
        ghost:
          'h-12 px-4 py-3 bg-transparent border-b-2 border-border rounded-none focus:border-primary',
      },
      inputSize: {
        default: 'h-12',
        sm: 'h-10 text-sm',
        lg: 'h-14 text-lg',
      },
    },
    defaultVariants: {
      variant: 'default',
      inputSize: 'default',
    },
  }
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {
  label?: string;
  error?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, error, variant, inputSize, ...props }, ref) => {
    return (
      <div className="w-full space-y-2">
        {label && (
          <Label className="text-base font-semibold text-foreground">
            {label}
          </Label>
        )}
        <input
          type={type}
          className={cn(
            inputVariants({ variant, inputSize }),
            error && 'border-destructive focus:border-destructive focus:ring-destructive/20',
            className
          )}
          ref={ref}
          {...props}
        />
        {error && (
          <p className="text-sm font-medium text-destructive">{error}</p>
        )}
      </div>
    );
  }
);
Input.displayName = 'Input';

export { Input, inputVariants };
