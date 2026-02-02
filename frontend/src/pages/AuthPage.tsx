import { useState, FormEvent, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Languages } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../contexts/LanguageContext';
import { Button, Input, AnimatedCard, Alert, AlertDescription } from '@/components/ui';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { staggerContainer, staggerItem } from '@/lib/animations';

export function AuthPage() {
  const navigate = useNavigate();
  const { user, loading, error, signInWithEmail, signUpWithEmail, signInWithGoogle, clearError } =
    useAuth();
  const { t } = useLanguage();

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (user && !loading) {
      navigate('/general');
    }
  }, [user, loading, navigate]);

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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        >
          <Loader2 className="h-8 w-8 text-purple-600" />
        </motion.div>
      </div>
    );
  }

  return (
    <AnimatedPage className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-5xl grid lg:grid-cols-2 gap-8 items-center">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="hidden lg:block"
        >
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-purple-600 to-indigo-700 p-10 text-white shadow-xl">
            <div className="absolute -top-16 -right-16 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
            <div className="flex items-center gap-3 mb-8">
              <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center">
                <Languages size={24} />
              </div>
              <div>
                <p className="text-sm uppercase tracking-wide text-white/70">Lingual</p>
                <p className="text-2xl font-bold">Speak with confidence</p>
              </div>
            </div>
            <p className="text-lg text-white/90 mb-8">
              Real conversations, smart feedback, and a learning path tailored to your goals.
            </p>
            <div className="space-y-4 text-sm text-white/80">
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-white" />
                AI-led scenario practice for natural speaking
              </div>
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-white" />
                Immediate feedback on pronunciation and phrasing
              </div>
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-white" />
                Progress tracking aligned with your level
              </div>
            </div>
          </div>
        </motion.div>

        <AnimatedCard className="p-8 max-w-md w-full bg-white border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-purple-600 text-white flex items-center justify-center shadow-md">
              <Languages size={20} />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Welcome</p>
              <p className="text-lg font-semibold text-slate-900">
                {isSignUp ? t('auth.signUpTitle') : t('auth.signInTitle')}
              </p>
              <p className="text-sm text-slate-500">{t('auth.subtitle')}</p>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-4"
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
            className="space-y-4"
          >
            <motion.div variants={staggerItem}>
              <Input
                type="email"
                label={t('auth.email')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                required
                className="bg-slate-50 border-slate-200 focus:border-purple-500 focus:ring-purple-200"
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
                className="bg-slate-50 border-slate-200 focus:border-purple-500 focus:ring-purple-200"
              />
            </motion.div>

            <motion.div variants={staggerItem}>
              <Button type="submit" loading={isSubmitting} className="w-full rounded-xl">
                {isSignUp ? t('auth.signUp') : t('auth.signIn')}
              </Button>
            </motion.div>
          </motion.form>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="my-6 flex items-center"
          >
            <div className="flex-1 border-t border-slate-200" />
            <span className="px-4 text-slate-400 text-sm">{t('auth.or')}</span>
            <div className="flex-1 border-t border-slate-200" />
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
              className="w-full rounded-xl"
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
            className="mt-6 text-center text-slate-500 text-sm"
          >
            {isSignUp ? t('auth.hasAccount') : t('auth.noAccount')}{' '}
            <button
              type="button"
              onClick={toggleMode}
              className="text-purple-600 hover:text-purple-700 font-medium transition-colors"
            >
              {isSignUp ? t('auth.signIn') : t('auth.signUp')}
            </button>
          </motion.p>

          <div className="mt-8 rounded-2xl border border-slate-100 bg-slate-50 p-5">
            <p className="text-sm text-slate-600 italic">“{t('auth.testimonial.quote')}”</p>
            <div className="mt-3 flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-purple-200 text-purple-700 flex items-center justify-center text-xs font-semibold">
                SR
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">{t('auth.testimonial.name')}</p>
                <p className="text-xs text-slate-500">{t('auth.testimonial.role')}</p>
              </div>
            </div>
          </div>
        </AnimatedCard>
      </div>
    </AnimatedPage>
  );
}
