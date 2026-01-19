import { InputHTMLAttributes } from 'react';

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  min?: number;
  max?: number;
  value: number;
  displayValue?: string;
}

export function Slider({
  label,
  min = 0,
  max = 10,
  value,
  displayValue,
  className = '',
  ...props
}: SliderProps) {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-text mb-2">{label}</label>
      )}
      <div className="flex items-center gap-4">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          className={`flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary ${className}`}
          {...props}
        />
        {displayValue !== undefined && (
          <span className="text-sm font-medium text-text min-w-[60px] text-right">
            {displayValue}
          </span>
        )}
      </div>
    </div>
  );
}
