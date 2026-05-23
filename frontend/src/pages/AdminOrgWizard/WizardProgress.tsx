export interface WizardProgressProps {
  current: number;
  total: number;
}

export function WizardProgress({ current, total }: WizardProgressProps) {
  const dots = [];
  for (let i = 1; i <= total; i++) {
    const state = i < current ? 'done' : i === current ? 'current' : 'todo';
    const color =
      state === 'done' ? 'bg-foreground'
      : state === 'current' ? 'bg-primary'
      : 'bg-muted';
    dots.push(
      <span
        key={i}
        data-testid={`wizard-progress-dot-${i}`}
        data-state={state}
        className={`h-2.5 w-8 rounded-full ${color}`}
        aria-label={`Step ${i} of ${total}`}
      />,
    );
  }
  return (
    <div
      className="flex items-center gap-2"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current}
    >
      {dots}
    </div>
  );
}
