import { useEffect, useReducer } from 'react';
import { useNavigate } from 'react-router-dom';
import { m } from 'framer-motion';
import { Languages, ClipboardCheck, Loader2, ArrowRight } from 'lucide-react';
import { AnimatedPage } from '@/components/layout';
import { Card, Button, Alert, AlertDescription } from '@/components/ui';
import { useLanguage } from '@/contexts/LanguageContext';
import { useLearningLocale } from '@/contexts/LearningLocaleContext';
import { getUserProfile, saveInitialOnboarding } from '@/api/user';
import { useAuth } from '@/hooks/useAuth';
import { getOnboardingDestination, LEARNER_HOME_ROUTE, LEARNER_SETUP_ROUTE } from '@/lib/homeRoutes';
import { LEARNING_LOCALES } from '@/lib/learningLocales';
import type { AssessmentPreference, LearningLocale } from '@/types';

type InitialOnboardingState = {
  loading: boolean;
  saving: boolean;
  error: string | null;
  learningLocale: LearningLocale;
  assessmentPreference: AssessmentPreference | null;
};

type InitialOnboardingAction =
  | { type: 'load-finished' }
  | { type: 'profile-locale'; learningLocale: LearningLocale }
  | { type: 'set-locale'; learningLocale: LearningLocale }
  | { type: 'set-assessment-preference'; assessmentPreference: AssessmentPreference }
  | { type: 'save-start' }
  | { type: 'save-error'; error: string }
  | { type: 'set-error'; error: string | null };

const initialOnboardingState: InitialOnboardingState = {
  loading: true,
  saving: false,
  error: null,
  learningLocale: 'ko-KR',
  assessmentPreference: null,
};

function initialOnboardingReducer(
  state: InitialOnboardingState,
  action: InitialOnboardingAction
): InitialOnboardingState {
  switch (action.type) {
    case 'load-finished':
      return { ...state, loading: false };
    case 'profile-locale':
    case 'set-locale':
      return { ...state, learningLocale: action.learningLocale };
    case 'set-assessment-preference':
      return { ...state, assessmentPreference: action.assessmentPreference };
    case 'save-start':
      return { ...state, saving: true, error: null };
    case 'save-error':
      return { ...state, saving: false, error: action.error };
    case 'set-error':
      return { ...state, error: action.error };
    default:
      return state;
  }
}

export function InitialOnboardingPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { setLearningLocale } = useLearningLocale();
  const { user } = useAuth();
  const [state, dispatch] = useReducer(initialOnboardingReducer, initialOnboardingState);
  const { loading, saving, error, learningLocale, assessmentPreference } = state;

  useEffect(() => {
    let isActive = true;

    const loadProfile = async () => {
      try {
        const onboardingDestination = getOnboardingDestination(user);
        if (onboardingDestination && onboardingDestination !== LEARNER_SETUP_ROUTE) {
          navigate(onboardingDestination, { replace: true });
          return;
        }

        const profile = await getUserProfile();
        if (!isActive) return;

        if (!profile.profileCompleted) {
          navigate(LEARNER_SETUP_ROUTE, { replace: true });
          return;
        }

        if (profile.assessed) {
          navigate(LEARNER_HOME_ROUTE, { replace: true });
          return;
        }

        if (profile.learningLocale) {
          dispatch({ type: 'profile-locale', learningLocale: profile.learningLocale });
        }
      } catch {
        if (isActive) {
          navigate(LEARNER_SETUP_ROUTE, { replace: true });
        }
      } finally {
        if (isActive) dispatch({ type: 'load-finished' });
      }
    };

    loadProfile();

    return () => {
      isActive = false;
    };
  }, [navigate, user]);

  const handleContinue = async () => {
    if (!assessmentPreference) {
      dispatch({
        type: 'set-error',
        error: t('onboarding.initial.errorChoice') || 'Please choose how you want to start.',
      });
      return;
    }

    dispatch({ type: 'save-start' });

    try {
      await saveInitialOnboarding(learningLocale, assessmentPreference);
      setLearningLocale(learningLocale);

      if (assessmentPreference === 'take') {
        navigate('/assessment');
      } else {
        navigate(LEARNER_HOME_ROUTE);
      }
    } catch (err) {
      dispatch({
        type: 'save-error',
        error: err instanceof Error ? err.message : 'Failed to save onboarding preferences.',
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <m.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}>
          <Loader2 className="size-10 text-primary" strokeWidth={3} />
        </m.div>
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
                onClick={() => dispatch({ type: 'set-locale', learningLocale: option.value })}
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
              onClick={() => dispatch({ type: 'set-assessment-preference', assessmentPreference: 'take' })}
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
              onClick={() => dispatch({ type: 'set-assessment-preference', assessmentPreference: 'skip' })}
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
