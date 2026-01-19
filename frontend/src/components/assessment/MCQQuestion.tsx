interface Option {
  id: string;
  text: string;
}

interface MCQQuestionProps {
  options: Option[];
  selectedId: string | null;
  onChange: (id: string) => void;
}

export function MCQQuestion({ options, selectedId, onChange }: MCQQuestionProps) {
  return (
    <div className="space-y-3">
      {options.map((option) => (
        <button
          key={option.id}
          onClick={() => onChange(option.id)}
          className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
            selectedId === option.id
              ? 'bg-primary/10 border-primary text-primary'
              : 'bg-white border-gray-200 hover:border-primary/50 text-text'
          }`}
        >
          {option.text}
        </button>
      ))}
    </div>
  );
}
