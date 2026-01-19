import { TextArea } from '../common';

interface TextQuestionProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function TextQuestion({ value, onChange, placeholder }: TextQuestionProps) {
  return (
    <TextArea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder || 'Type your answer here...'}
      rows={4}
      className="text-lg"
    />
  );
}
