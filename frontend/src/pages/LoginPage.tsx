import { useReducer, type FormEvent, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { m, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Loader2, Languages, CheckCircle, Sparkles } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button, Input, Card, Alert, AlertDescription } from '@/components/ui';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { staggerContainer, staggerItem } from '@/lib/animations';
import { getOnboardingDestination } from '@/lib/homeRoutes';

type Mode = 'signin' | 'reset';

type LoginState = {
  mode: Mode;
  email: string;
  password: string;
  submitting: boolean;
  resetSent: boolean;
  resetError: string | null;
};

type LoginAction =
  | { type: 'set-mode'; mode: Mode }
  | { type: 'set-email'; email: string }
  | { type: 'set-password'; password: string }
  | { type: 'submit-start' }
  | { type: 'submit-finished' }
  | { type: 'reset-success' }
  | { type: 'reset-error'; error: string }
  | { type: 'prepare-reset' }
  | { type: 'prepare-signin' };

const initialLoginState: LoginState = {
  mode: 'signin',
  email: '',
  password: '',
  submitting: false,
  resetSent: false,
  resetError: null,
};

function loginReducer(state: LoginState, action: LoginAction): LoginState {
  switch (action.type) {
    case 'set-mode':
      return { ...state, mode: action.mode };
    case 'set-email':
      return { ...state, email: action.email };
    case 'set-password':
      return { ...state, password: action.password };
    case 'submit-start':
      return { ...state, submitting: true };
    case 'submit-finished':
      return { ...state, submitting: false };
    case 'reset-success':
      return { ...state, resetSent: true };
    case 'reset-error':
      return { ...state, resetError: action.error };
    case 'prepare-reset':
      return { ...state, mode: 'reset', resetSent: false, resetError: null, password: '' };
    case 'prepare-signin':
      return { ...state, mode: 'signin', resetSent: false, resetError: null };
    default:
      return state;
  }
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const {
    user,
    loading,
    error,
    signInWithEmail,
    sendPasswordReset,
    signInWithGoogle,
    clearError,
  } = useAuth();

  const [state, dispatch] = useReducer(loginReducer, initialLoginState);
  const { mode, email, password, submitting, resetSent, resetError } = state;

  const intendedFrom = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  const sawLegacyRolePickRef = useRef(false);

  useEffect(() => {
    if (!user) {
      sawLegacyRolePickRef.current = false;
      return;
    }

    if (loading) return;

    const dest = getOnboardingDestination(user);
    if (!dest) {
      if (user.requiresLegacyRolePick) {
        sawLegacyRolePickRef.current = true;
      }
      // Legacy user awaiting modal; stay on /login (modal will cover it).
      return;
    }

    if (sawLegacyRolePickRef.current) {
      navigate(dest, { replace: true });
      return;
    }

    if (intendedFrom) {
      navigate(intendedFrom, { replace: true });
      return;
    }

    navigate(dest, { replace: true });
  }, [user, loading, navigate, intendedFrom]);

  const handleSignIn = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    dispatch({ type: 'submit-start' });
    try {
      await signInWithEmail(email, password);
    } catch {
      // surfaced via context
    } finally {
      dispatch({ type: 'submit-finished' });
    }
  };

  const handleReset = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    dispatch({ type: 'prepare-reset' });
    dispatch({ type: 'submit-start' });
    try {
      await sendPasswordReset(email);
      dispatch({ type: 'reset-success' });
    } catch (err) {
      dispatch({ type: 'reset-error', error: err instanceof Error ? err.message : 'Failed to send reset email' });
    } finally {
      dispatch({ type: 'submit-finished' });
    }
  };

  const handleGoogle = async () => {
    clearError();
    dispatch({ type: 'submit-start' });
    try {
      await signInWithGoogle();
    } catch {
      // surfaced via context
    } finally {
      dispatch({ type: 'submit-finished' });
    }
  };

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

      <div className="w-full max-w-5xl grid lg:grid-cols-2 gap-8 items-center">
        <LoginPromoCard t={t} />
        <LoginAuthCard
          t={t}
          mode={mode}
          email={email}
          password={password}
          submitting={submitting}
          resetSent={resetSent}
          resetError={resetError}
          authError={error}
          onEmailChange={(value) => dispatch({ type: 'set-email', email: value })}
          onPasswordChange={(value) => dispatch({ type: 'set-password', password: value })}
          onSignIn={handleSignIn}
          onReset={handleReset}
          onGoogle={handleGoogle}
          onStartReset={() => {
            dispatch({ type: 'prepare-reset' });
            clearError();
          }}
          onBackToSignIn={() => {
            dispatch({ type: 'prepare-signin' });
            clearError();
          }}
        />
      </div>
    </AnimatedPage>
  );
}

function LoginPromoCard({ t }: { t: (key: string) => string }) {
  const features = [
    t('auth.feature.aiScenarios'),
    t('auth.feature.pronunciation'),
    t('auth.feature.progress'),
  ];

  return (
    <m.div
      initial={{ opacity: 0, x: -30 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="hidden lg:block"
    >
      <Card className="p-10 bg-primary text-primary-foreground border-foreground relative overflow-hidden">
        <div className="absolute -top-8 -right-8 size-32 bg-accent/30 rounded-full" />
        <div className="absolute -bottom-12 -left-12 size-40 bg-background/10 rounded-full" />
        <div className="relative">
          <div className="flex items-center gap-4 mb-8">
            <div className="size-14 rounded-xl bg-background/20 border-2 border-background/30 flex items-center justify-center">
              <Languages size={28} />
            </div>
            <div>
              <p className="text-sm uppercase tracking-wider text-background/70 font-semibold">
                Lingual
              </p>
              <p className="text-2xl font-display font-bold">{t('auth.signInTitle')}</p>
            </div>
          </div>
          <p className="text-xl text-background/90 mb-10 leading-relaxed">
            {t('auth.pickUpWhereLeftOff')}
          </p>
          <div className="space-y-5">
            {features.map((item) => (
              <div key={item} className="flex items-center gap-4">
                <div className="size-8 rounded-lg bg-background/20 flex items-center justify-center flex-shrink-0">
                  <CheckCircle size={18} strokeWidth={2.5} />
                </div>
                <span className="text-background/90 font-medium">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </m.div>
  );
}

type LoginAuthCardProps = LoginState & {
  t: (key: string) => string;
  authError: string | null;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSignIn: (event: FormEvent) => void;
  onReset: (event: FormEvent) => void;
  onGoogle: () => void;
  onStartReset: () => void;
  onBackToSignIn: () => void;
};

function LoginAuthCard({
  t,
  mode,
  email,
  password,
  submitting,
  resetSent,
  resetError,
  authError,
  onEmailChange,
  onPasswordChange,
  onSignIn,
  onReset,
  onGoogle,
  onStartReset,
  onBackToSignIn,
}: LoginAuthCardProps) {
  return (
    <m.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      <Card className="p-8 max-w-md w-full mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <div className="size-12 rounded-xl bg-primary text-primary-foreground border-2 border-foreground flex items-center justify-center shadow-stamp-sm">
            <Languages size={24} strokeWidth={2.5} />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={14} className="text-accent" />
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                {t('auth.welcomeLabel')}
              </p>
            </div>
            <p className="text-xl font-display font-bold">
              {mode === 'reset' ? t('auth.resetTitle') : t('auth.signIn')}
            </p>
            <p className="text-sm text-muted-foreground">
              {mode === 'reset'
                ? t('auth.resetSubtitle')
                : t('auth.signInSubtitle')}
            </p>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {(mode === 'reset' ? resetError : authError) && (
            <m.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6"
            >
              <Alert variant="destructive">
                <AlertDescription>{mode === 'reset' ? resetError : authError}</AlertDescription>
              </Alert>
            </m.div>
          )}
        </AnimatePresence>

        {mode === 'reset' ? (
          <PasswordResetForm
            t={t}
            email={email}
            submitting={submitting}
            resetSent={resetSent}
            onEmailChange={onEmailChange}
            onSubmit={onReset}
            onBackToSignIn={onBackToSignIn}
          />
        ) : (
          <SignInForm
            t={t}
            email={email}
            password={password}
            submitting={submitting}
            onEmailChange={onEmailChange}
            onPasswordChange={onPasswordChange}
            onSubmit={onSignIn}
            onStartReset={onStartReset}
          />
        )}

        {mode === 'signin' && (
          <>
            <div className="my-8 flex items-center gap-4">
              <div className="flex-1 border-t-2 border-border" />
              <span className="text-muted-foreground text-sm font-medium">{t('auth.or')}</span>
              <div className="flex-1 border-t-2 border-border" />
            </div>
            <Button
              type="button"
              variant="google"
              onClick={onGoogle}
              disabled={submitting}
              className="w-full"
            >
              {t('auth.continueWithGoogle')}
            </Button>
            <p className="mt-8 text-center text-muted-foreground">
              {t('auth.noAccount')}{' '}
              <Link
                to="/signup"
                className="text-primary hover:text-primary/80 font-semibold underline underline-offset-4"
              >
                {t('auth.signUp')}
              </Link>
            </p>
          </>
        )}
      </Card>
    </m.div>
  );
}

type PasswordResetFormProps = {
  t: (key: string) => string;
  email: string;
  submitting: boolean;
  resetSent: boolean;
  onEmailChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onBackToSignIn: () => void;
};

function PasswordResetForm({
  t,
  email,
  submitting,
  resetSent,
  onEmailChange,
  onSubmit,
  onBackToSignIn,
}: PasswordResetFormProps) {
  return (
    <m.form
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      onSubmit={onSubmit}
      className="space-y-5"
    >
      <m.div variants={staggerItem}>
        <Input
          type="email"
          label={t('auth.email')}
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder={t('auth.emailPlaceholder')}
          required
          autoComplete="email"
        />
      </m.div>
      {resetSent && (
        <m.div variants={staggerItem}>
          <Alert variant="success">
            <AlertDescription>
              {t('auth.resetSent')}
            </AlertDescription>
          </Alert>
        </m.div>
      )}
      <m.div variants={staggerItem}>
        <Button type="submit" loading={submitting} className="w-full">
          {t('auth.resetSend')}
        </Button>
      </m.div>
      <m.div variants={staggerItem}>
        <Button
          type="button"
          variant="ghost"
          onClick={onBackToSignIn}
          disabled={submitting}
          className="w-full"
        >
          {t('auth.resetBack')}
        </Button>
      </m.div>
    </m.form>
  );
}

type SignInFormProps = {
  t: (key: string) => string;
  email: string;
  password: string;
  submitting: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onStartReset: () => void;
};

function SignInForm({
  t,
  email,
  password,
  submitting,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onStartReset,
}: SignInFormProps) {
  return (
    <m.form
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      onSubmit={onSubmit}
      className="space-y-5"
    >
      <m.div variants={staggerItem}>
        <Input
          type="email"
          label={t('auth.email')}
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder={t('auth.emailPlaceholder')}
          required
          autoComplete="email"
        />
      </m.div>
      <m.div variants={staggerItem}>
        <Input
          type="password"
          label={t('auth.password')}
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          placeholder={t('auth.passwordPlaceholder')}
          required
          minLength={6}
          autoComplete="current-password"
        />
      </m.div>
      <m.div variants={staggerItem} className="-mt-2 text-right">
        <button
          type="button"
          onClick={onStartReset}
          className="text-sm font-semibold text-primary underline underline-offset-4 transition-colors hover:text-primary/80"
        >
          {t('auth.forgotPassword')}
        </button>
      </m.div>
      <m.div variants={staggerItem}>
        <Button type="submit" loading={submitting} className="w-full">
          {t('auth.signIn')}
        </Button>
      </m.div>
    </m.form>
  );
}
