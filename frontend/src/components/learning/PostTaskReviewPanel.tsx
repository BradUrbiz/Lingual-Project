import { useEffect, useState } from 'react';
import { getCoachReview, type CoachReview } from '@/api/coachReview';

interface PostTaskReviewPanelProps {
  sessionId: string;
}

type Status = 'loading' | 'ready' | 'empty';

export function PostTaskReviewPanel({ sessionId }: PostTaskReviewPanelProps) {
  const [status, setStatus] = useState<Status>('loading');
  const [review, setReview] = useState<CoachReview | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    getCoachReview(sessionId)
      .then((result) => {
        if (cancelled) return;
        if (result && (result.wins.length > 0 || result.work_on.length > 0)) {
          setReview(result);
          setStatus('ready');
        } else {
          setStatus('empty');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('empty');
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (status === 'loading') {
    return <div className="post-task-review" role="status">Generating your review…</div>;
  }
  if (status === 'empty' || !review) {
    return <div className="post-task-review">No review available for this session.</div>;
  }

  return (
    <div className="post-task-review">
      {review.wins.length > 0 && (
        <section>
          <h3>What went well</h3>
          <ul>{review.wins.map((win, i) => <li key={i}>{win.text}</li>)}</ul>
        </section>
      )}
      {review.work_on.length > 0 && (
        <section>
          <h3>Work on these</h3>
          <ul>
            {review.work_on.map((item, i) => (
              <li key={i}>
                <span className="said">{item.utterance}</span>
                <span className="arrow"> → </span>
                <span className="better">{item.better}</span>
                {item.why && <p className="why">{item.why}</p>}
                {item.target && <span className="target-chip">{item.target}</span>}
                {item.confidence_caveat && <span className="caveat">(heard with low confidence)</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {review.target_coverage.length > 0 && (
        <section>
          <h3>Targets</h3>
          <ul>
            {review.target_coverage.map((c, i) => (
              <li key={i}>{c.surface}: {c.status}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
