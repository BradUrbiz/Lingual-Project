import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const cardVariants = cva('rounded-2xl bg-card text-card-foreground', {
  variants: {
    variant: {
      // Default - Warm Brutalism with stamp shadow
      default: 'border-3 border-foreground shadow-stamp',
      // Elevated - more prominent shadow
      elevated: 'border-3 border-foreground shadow-[6px_6px_0_0_#2D2A26]',
      // Subtle - softer border
      subtle: 'border-2 border-border shadow-sm',
      // Ghost - minimal
      ghost: 'border border-border/50',
      // Interactive - hover effects
      interactive:
        'border-3 border-foreground shadow-stamp transition-all hover:-translate-y-1 hover:shadow-[8px_8px_0_0_#2D2A26] cursor-pointer',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export interface CardProps
  extends React.ComponentPropsWithRef<'div'>,
    VariantProps<typeof cardVariants> {}

function Card({ className, variant, ref, ...props }: CardProps) {
  return (
    <div
      ref={ref}
      className={cn(cardVariants({ variant }), className)}
      {...props}
    />
  );
}
Card.displayName = 'Card';

function CardHeader({ className, ref, ...props }: React.ComponentPropsWithRef<'div'>) {
  return (
    <div
      ref={ref}
      className={cn('flex flex-col space-y-2 p-6', className)}
      {...props}
    />
  );
}
CardHeader.displayName = 'CardHeader';

function CardTitle({ className, children, ref, ...props }: React.ComponentPropsWithRef<'h3'>) {
  return (
    <h3
      ref={ref}
      className={cn(
        'text-2xl font-display font-bold leading-tight tracking-tight',
        className
      )}
      {...props}
    >
      {children}
    </h3>
  );
}
CardTitle.displayName = 'CardTitle';

function CardDescription({ className, ref, ...props }: React.ComponentPropsWithRef<'p'>) {
  return (
    <p
      ref={ref}
      className={cn('text-base text-muted-foreground', className)}
      {...props}
    />
  );
}
CardDescription.displayName = 'CardDescription';

function CardContent({ className, ref, ...props }: React.ComponentPropsWithRef<'div'>) {
  return <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />;
}
CardContent.displayName = 'CardContent';

function CardFooter({ className, ref, ...props }: React.ComponentPropsWithRef<'div'>) {
  return (
    <div
      ref={ref}
      className={cn('flex items-center p-6 pt-0', className)}
      {...props}
    />
  );
}
CardFooter.displayName = 'CardFooter';

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
};
