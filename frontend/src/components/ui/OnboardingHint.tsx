import { Link } from 'react-router-dom';
import { Lightbulb } from 'lucide-react';

interface OnboardingHintProps {
  show: boolean;
  message: string;
  ctaLabel?: string;
  ctaTo?: string;
}

export function OnboardingHint({ show, message, ctaLabel, ctaTo }: OnboardingHintProps) {
  if (!show) return null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
      <Lightbulb className="size-5 shrink-0" />
      <span className="flex-1">{message}</span>
      {ctaLabel && ctaTo && (
        <Link
          to={ctaTo}
          className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
        >
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}
