import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Languages, ClipboardCheck, Loader2, ArrowRight } from 'lucide-react';
import { AnimatedPage } from '@/components/layout';
import { Card, Button, Alert, AlertDescription } from '@/components/ui';
import { useLanguage } from '@/contexts/LanguageContext';
import { useLearningLocale } from '@/contexts/LearningLocaleContext';
import { getUserProfile, saveInitialOnboarding } from '@/api/user';
import { LEARNING_LOCALES } from '@/lib/learningLocales';
import type { AssessmentPreference, LearningLocale } from '@/types';

export function InitialOnboardingPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { setLearningLocale } = useLearningLocale();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [learningLocale, setLocale] = useState<LearningLocale>('ko-KR');
  const [assessmentPreference, setAssessmentPreference] = useState<AssessmentPreference | null>(null);

  useEffect(() => {
    let isActive = true;

    const loadProfile = async () => {
      try {
        const profile = await getUserProfile();
        if (!isActive) return;

        if (!profile.profileCompleted) {
          navigate('/general', { replace: true });
          return;
        }

        if (profile.assessed) {
          navigate('/app/learn', { replace: true });
          return;
        }

        if (profile.learningLocale) {
          setLocale(profile.learningLocale);
        }
      } catch {
        if (isActive) {
          navigate('/general', { replace: true });
        }
      } finally {
        if (isActive) setLoading(false);
      }
    };

    loadProfile();

    return () => {
      isActive = false;
    };
  }, [navigate]);

  const handleContinue = async () => {
    if (!assessmentPreference) {
      setError(t('onboarding.initial.errorChoice') || 'Please choose how you want to start.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await saveInitialOnboarding(learningLocale, assessmentPreference);
      setLearningLocale(learningLocale);

      if (assessmentPreference === 'take') {
        navigate('/assessment');
      } else {
        navigate('/app/learn');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save onboarding preferences.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}>
          <Loader2 className="h-10 w-10 text-primary" strokeWidth={3} />
        </motion.div>
      </div>
    );
  }

  return (
    <AnimatedPage className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="max-w-2xl w-full p-8 border-3 border-foreground shadow-stamp">
        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('onboarding.initial.kicker') || 'Before You Start'}
          </p>
          <h1 className="text-3xl font-display font-bold text-foreground mt-2">
            {t('onboarding.initial.title') || 'Choose your setup'}
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            {t('onboarding.initial.subtitle') || 'Pick your learning language and decide whether to take the initial assessment now.'}
          </p>
        </header>

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <Languages size={18} className="text-primary" />
            <h2 className="font-display font-bold text-foreground">
              {t('onboarding.initial.languageTitle') || 'Learning language'}
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {LEARNING_LOCALES.map((option) => (
              <button
                type="button"
                key={option.value}
                onClick={() => setLocale(option.value)}
                className={`rounded-2xl border-2 p-4 text-left transition-colors ${
                  learningLocale === option.value
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-card hover:border-primary/50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-semibold text-foreground">{option.label}</span>
                  <span className="text-xl">{option.flag}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {t('onboarding.initial.languageAvailable') || 'Available now'}
                </p>
              </button>
            ))}
          </div>
        </section>

        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <ClipboardCheck size={18} className="text-primary" />
            <h2 className="font-display font-bold text-foreground">
              {t('onboarding.initial.assessmentTitle') || 'Initial assessment'}
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setAssessmentPreference('take')}
              className={`rounded-2xl border-2 p-4 text-left transition-colors ${
                assessmentPreference === 'take'
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-card hover:border-primary/50'
              }`}
            >
              <p className="font-semibold text-foreground">
                {t('onboarding.initial.takeAssessment') || 'Take assessment now'}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                {t('onboarding.initial.takeAssessmentDesc') || 'Get a level estimate and personalized recommendations before starting.'}
              </p>
            </button>
            <button
              type="button"
              onClick={() => setAssessmentPreference('skip')}
              className={`rounded-2xl border-2 p-4 text-left transition-colors ${
                assessmentPreference === 'skip'
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-card hover:border-primary/50'
              }`}
            >
              <p className="font-semibold text-foreground">
                {t('onboarding.initial.skipAssessment') || 'Skip for now'}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                {t('onboarding.initial.skipAssessmentDesc') || 'Start learning immediately. You can take the assessment later.'}
              </p>
            </button>
          </div>
        </section>

        <Button
          onClick={handleContinue}
          loading={saving}
          className="w-full"
        >
          {t('onboarding.initial.continue') || 'Continue'}
          <ArrowRight size={16} className="ml-2" />
        </Button>
      </Card>
    </AnimatedPage>
  );
}
