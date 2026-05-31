import { Textarea as TextArea } from '@/components/ui/textarea';

interface TextQuestionProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function TextQuestion({ value, onChange, placeholder }: TextQuestionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
        <span>Your response</span>
        <span>Short answer</span>
      </div>
      <TextArea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || 'Type your answer here...'}
        rows={4}
        className="text-base rounded-2xl"
      />
    </div>
  );
}
