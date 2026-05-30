import { useReducer, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { m, AnimatePresence } from 'framer-motion';
import { Loader2, ChevronLeft, ChevronRight, Check, AlertTriangle } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import {
  Button,
  AnimatedCard,
  Alert,
  AlertDescription,
  Input,
  Label,
} from '@/components/ui';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { updateProfile, getUserProfile } from '../api/user';
import type { Gender, Rigor, ProfileFormData } from '../types';
import { useAuth } from '@/hooks/useAuth';
import { getOnboardingDestination, LEARNER_HOME_ROUTE, STUDENT_SETUP_ROUTE } from '@/lib/homeRoutes';
import { AGE_RANGES, ageToRangeLabel } from '@/lib/ageRanges';

const GENDER_OPTIONS: { id: Gender; labelKey: string }[] = [
  { id: 'male', labelKey: 'general.male' },
  { id: 'female', labelKey: 'general.female' },
  { id: 'other', labelKey: 'general.other' },
  { id: 'prefer_not_to_say', labelKey: 'general.preferNotToSay' },
];

const RIGOR_OPTIONS: { id: Rigor; labelKey: string; description: string }[] = [
  { id: 'light', labelKey: 'general.light', description: '10-15 min/session' },
  { id: 'casual', labelKey: 'general.casual', description: '15-30 min/session' },
  { id: 'moderate', labelKey: 'general.moderate', description: '30-45 min/session' },
  { id: 'serious', labelKey: 'general.serious', description: '45-60 min/session' },
  { id: 'intense', labelKey: 'general.intense', description: '60+ min/session' },
];

const TOTAL_STEPS = 4;
const DEFAULT_PROFILE_FORM_DATA: ProfileFormData = {
  displayName: '',
  age: null,
  gender: null,
  rigor: null,
  frequency: 3,
  frequencyUnit: 'week',
  levelObjective: '',
};

type GeneralPageState = {
  loading: boolean;
  currentStep: number;
  direction: number;
  formData: ProfileFormData;
  isSubmitting: boolean;
  error: string | null;
};

type GeneralPageAction =
  | { type: 'loaded'; formData?: ProfileFormData }
  | { type: 'updateField'; field: keyof ProfileFormData; value: ProfileFormData[keyof ProfileFormData] }
  | { type: 'nextStep' }
  | { type: 'previousStep' }
  | { type: 'setSubmitting'; isSubmitting: boolean }
  | { type: 'setError'; error: string | null };

const INITIAL_GENERAL_PAGE_STATE: GeneralPageState = {
  loading: true,
  currentStep: 1,
  direction: 0,
  formData: DEFAULT_PROFILE_FORM_DATA,
  isSubmitting: false,
  error: null,
};

function generalPageReducer(state: GeneralPageState, action: GeneralPageAction): GeneralPageState {
  switch (action.type) {
    case 'loaded':
      return {
        ...state,
        loading: false,
        formData: action.formData ?? state.formData,
      };
    case 'updateField':
      return {
        ...state,
        formData: { ...state.formData, [action.field]: action.value },
      };
    case 'nextStep':
      return {
        ...state,
        direction: 1,
        currentStep: state.currentStep + 1,
        error: null,
      };
    case 'previousStep':
      return {
        ...state,
        direction: -1,
        currentStep: state.currentStep - 1,
        error: null,
      };
    case 'setSubmitting':
      return { ...state, isSubmitting: action.isSubmitting };
    case 'setError':
      return { ...state, error: action.error };
    default:
      return state;
  }
}

// Animation variants for step transitions
const stepVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -80 : 80,
    opacity: 0,
  }),
};

type Translate = ReturnType<typeof useLanguage>['t'];
type UpdateProfileField = <K extends keyof ProfileFormData>(
  field: K,
  value: ProfileFormData[K]
) => void;

function GeneralStepContent({
  currentStep,
  formData,
  updateField,
  t,
}: {
  currentStep: number;
  formData: ProfileFormData;
  updateField: UpdateProfileField;
  t: Translate;
}) {
  switch (currentStep) {
    case 1:
      return (
        <div className="space-y-6">
          <div className="text-center mb-8">
            <m.img
              src="/imgs/c-notalk.png"
              alt="Lingu"
              className="size-24 mx-auto mb-4 object-contain"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2 }}
            />
            <m.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-muted-foreground"
            >
              {t('general.welcomeMessage') || "Let's get to know you!"}
            </m.p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name" className="text-foreground">
              {t('general.nameLabel')} *
            </Label>
            <Input
              id="name"
              type="text"
              placeholder={t('general.namePlaceholder') || 'Enter your name'}
              value={formData.displayName}
              onChange={(e) => updateField('displayName', e.target.value)}
              autoFocus
              className="bg-card border-border focus:border-primary focus:ring-primary/20"
            />
          </div>
        </div>
      );
    case 2:
      return (
        <div className="space-y-6">
          <div className="text-center mb-6">
            <h2 className="text-xl font-display font-semibold text-foreground">
              {t('general.aboutYou')}
            </h2>
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">
              {t('general.ageLabel')} *
            </Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {AGE_RANGES.map((range) => (
                <m.div key={range.midpoint} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
                  <Button
                    variant="option"
                    selected={ageToRangeLabel(formData.age) === range.label}
                    aria-pressed={ageToRangeLabel(formData.age) === range.label}
                    onClick={() => updateField('age', range.midpoint)}
                    className="text-sm"
                  >
                    {t(range.i18nKey)}
                  </Button>
                </m.div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">{t('general.genderLabel')} *</Label>
            <div className="grid grid-cols-2 gap-2">
              {GENDER_OPTIONS.map(({ id, labelKey }) => (
                <m.div key={id} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
                  <Button
                    variant="option"
                    selected={formData.gender === id}
                    onClick={() => updateField('gender', id)}
                    className="text-sm rounded-xl border-border bg-card hover:border-primary hover:text-foreground"
                  >
                    {t(labelKey)}
                  </Button>
                </m.div>
              ))}
            </div>
          </div>
        </div>
      );
    case 3:
      return (
        <div className="space-y-6">
          <div className="text-center mb-6">
            <h2 className="text-xl font-display font-semibold text-foreground">
              {t('general.rigorLabel')} *
            </h2>
            <p className="text-sm text-muted-foreground mt-2">
              {t('general.rigorDescription')}
            </p>
          </div>

          <div className="grid gap-3">
            {RIGOR_OPTIONS.map(({ id, labelKey, description }) => (
              <m.div key={id} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
                <Button
                  variant="option"
                  selected={formData.rigor === id}
                  onClick={() => updateField('rigor', id)}
                  className="w-full justify-between h-auto p-4 rounded-2xl border-border bg-card hover:border-primary"
                >
                  <span className="font-medium">{t(labelKey)}</span>
                  <span className="text-sm text-muted-foreground">{description}</span>
                </Button>
              </m.div>
            ))}
          </div>
        </div>
      );
    case 4:
      return (
        <div className="space-y-6">
          <div className="text-center mb-6">
            <h2 className="text-xl font-display font-semibold text-foreground">
              {t('general.levelObjectiveLabel')}
            </h2>
            <p className="text-sm text-muted-foreground mt-2">
              {t('general.levelObjectiveDescription')}
            </p>
          </div>

          <div className="space-y-2">
            <Input
              id="levelObjective"
              type="text"
              placeholder={t('general.levelObjectivePlaceholder')}
              value={formData.levelObjective}
              onChange={(e) => updateField('levelObjective', e.target.value)}
              autoFocus
              className="bg-card border-border focus:border-primary focus:ring-primary/20"
            />
          </div>

          <p className="text-xs text-muted-foreground text-center">
            {t('general.optionalField') || 'This field is optional'}
          </p>
        </div>
      );
    default:
      return null;
  }
}

export function GeneralPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isEditMode = searchParams.get('edit') === 'true';
  const { t } = useLanguage();
  const { user } = useAuth();

  const [state, dispatch] = useReducer(generalPageReducer, INITIAL_GENERAL_PAGE_STATE);
  const { loading, currentStep, direction, formData, isSubmitting, error } = state;

  const checkExistingProfile = useCallback(async () => {
    try {
      const onboardingDestination = getOnboardingDestination(user);
      if (onboardingDestination && onboardingDestination !== STUDENT_SETUP_ROUTE && !isEditMode) {
        navigate(onboardingDestination, { replace: true });
        return;
      }

      const profile = await getUserProfile();

      // If profile is complete and NOT in edit mode, redirect to appropriate page
      if (profile.profileCompleted && !isEditMode) {
        if (profile.assessed) {
          navigate(LEARNER_HOME_ROUTE, { replace: true });
        } else if (profile.assessmentPreference === 'skip') {
          navigate(LEARNER_HOME_ROUTE, { replace: true });
        } else if (profile.assessmentPreference === 'take') {
          navigate('/assessment', { replace: true });
        } else {
          navigate('/onboarding', { replace: true });
        }
        return;
      }

      // Pre-fill the form with existing data (for both new and edit mode)
      if (profile.displayName || profile.age || profile.gender) {
        dispatch({ type: 'loaded', formData: {
          displayName: profile.displayName || '',
          age: profile.age || null,
          gender: profile.gender || null,
          rigor: profile.rigor || null,
          frequency: profile.frequency || 3,
          frequencyUnit: profile.frequencyUnit || 'week',
          levelObjective: profile.levelObjective || '',
        } });
        return;
      }
    } catch {
      // First time user or error, show empty form
    } finally {
      dispatch({ type: 'loaded' });
    }
  }, [isEditMode, navigate, user]);

  useEffect(() => {
    checkExistingProfile();
  }, [checkExistingProfile]);

  const updateField = <K extends keyof ProfileFormData>(
    field: K,
    value: ProfileFormData[K]
  ) => {
    dispatch({ type: 'updateField', field, value });
  };

  const isStepValid = (step: number): boolean => {
    switch (step) {
      case 1:
        return !!formData.displayName.trim();
      case 2:
        return !!(formData.age && formData.age > 0 && formData.gender);
      case 3:
        return !!formData.rigor;
      case 4:
        return true; // Level objective is optional
      default:
        return false;
    }
  };

  const goToNextStep = () => {
    if (currentStep < TOTAL_STEPS && isStepValid(currentStep)) {
      dispatch({ type: 'nextStep' });
    }
  };

  const goToPrevStep = () => {
    if (currentStep > 1) {
      dispatch({ type: 'previousStep' });
    }
  };

  const handleSubmit = async () => {
    if (!isStepValid(currentStep)) {
      dispatch({
        type: 'setError',
        error: t('general.fillRequired') || 'Please fill in all required fields',
      });
      return;
    }

    dispatch({ type: 'setSubmitting', isSubmitting: true });
    dispatch({ type: 'setError', error: null });

    try {
      await updateProfile(formData, isEditMode);
      if (isEditMode) {
        navigate('/profile');
      } else {
        navigate('/onboarding');
      }
    } catch (err) {
      dispatch({
        type: 'setError',
        error: err instanceof Error ? err.message : 'Failed to save profile',
      });
    } finally {
      dispatch({ type: 'setSubmitting', isSubmitting: false });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <m.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        >
          <Loader2 className="size-8 text-primary" />
        </m.div>
      </div>
    );
  }

  return (
    <AnimatedPage className="min-h-screen bg-background flex items-center justify-center p-6">
      <AnimatedCard className="p-8 max-w-md w-full bg-card border-3 border-foreground shadow-stamp">
        {/* Progress indicator */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Profile Setup</p>
              <p className="text-sm font-semibold text-foreground">
                Step {currentStep} of {TOTAL_STEPS}
              </p>
            </div>
            {isEditMode && (
              <span className="text-xs text-primary font-medium">
                {t('general.editMode') || 'Edit Mode'}
              </span>
            )}
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <m.div
              className="h-full bg-primary rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${(currentStep / TOTAL_STEPS) * 100}%` }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            />
          </div>
          <div className="flex items-center justify-between mt-4">
            {Array.from({ length: TOTAL_STEPS }).map((_, index) => {
              const step = index + 1;
              const isActive = step === currentStep;
              const isComplete = step < currentStep;
              return (
                <div key={step} className="flex flex-col items-center gap-2">
                  <div
                    className={`size-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                      isComplete
                        ? 'bg-primary text-primary-foreground border-2 border-foreground'
                        : isActive
                        ? 'bg-accent/20 text-foreground ring-2 ring-accent/40 border border-accent/40'
                        : 'bg-secondary text-muted-foreground border border-border'
                    }`}
                  >
                    {isComplete ? <Check size={14} /> : step}
                  </div>
                  <span
                    className={`text-[10px] uppercase tracking-wide ${
                      isActive ? 'text-primary' : 'text-muted-foreground'
                    }`}
                  >
                    Step {step}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-t border-border pt-6">
          {/* Error message */}
          <AnimatePresence mode="wait">
            {error && (
              <m.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-4"
              >
                <Alert variant="destructive">
                  <AlertTriangle className="size-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              </m.div>
            )}
          </AnimatePresence>

          {/* Step content with animation */}
          <div className="min-h-[320px] relative">
            <AnimatePresence mode="wait" custom={direction}>
              <m.div
                key={currentStep}
                custom={direction}
                variants={stepVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: 'easeInOut' }}
              >
                <GeneralStepContent
                  currentStep={currentStep}
                  formData={formData}
                  updateField={updateField}
                  t={t}
                />
              </m.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Navigation buttons */}
        <div className="border-t border-border pt-6 flex gap-3 mt-8">
          {currentStep > 1 && (
            <Button
              variant="outline"
              onClick={goToPrevStep}
              className="flex-1 rounded-xl"
            >
              <ChevronLeft className="size-4 mr-1" />
              {t('general.back') || 'Back'}
            </Button>
          )}

          {currentStep < TOTAL_STEPS ? (
            <Button
              onClick={goToNextStep}
              disabled={!isStepValid(currentStep)}
              className="flex-1 rounded-xl"
            >
              {t('general.next') || 'Next'}
              <ChevronRight className="size-4 ml-1" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              loading={isSubmitting}
              className="flex-1 rounded-xl"
            >
              {t('general.continue')}
            </Button>
          )}
        </div>
      </AnimatedCard>
    </AnimatedPage>
  );
}
