import { useState } from 'react';
import { postAsk, type AskAnswer } from '@/api/ask';

interface AskPanelProps {
  sessionId: string;
  currentTurnIndex?: number | null;
}

interface AskEntry {
  question: string;
  answer: string;
  kind: AskAnswer['kind'] | 'unavailable';
}

export function AskPanel({ sessionId, currentTurnIndex }: AskPanelProps) {
  const [question, setQuestion] = useState('');
  const [entries, setEntries] = useState<AskEntry[]>([]);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    const q = question.trim();
    if (!q || pending) return;
    setPending(true);
    setQuestion('');
    try {
      const ans = await postAsk(sessionId, q, currentTurnIndex);
      setEntries((prev) => [
        ...prev,
        ans
          ? { question: q, answer: ans.answer, kind: ans.kind }
          : { question: q, answer: "Couldn't help with that right now — try rephrasing.", kind: 'unavailable' },
      ]);
    } catch {
      setEntries((prev) => [
        ...prev,
        { question: q, answer: "Couldn't help with that right now — try rephrasing.", kind: 'unavailable' },
      ]);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="ask-panel" aria-live="polite">
      <ul className="ask-panel__list">
        {entries.map((e, i) => (
          <li key={i} className="ask-panel__entry">
            <span className="ask-panel__question">{e.question}</span>
            <span className="ask-panel__answer">{e.answer}</span>
          </li>
        ))}
      </ul>
      <div className="ask-panel__composer">
        <input
          type="text"
          aria-label="Ask for quick help"
          value={question}
          onChange={(ev) => setQuestion(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === 'Enter') void submit(); }}
          placeholder="Ask for a hint, a word, or a translation…"
        />
        <button type="button" onClick={() => void submit()} disabled={pending}>Ask</button>
      </div>
      <p className="ask-panel__note">Quick help is a scaffold — it isn't graded and doesn't count as your answer.</p>
    </div>
  );
}
