import { useState } from 'react';
import type { CoachChip } from '@/api/coachChips';
import { FeedbackSidecar } from './FeedbackSidecar';
import { AskPanel } from './AskPanel';

interface ConversationSidecarProps {
  chips: CoachChip[];
  sessionId: string | null;
  askModeEnabled: boolean;
  currentTurnIndex?: number | null;
}

export function ConversationSidecar({ chips, sessionId, askModeEnabled, currentTurnIndex }: ConversationSidecarProps) {
  const [mode, setMode] = useState<'feedback' | 'ask'>('feedback');

  if (!askModeEnabled || !sessionId) {
    return <FeedbackSidecar chips={chips} />;
  }

  return (
    <div className="conversation-sidecar">
      <div className="conversation-sidecar__tabs" role="tablist">
        <button type="button" aria-pressed={mode === 'feedback'} onClick={() => setMode('feedback')}>Feedback</button>
        <button type="button" aria-pressed={mode === 'ask'} onClick={() => setMode('ask')}>Ask</button>
      </div>
      {mode === 'feedback'
        ? <FeedbackSidecar chips={chips} />
        : <AskPanel sessionId={sessionId} currentTurnIndex={currentTurnIndex} />}
    </div>
  );
}
