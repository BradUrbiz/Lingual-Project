import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-lg font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        // Default - primary with border
        default:
          'bg-primary text-primary-foreground border-2 border-foreground',
        // Secondary - muted
        secondary:
          'bg-secondary text-secondary-foreground border-2 border-border',
        // Destructive
        destructive:
          'bg-destructive text-destructive-foreground border-2 border-foreground',
        // Outline - just border
        outline:
          'bg-transparent text-foreground border-2 border-foreground',
        // Success - sage green
        success:
          'bg-success text-success-foreground border-2 border-foreground',
        // Accent - mustard
        accent:
          'bg-accent text-accent-foreground border-2 border-foreground',
        // Warning - same as accent but semantic
        warning:
          'bg-accent text-accent-foreground border-2 border-foreground',
      },
      size: {
        default: 'px-3 py-1 text-sm',
        sm: 'px-2 py-0.5 text-xs',
        lg: 'px-4 py-1.5 text-base',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <div
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Badge };
