export interface WizardSidebarStep {
  id: number;
  title: string;
  subtitle?: string;
}

export interface WizardSidebarProps {
  steps: WizardSidebarStep[];
  currentStep: number;
}

export function WizardSidebar({ steps, currentStep }: WizardSidebarProps) {
  return (
    <nav aria-label="Wizard steps">
      <ol className="space-y-3">
        {steps.map((s) => {
          const isCurrent = s.id === currentStep;
          const isDone = s.id < currentStep;
          return (
            <li
              key={s.id}
              aria-current={isCurrent ? 'step' : undefined}
              className={
                'flex items-start gap-3 ' +
                (isCurrent
                  ? 'text-foreground font-semibold'
                  : isDone
                    ? 'text-muted-foreground'
                    : 'text-muted-foreground/70')
              }
            >
              <span
                className={
                  'flex h-6 w-6 items-center justify-center rounded-full border text-xs ' +
                  (isCurrent
                    ? 'border-foreground bg-foreground text-background'
                    : isDone
                      ? 'border-foreground/60'
                      : 'border-muted-foreground/40')
                }
              >
                {isDone ? '✓' : s.id}
              </span>
              <div>
                <div className="text-sm">{s.title}</div>
                {s.subtitle && (
                  <div className="text-xs text-muted-foreground">{s.subtitle}</div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
