import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from '@/lib/utils';
import { Label } from './label';

interface SliderProps
  extends React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {
  label?: string;
  displayValue?: string;
}

const Slider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  SliderProps
>(({ className, label, displayValue, ...props }, ref) => (
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
        <SliderPrimitive.Track className="relative h-2.5 w-full grow overflow-hidden rounded-full bg-slate-200">
          <SliderPrimitive.Range className="absolute h-full bg-gradient-to-r from-purple-500 to-indigo-500" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block h-5 w-5 rounded-full border-2 border-white bg-purple-600 shadow-lg ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-200 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer" />
      </SliderPrimitive.Root>
      {displayValue !== undefined && (
        <span className="text-xs font-semibold text-purple-700 bg-purple-50 px-3 py-1 rounded-full min-w-[72px] text-center">
          {displayValue}
        </span>
      )}
    </div>
  </div>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
