import * as React from 'react';
import { cn } from '@/lib/utils';

function AlertTitle({ className, children, ref, ...props }: React.ComponentPropsWithRef<'h5'>) {
  return (
    <h5
      ref={ref}
      className={cn(
        'mb-1 font-display font-bold leading-none tracking-tight',
        className
      )}
      {...props}
    >
      {children}
    </h5>
  );
}
AlertTitle.displayName = 'AlertTitle';

export { AlertTitle };
