import { useState, FormEvent, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Loader2, Languages, CheckCircle, Sparkles } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Button, Input, Card, Alert, AlertDescription } from '@/components/ui';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { staggerContainer, staggerItem } from '@/lib/animations';
import { getOnboardingDestination } from '@/lib/homeRoutes';

type Mode = 'signin' | 'reset';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    user,
    loading,
    error,
    signInWithEmail,
    sendPasswordReset,
    signInWithGoogle,
    clearError,
  } = useAuth();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

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
    setSubmitting(true);
    try {
      await signInWithEmail(email, password);
    } catch {
      // surfaced via context
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    setResetError(null);
    setResetSent(false);
    setSubmitting(true);
    try {
      await sendPasswordReset(email);
      setResetSent(true);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Failed to send reset email');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    clearError();
    setSubmitting(true);
    try {
      await signInWithGoogle();
    } catch {
      // surfaced via context
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
        >
          <Loader2 className="h-10 w-10 text-primary" strokeWidth={3} />
        </motion.div>
      </div>
    );
  }

  return (
    <AnimatedPage className="relative min-h-screen bg-background flex items-center justify-center p-6">
      <button
        type="button"
        onClick={() => navigate('/')}
        className="absolute left-6 top-6 z-10 inline-flex items-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
        aria-label="Back to landing page"
      >
        <ArrowLeft size={16} strokeWidth={2.5} />
        <span>Back</span>
      </button>

      <div className="w-full max-w-5xl grid lg:grid-cols-2 gap-8 items-center">
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="hidden lg:block"
        >
          <Card className="p-10 bg-primary text-primary-foreground border-foreground relative overflow-hidden">
            <div className="absolute -top-8 -right-8 w-32 h-32 bg-accent/30 rounded-full" />
            <div className="absolute -bottom-12 -left-12 w-40 h-40 bg-background/10 rounded-full" />
            <div className="relative">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-14 h-14 rounded-xl bg-background/20 border-2 border-background/30 flex items-center justify-center">
                  <Languages size={28} />
                </div>
                <div>
                  <p className="text-sm uppercase tracking-wider text-background/70 font-semibold">
                    Lingual
                  </p>
                  <p className="text-2xl font-display font-bold">Welcome back</p>
                </div>
              </div>
              <p className="text-xl text-background/90 mb-10 leading-relaxed">
                Pick up where you left off.
              </p>
              <div className="space-y-5">
                {[
                  'Practice with AI scenario partners',
                  'Hear feedback on pronunciation in real time',
                  'Track progress your teacher can see',
                ].map((item) => (
                  <div key={item} className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-lg bg-background/20 flex items-center justify-center flex-shrink-0">
                      <CheckCircle size={18} strokeWidth={2.5} />
                    </div>
                    <span className="text-background/90 font-medium">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <Card className="p-8 max-w-md w-full mx-auto">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 rounded-xl bg-primary text-primary-foreground border-2 border-foreground flex items-center justify-center shadow-stamp-sm">
                <Languages size={24} strokeWidth={2.5} />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles size={14} className="text-accent" />
                  <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    Welcome
                  </p>
                </div>
                <p className="text-xl font-display font-bold">
                  {mode === 'reset' ? 'Reset your password' : 'Sign in'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {mode === 'reset'
                    ? 'Enter your account email and we will send a reset link.'
                    : 'Use your existing Lingual account.'}
                </p>
              </div>
            </div>

            <AnimatePresence mode="wait">
              {(mode === 'reset' ? resetError : error) && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-6"
                >
                  <Alert variant="destructive">
                    <AlertDescription>{mode === 'reset' ? resetError : error}</AlertDescription>
                  </Alert>
                </motion.div>
              )}
            </AnimatePresence>

            {mode === 'reset' ? (
              <motion.form
                variants={staggerContainer}
                initial="initial"
                animate="animate"
                onSubmit={handleReset}
                className="space-y-5"
              >
                <motion.div variants={staggerItem}>
                  <Input
                    type="email"
                    label="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@example.com"
                    required
                    autoComplete="email"
                  />
                </motion.div>
                {resetSent && (
                  <motion.div variants={staggerItem}>
                    <Alert variant="success">
                      <AlertDescription>
                        If that email is registered, a password reset link has been sent.
                      </AlertDescription>
                    </Alert>
                  </motion.div>
                )}
                <motion.div variants={staggerItem}>
                  <Button type="submit" loading={submitting} className="w-full">
                    Send reset link
                  </Button>
                </motion.div>
                <motion.div variants={staggerItem}>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setMode('signin');
                      setResetSent(false);
                      setResetError(null);
                      clearError();
                    }}
                    disabled={submitting}
                    className="w-full"
                  >
                    Back to sign in
                  </Button>
                </motion.div>
              </motion.form>
            ) : (
              <motion.form
                variants={staggerContainer}
                initial="initial"
                animate="animate"
                onSubmit={handleSignIn}
                className="space-y-5"
              >
                <motion.div variants={staggerItem}>
                  <Input
                    type="email"
                    label="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@example.com"
                    required
                    autoComplete="email"
                  />
                </motion.div>
                <motion.div variants={staggerItem}>
                  <Input
                    type="password"
                    label="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    autoComplete="current-password"
                  />
                </motion.div>
                <motion.div variants={staggerItem} className="-mt-2 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('reset');
                      setResetSent(false);
                      setResetError(null);
                      setPassword('');
                      clearError();
                    }}
                    className="text-sm font-semibold text-primary underline underline-offset-4 transition-colors hover:text-primary/80"
                  >
                    Forgot password?
                  </button>
                </motion.div>
                <motion.div variants={staggerItem}>
                  <Button type="submit" loading={submitting} className="w-full">
                    Sign in
                  </Button>
                </motion.div>
              </motion.form>
            )}

            {mode === 'signin' && (
              <>
                <div className="my-8 flex items-center gap-4">
                  <div className="flex-1 border-t-2 border-border" />
                  <span className="text-muted-foreground text-sm font-medium">or</span>
                  <div className="flex-1 border-t-2 border-border" />
                </div>
                <Button
                  type="button"
                  variant="google"
                  onClick={handleGoogle}
                  disabled={submitting}
                  className="w-full"
                >
                  Continue with Google
                </Button>
                <p className="mt-8 text-center text-muted-foreground">
                  Don't have an account?{' '}
                  <Link
                    to="/signup"
                    className="text-primary hover:text-primary/80 font-semibold underline underline-offset-4"
                  >
                    Sign up
                  </Link>
                </p>
              </>
            )}
          </Card>
        </motion.div>
      </div>
    </AnimatedPage>
  );
}
