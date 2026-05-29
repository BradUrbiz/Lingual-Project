import { Gauge } from 'lucide-react';
import { clsx } from 'clsx';
import { useLanguage } from '@/contexts/LanguageContext';
import { REALTIME_SPEAKING_SPEED_OPTIONS } from '@/lib/realtimeSpeakingSpeed';

type SpeakingSpeedControlProps = {
  value: number;
  onChange: (speed: number) => void;
  disabled?: boolean;
  className?: string;
};

export function SpeakingSpeedControl({
  value,
  onChange,
  disabled = false,
  className,
}: SpeakingSpeedControlProps) {
  const { t } = useLanguage();

  return (
    <div
      className={clsx('flex min-w-0 flex-wrap items-center gap-2', className)}
      aria-label={t('app.learn.chat.speed.label')}
    >
      <div className="flex h-8 items-center gap-1.5 rounded-xl border-2 border-border bg-background px-2 text-xs font-bold text-muted-foreground">
        <Gauge className="h-3.5 w-3.5" strokeWidth={2.5} />
        <span>{t('app.learn.chat.speed.label')}</span>
      </div>
      <div className="flex rounded-xl border-2 border-border bg-secondary p-1">
        {REALTIME_SPEAKING_SPEED_OPTIONS.map((option) => {
          const isSelected = Math.abs(option.speed - value) < 0.001;
          return (
            <button
              key={option.speed}
              type="button"
              onClick={() => onChange(option.speed)}
              disabled={disabled}
              aria-pressed={isSelected}
              className={clsx(
                'h-7 min-w-12 rounded-lg px-2 text-[11px] font-bold transition-colors',
                isSelected
                  ? 'border-2 border-foreground bg-card text-primary shadow-stamp-sm'
                  : 'border-2 border-transparent text-muted-foreground hover:text-foreground',
                disabled && 'cursor-not-allowed opacity-60 shadow-none',
              )}
            >
              {t(option.labelKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
