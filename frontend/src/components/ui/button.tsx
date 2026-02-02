import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap text-sm font-semibold transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // Default - Fluid gradient with teal glow
        default:
          'rounded-full bg-gradient-to-r from-primary via-teal-500 to-cyan-500 text-white shadow-[0_4px_16px_rgba(13,148,136,0.3)] hover:shadow-[0_8px_24px_rgba(13,148,136,0.4)] hover:-translate-y-0.5 active:translate-y-0',
        // Destructive - Soft coral flow
        destructive:
          'rounded-full bg-gradient-to-r from-destructive to-rose-400 text-white shadow-[0_4px_16px_rgba(244,63,94,0.25)] hover:shadow-[0_8px_24px_rgba(244,63,94,0.35)] hover:-translate-y-0.5',
        // Outline - Fluid border
        outline:
          'rounded-full border-2 border-border bg-white text-foreground shadow-fluid hover:border-primary/50 hover:shadow-fluid-hover hover:-translate-y-0.5',
        // Secondary - Soft mist
        secondary:
          'rounded-full bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80 hover:shadow-md',
        // Ghost - Subtle hover
        ghost:
          'rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground',
        // Link - Flowing underline
        link:
          'text-primary underline-offset-4 hover:underline',
        // Option - For selections with fluid border
        option:
          'rounded-2xl bg-white border-2 border-border text-foreground shadow-sm hover:border-primary/40 hover:shadow-md transition-all',
        // Google Sign In - Clean, polished
        google:
          'rounded-full bg-white text-foreground border-2 border-border shadow-fluid hover:shadow-fluid-hover hover:-translate-y-0.5 gap-3',
        // Success - Mint flow
        success:
          'rounded-full bg-gradient-to-r from-success to-emerald-400 text-white shadow-[0_4px_16px_rgba(16,185,129,0.25)] hover:shadow-[0_8px_24px_rgba(16,185,129,0.35)] hover:-translate-y-0.5',
        // Accent - Dreamy lavender
        accent:
          'rounded-full bg-gradient-to-r from-accent to-violet-400 text-white shadow-[0_4px_16px_rgba(139,92,246,0.25)] hover:shadow-[0_8px_24px_rgba(139,92,246,0.35)] hover:-translate-y-0.5',
      },
      size: {
        default: 'h-11 px-7 py-3',
        sm: 'h-9 px-5 text-xs',
        lg: 'h-13 px-9 text-base',
        icon: 'h-11 w-11 rounded-full',
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
        className: 'bg-primary/5 border-primary text-primary shadow-[0_0_0_4px_rgba(13,148,136,0.1)]',
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
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
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
