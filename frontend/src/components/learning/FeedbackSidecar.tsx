import type { CoachChip } from '@/api/coachChips';

interface FeedbackSidecarProps {
  chips: CoachChip[];
}

export function FeedbackSidecar({ chips }: FeedbackSidecarProps) {
  if (chips.length === 0) {
    return (
      <div className="feedback-sidecar feedback-sidecar--empty" aria-live="polite">
        <p>No live feedback yet — keep going.</p>
      </div>
    );
  }
  return (
    <div className="feedback-sidecar" aria-live="polite">
      <ul className="feedback-sidecar__list">
        {chips.map((chip) => (
          <li key={chip.turn_index} className="feedback-sidecar__chip">
            <span className="feedback-sidecar__better">{chip.better}</span>
            <span className="feedback-sidecar__utterance">{chip.utterance}</span>
            {chip.why ? <span className="feedback-sidecar__why">{chip.why}</span> : null}
            {chip.confidence_caveat ? <span className="feedback-sidecar__caveat">heard approximately</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
