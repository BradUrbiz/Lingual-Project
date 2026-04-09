import { useState, FormEvent, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Loader2, Languages, CheckCircle, Sparkles } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../contexts/LanguageContext';
import { Button, Input, Card, Alert, AlertDescription } from '@/components/ui';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { staggerContainer, staggerItem } from '@/lib/animations';

export function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading, error, signInWithEmail, signUpWithEmail, signInWithGoogle, clearError } =
    useAuth();
  const { t } = useLanguage();

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Compute the post-login destination based on user role.
  // If the user followed a protected-route redirect, honor that path.
  // Otherwise, route teachers/admins to the teacher dashboard,
  // Lingual admins to the admin panel, and learners to /general.
  const intendedFrom = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;

  useEffect(() => {
    if (user && !loading) {
      if (intendedFrom) {
        navigate(intendedFrom, { replace: true });
        return;
      }
      const userWithFlags = user as { activeRoles?: string[]; lingualAdmin?: boolean };
      const roles = userWithFlags.activeRoles || [];
      if (userWithFlags.lingualAdmin) {
        navigate('/app/admin/school-requests', { replace: true });
      } else if (roles.includes('school_admin') || roles.includes('teacher')) {
        navigate('/app/teacher', { replace: true });
      } else {
        navigate('/general', { replace: true });
      }
    }
  }, [user, loading, navigate, intendedFrom]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    setIsSubmitting(true);

    try {
      if (isSignUp) {
        await signUpWithEmail(email, password);
      } else {
        await signInWithEmail(email, password);
      }
    } catch {
      // Error is handled by context
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    clearError();
    setIsSubmitting(true);

    try {
      await signInWithGoogle();
    } catch {
      // Error is handled by context
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleMode = () => {
    setIsSignUp(!isSignUp);
    clearError();
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
        {/* Marketing Panel - Warm Brutalism */}
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="hidden lg:block"
        >
          <Card className="p-10 bg-primary text-primary-foreground border-foreground relative overflow-hidden">
            {/* Decorative elements */}
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
                  <p className="text-2xl font-display font-bold">Speak with confidence</p>
                </div>
              </div>

              <p className="text-xl text-background/90 mb-10 leading-relaxed">
                Real conversations, smart feedback, and a learning path tailored to your goals.
              </p>

              <div className="space-y-5">
                {[
                  'AI-led scenario practice for natural speaking',
                  'Immediate feedback on pronunciation and phrasing',
                  'Progress tracking aligned with your level',
                ].map((item, idx) => (
                  <motion.div
                    key={item}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + idx * 0.1 }}
                    className="flex items-center gap-4"
                  >
                    <div className="w-8 h-8 rounded-lg bg-background/20 flex items-center justify-center flex-shrink-0">
                      <CheckCircle size={18} strokeWidth={2.5} />
                    </div>
                    <span className="text-background/90 font-medium">{item}</span>
                  </motion.div>
                ))}
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Auth Form - Warm Brutalism */}
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
                  {isSignUp ? t('auth.signUpTitle') : t('auth.signInTitle')}
                </p>
                <p className="text-sm text-muted-foreground">{t('auth.subtitle')}</p>
              </div>
            </div>

            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-6"
                >
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.form
              variants={staggerContainer}
              initial="initial"
              animate="animate"
              onSubmit={handleSubmit}
              className="space-y-5"
            >
              <motion.div variants={staggerItem}>
                <Input
                  type="email"
                  label={t('auth.email')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@example.com"
                  required
                />
              </motion.div>

              <motion.div variants={staggerItem}>
                <Input
                  type="password"
                  label={t('auth.password')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                />
              </motion.div>

              <motion.div variants={staggerItem}>
                <Button type="submit" loading={isSubmitting} className="w-full">
                  {isSignUp ? t('auth.signUp') : t('auth.signIn')}
                </Button>
              </motion.div>
            </motion.form>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="my-8 flex items-center gap-4"
            >
              <div className="flex-1 border-t-2 border-border" />
              <span className="text-muted-foreground text-sm font-medium">{t('auth.or')}</span>
              <div className="flex-1 border-t-2 border-border" />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
            >
              <Button
                type="button"
                variant="google"
                onClick={handleGoogleSignIn}
                disabled={isSubmitting}
                className="w-full"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                {t('auth.continueWithGoogle')}
              </Button>
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="mt-8 text-center text-muted-foreground"
            >
              {isSignUp ? t('auth.hasAccount') : t('auth.noAccount')}{' '}
              <button
                type="button"
                onClick={toggleMode}
                className="text-primary hover:text-primary/80 font-semibold transition-colors underline underline-offset-4"
              >
                {isSignUp ? t('auth.signIn') : t('auth.signUp')}
              </button>
            </motion.p>

          </Card>
        </motion.div>
      </div>
    </AnimatedPage>
  );
}
