import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { m } from 'framer-motion';
import { ArrowLeft, Loader2, Languages, Sparkles } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button, Card } from '@/components/ui';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { RolePicker, AccountCreator, type SignupRole } from '@/components/signup';
import { getOnboardingDestination, ROLE_PICKER_ROUTE } from '@/lib/homeRoutes';

type Step = 1 | 2;

function parseRoleParam(raw: string | null): SignupRole | null {
  return raw === 'student' || raw === 'teacher' || raw === 'admin' ? raw : null;
}

export function SignupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading } = useAuth();
  const { t } = useLanguage();

  const initialRole = useMemo(() => parseRoleParam(searchParams.get('role')), [searchParams]);
  const [role, setRole] = useState<SignupRole | null>(initialRole);
  const [step, setStep] = useState<Step>(1);

  // Returning users land here only by accident - bounce them through the dispatcher.
  useEffect(() => {
    if (user && !loading) {
      const dest = getOnboardingDestination(user);
      if (dest && dest !== ROLE_PICKER_ROUTE) {
        navigate(dest, { replace: true });
      }
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <m.div
          animate={{ rotate: 360 }}
          transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
        >
          <Loader2 className="size-10 text-primary" strokeWidth={3} />
        </m.div>
      </div>
    );
  }

  return (
    <AnimatedPage className="relative min-h-screen bg-background flex items-center justify-center p-6">
      <button
        type="button"
        onClick={() => navigate('/')}
        className="absolute left-6 top-6 z-10 inline-flex items-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
        aria-label={t('auth.backAriaLabel')}
      >
        <ArrowLeft size={16} strokeWidth={2.5} />
        <span>{t('auth.back')}</span>
      </button>

      <Card className="p-8 w-full max-w-3xl">
        <div className="mb-8 flex items-center gap-4">
          <div className="size-12 rounded-xl bg-primary text-primary-foreground border-2 border-foreground flex items-center justify-center shadow-stamp-sm">
            <Languages size={24} strokeWidth={2.5} />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={14} className="text-accent" />
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                {t('auth.stepOf2').replace('{step}', String(step))}
              </p>
            </div>
            <p className="text-xl font-display font-bold">
              {step === 1 ? t('auth.howAreYouUsing') : t('auth.signUpStep2Title')}
            </p>
            <p className="text-sm text-muted-foreground">
              {step === 1
                ? t('auth.pickOptionBest')
                : t('auth.signUpStep2Subtitle')}
            </p>
          </div>
        </div>

        {step === 1 && (
          <div className="space-y-8">
            <RolePicker value={role} onChange={setRole} />
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => setStep(2)}
                disabled={!role}
              >
                {t('auth.continueToAccountSetup')}
              </Button>
            </div>
            <p className="text-center text-muted-foreground">
              {t('auth.hasAccount')}{' '}
              <Link
                to="/login"
                className="text-primary hover:text-primary/80 font-semibold underline underline-offset-4"
              >
                {t('auth.logIn')}
              </Link>
            </p>
          </div>
        )}

        {step === 2 && role && (
          <div className="space-y-6">
            <AccountCreator
              intendedRole={role}
              onSuccess={() => {
                // Navigation is handled by the useEffect at the top of this component
                // once AuthContext finishes the /api/auth/verify round-trip and updates
                // `user`. We deliberately do NOT navigate here - `user` would still be
                // null at call time because the AuthContext state update hasn't
                // re-rendered this component yet.
              }}
            />
            <button
              type="button"
              onClick={() => setStep(1)}
              className="block w-full text-center text-sm font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
            >
              {t('auth.changeRole')}
            </button>
          </div>
        )}
      </Card>
    </AnimatedPage>
  );
}
