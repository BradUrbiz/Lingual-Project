import * as React from 'react';
import { cn } from '@/lib/utils';

function AlertDescription({ className, ref, ...props }: React.ComponentPropsWithRef<'div'>) {
  return (
    <div
      ref={ref}
      className={cn('text-sm leading-relaxed [&_p]:leading-relaxed', className)}
      {...props}
    />
  );
}
AlertDescription.displayName = 'AlertDescription';

export { AlertDescription };
