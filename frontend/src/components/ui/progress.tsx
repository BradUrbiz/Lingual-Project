/* eslint-disable react-refresh/only-export-components */
import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { motion } from 'framer-motion';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const progressVariants = cva(
  'relative w-full overflow-hidden rounded-xl',
  {
    variants: {
      variant: {
        // Default - Warm Brutalism with border
        default: 'bg-secondary border-2 border-border',
        // Chunky - more prominent
        chunky: 'bg-secondary border-3 border-foreground',
        // Minimal
        minimal: 'bg-muted',
      },
      size: {
        default: 'h-3',
        sm: 'h-2',
        lg: 'h-4',
        xl: 'h-6',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

const indicatorVariants = cva('h-full rounded-lg', {
  variants: {
    color: {
      primary: 'bg-primary',
      accent: 'bg-accent',
      success: 'bg-success',
      destructive: 'bg-destructive',
    },
  },
  defaultVariants: {
    color: 'primary',
  },
});

interface ProgressProps
  extends Omit<React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>, 'color'>,
    VariantProps<typeof progressVariants>,
    VariantProps<typeof indicatorVariants> {
  value?: number;
}

const Progress = React.forwardRef<
  React.ComponentRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, value = 0, variant, size, color, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(progressVariants({ variant, size }), className)}
    {...props}
  >
    <ProgressPrimitive.Indicator asChild>
      <motion.div
        className={cn(indicatorVariants({ color }))}
        initial={{ width: 0 }}
        animate={{ width: `${value}%` }}
        transition={{
          type: 'spring',
          stiffness: 300,
          damping: 30,
        }}
      />
    </ProgressPrimitive.Indicator>
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress, progressVariants };
