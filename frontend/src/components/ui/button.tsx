/* eslint-disable react-refresh/only-export-components */
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-xl text-base font-semibold transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // Warm Brutalism primary - stamp effect
        default:
          'bg-primary text-primary-foreground border-3 border-foreground shadow-stamp hover:shadow-[6px_6px_0_0_#2D2A26] hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[2px_2px_0_0_#2D2A26]',
        // Destructive with brutalist styling
        destructive:
          'bg-destructive text-destructive-foreground border-3 border-foreground shadow-stamp hover:shadow-[6px_6px_0_0_#2D2A26] hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[2px_2px_0_0_#2D2A26]',
        // Outline - visible border, warm hover
        outline:
          'bg-card text-foreground border-3 border-foreground hover:bg-secondary active:bg-muted',
        // Secondary - softer brutalist
        secondary:
          'bg-secondary text-secondary-foreground border-2 border-border hover:border-foreground hover:bg-muted',
        // Ghost - minimal but warm
        ghost:
          'text-foreground hover:bg-secondary hover:text-foreground',
        // Link - underline style
        link:
          'text-primary underline-offset-4 hover:underline font-medium',
        // Option - for selection buttons
        option:
          'bg-card text-foreground border-3 border-border hover:border-primary hover:bg-primary/5',
        // Google auth button
        google:
          'bg-card text-foreground border-3 border-foreground gap-3 hover:bg-secondary',
        // Accent variant - mustard color
        accent:
          'bg-accent text-accent-foreground border-3 border-foreground shadow-stamp hover:shadow-[6px_6px_0_0_#2D2A26] hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[2px_2px_0_0_#2D2A26]',
        // Success variant - sage green
        success:
          'bg-success text-success-foreground border-3 border-foreground shadow-stamp hover:shadow-[6px_6px_0_0_#2D2A26] hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[2px_2px_0_0_#2D2A26]',
      },
      size: {
        default: 'h-12 px-6 py-3',
        sm: 'h-10 px-4 text-sm',
        lg: 'h-14 px-8 text-lg',
        icon: 'h-12 w-12',
      },
      selected: {
        true: '',
        false: '',
      },
    },
    compoundVariants: [
      {
        variant: 'option',
        selected: true,
        className: 'bg-primary/10 border-primary text-primary border-3',
      },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
      selected: false,
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      selected,
      asChild = false,
      loading,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, selected, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading...</span>
          </span>
        ) : (
          children
        )}
      </Comp>
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
