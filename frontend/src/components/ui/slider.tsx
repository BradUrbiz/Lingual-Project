import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from '@/lib/utils';
import { Label } from './label';

interface SliderProps
  extends React.ComponentPropsWithRef<typeof SliderPrimitive.Root> {
  label?: string;
  displayValue?: string;
}

function Slider({ className, label, displayValue, ref, ...props }: SliderProps) {
  return (
    <div className="w-full">
      {label && <Label>{label}</Label>}
      <div className="flex items-center gap-4">
        <SliderPrimitive.Root
          ref={ref}
          className={cn(
            'relative flex w-full touch-none select-none items-center flex-1',
            className
          )}
          {...props}
        >
          <SliderPrimitive.Track className="relative h-2.5 w-full grow overflow-hidden rounded-full bg-secondary border border-border">
            <SliderPrimitive.Range className="absolute h-full bg-primary" />
          </SliderPrimitive.Track>
          <SliderPrimitive.Thumb className="block size-5 rounded-full border-2 border-foreground bg-primary shadow-stamp-sm ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer" />
        </SliderPrimitive.Root>
        {displayValue !== undefined && (
          <span className="text-xs font-semibold text-primary bg-primary/10 border border-primary/20 px-3 py-1 rounded-full min-w-[72px] text-center">
            {displayValue}
          </span>
        )}
      </div>
    </div>
  );
}
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
