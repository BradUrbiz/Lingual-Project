import { TextArea } from '../common';

interface TextQuestionProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function TextQuestion({ value, onChange, placeholder }: TextQuestionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
        <span>Your response</span>
        <span>Short answer</span>
      </div>
      <TextArea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || 'Type your answer here...'}
        rows={4}
        className="text-base bg-slate-50 border-slate-200 focus:border-purple-500 focus:ring-purple-200 rounded-2xl"
      />
    </div>
  );
}
