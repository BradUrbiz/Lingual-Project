import { useState } from 'react';
import { PostTaskReviewPanel } from './PostTaskReviewPanel';

interface ReviewLauncherProps {
  sessionId: string | null;
  canReview: boolean;       // session ended (voice) or text mode, AND not mid-save
  label: string;            // "See your review" | "Finish & review"
}

export function ReviewLauncher({ sessionId, canReview, label }: ReviewLauncherProps) {
  const [open, setOpen] = useState(false);
  if (!sessionId || !canReview) return null;
  return (
    <div className="review-launcher">
      {!open && <button type="button" onClick={() => setOpen(true)}>{label}</button>}
      {open && <PostTaskReviewPanel sessionId={sessionId} />}
    </div>
  );
}
