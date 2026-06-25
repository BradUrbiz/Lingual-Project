import { GraduationCap, Briefcase, Building2 } from 'lucide-react';
import { Card } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

export type SignupRole = 'student' | 'teacher' | 'admin';

interface RoleOption {
  value: SignupRole;
  titleKey: string;
  subtitleKey: string;
  Icon: typeof GraduationCap;
}

const ROLE_OPTIONS: RoleOption[] = [
  {
    value: 'student',
    titleKey: 'auth.signup.role.studentTitle',
    subtitleKey: 'auth.signup.role.studentSubtitle',
    Icon: GraduationCap,
  },
  {
    value: 'teacher',
    titleKey: 'auth.signup.role.teacherTitle',
    subtitleKey: 'auth.signup.role.teacherSubtitle',
    Icon: Briefcase,
  },
  {
    value: 'admin',
    titleKey: 'auth.signup.role.adminTitle',
    subtitleKey: 'auth.signup.role.adminSubtitle',
    Icon: Building2,
  },
];

export interface RolePickerProps {
  value: SignupRole | null;
  onChange: (role: SignupRole) => void;
  disabled?: boolean;
}

export function RolePicker({ value, onChange, disabled }: RolePickerProps) {
  const { t } = useLanguage();

  return (
    <div role="radiogroup" aria-label={t('auth.signup.role.radioGroupLabel')} className="grid gap-4 md:grid-cols-3">
      {ROLE_OPTIONS.map(({ value: optionValue, titleKey, subtitleKey, Icon }) => {
        const checked = value === optionValue;
        const title = t(titleKey);
        return (
          <label
            key={optionValue}
            className={cn('group cursor-pointer', disabled && 'pointer-events-none opacity-60')}
          >
            <input
              type="radio"
              name="signup-role"
              value={optionValue}
              checked={checked}
              disabled={disabled}
              onChange={() => !disabled && onChange(optionValue)}
              className="sr-only"
              aria-label={title}
            />
            <Card
              className={cn(
                'p-6 transition-all',
                checked
                  ? 'border-primary ring-2 ring-primary/40 shadow-stamp-sm'
                  : 'hover:border-primary/60',
              )}
            >
              <div className="mb-4 flex size-12 items-center justify-center rounded-xl border-2 border-foreground bg-primary/10">
                <Icon size={24} strokeWidth={2} />
              </div>
              <p className="font-display text-lg font-bold">{title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t(subtitleKey)}</p>
            </Card>
          </label>
        );
      })}
    </div>
  );
}
