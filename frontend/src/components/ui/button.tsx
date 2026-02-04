import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-base font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // Refined primary - clean and elegant
        default:
          'bg-primary text-primary-foreground shadow-sm hover:shadow-md hover:bg-primary/90 active:scale-[0.98]',
        // Destructive with refined styling
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:shadow-md hover:bg-destructive/90 active:scale-[0.98]',
        // Outline - clean border
        outline:
          'bg-card text-foreground border border-border hover:bg-secondary hover:border-primary/50 active:bg-muted',
        // Secondary - soft and subtle
        secondary:
          'bg-secondary text-secondary-foreground border border-border/50 hover:bg-muted hover:border-border',
        // Ghost - minimal
        ghost:
          'text-foreground hover:bg-secondary/50 hover:text-foreground',
        // Link - underline style
        link:
          'text-primary underline-offset-4 hover:underline font-medium',
        // Option - for selection buttons
        option:
          'bg-card text-foreground border border-border hover:border-primary hover:bg-primary/5',
        // Google auth button
        google:
          'bg-card text-foreground border border-border gap-3 hover:bg-secondary hover:border-primary/30',
        // Accent variant
        accent:
          'bg-accent text-accent-foreground shadow-sm hover:shadow-md hover:bg-accent/90 active:scale-[0.98]',
        // Success variant
        success:
          'bg-success text-success-foreground shadow-sm hover:shadow-md hover:bg-success/90 active:scale-[0.98]',
      },
      size: {
        default: 'h-11 px-6 py-2.5',
        sm: 'h-9 px-4 text-sm',
        lg: 'h-13 px-8 text-lg',
        icon: 'h-11 w-11',
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
        className: 'bg-primary/10 border-primary text-primary',
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
