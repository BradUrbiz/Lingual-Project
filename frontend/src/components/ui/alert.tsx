import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
export { AlertTitle } from './alert-title';
export { AlertDescription } from './alert-description';

const alertVariants = cva(
  'relative w-full rounded-xl p-4 [&>svg~*]:pl-8 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4',
  {
    variants: {
      variant: {
        // Default - Warm Brutalism
        default:
          'bg-card text-foreground border-3 border-foreground shadow-stamp-sm [&>svg]:text-foreground',
        // Info - subtle
        info:
          'bg-secondary text-foreground border-2 border-border [&>svg]:text-muted-foreground',
        // Destructive - error state
        destructive:
          'bg-destructive/10 text-destructive border-2 border-destructive [&>svg]:text-destructive',
        // Success - sage green
        success:
          'bg-success/10 text-foreground border-2 border-success [&>svg]:text-success',
        // Warning - mustard accent
        warning:
          'bg-accent/10 text-foreground border-2 border-accent [&>svg]:text-accent',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

type AlertProps = React.ComponentPropsWithRef<'div'> & VariantProps<typeof alertVariants>;

function Alert({ className, variant, ref, ...props }: AlertProps) {
  return (
    <div
      ref={ref}
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}
Alert.displayName = 'Alert';

export { Alert };
