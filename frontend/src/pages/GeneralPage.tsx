import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import {
  Button,
  Slider,
  AnimatedCard,
  Alert,
  AlertDescription,
  Input,
  Label,
} from '@/components/ui';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { updateProfile, getUserProfile } from '../api/user';
import type { Gender, Rigor, FrequencyUnit, ProfileFormData } from '../types';

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

const FREQUENCY_UNIT_OPTIONS: { id: FrequencyUnit; labelKey: string }[] = [
  { id: 'day', labelKey: 'general.perDay' },
  { id: 'week', labelKey: 'general.perWeek' },
  { id: 'month', labelKey: 'general.perMonth' },
];

const TOTAL_STEPS = 5;

// Animation variants for step transitions
const stepVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 100 : -100,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -100 : 100,
    opacity: 0,
  }),
};

export function GeneralPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isEditMode = searchParams.get('edit') === 'true';
  const { t } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(1);
  const [direction, setDirection] = useState(0);
  const [formData, setFormData] = useState<ProfileFormData>({
    displayName: '',
    age: null,
    gender: null,
    rigor: null,
    frequency: 3,
    frequencyUnit: 'week',
    levelObjective: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkExistingProfile();
  }, []);

  const checkExistingProfile = async () => {
    try {
      const profile = await getUserProfile();

      // If profile is complete and NOT in edit mode, redirect to appropriate page
      if (profile.profileCompleted && !isEditMode) {
        if (profile.assessed) {
          navigate('/chat', { replace: true });
        } else {
          navigate('/assessment', { replace: true });
        }
        return;
      }

      // Pre-fill the form with existing data (for both new and edit mode)
      if (profile.displayName || profile.age || profile.gender) {
        setFormData({
          displayName: profile.displayName || '',
          age: profile.age || null,
          gender: profile.gender || null,
          rigor: profile.rigor || null,
          frequency: profile.frequency || 3,
          frequencyUnit: profile.frequencyUnit || 'week',
          levelObjective: profile.levelObjective || '',
        });
      }
    } catch {
      // First time user or error, show empty form
    } finally {
      setLoading(false);
    }
  };

  const updateField = <K extends keyof ProfileFormData>(
    field: K,
    value: ProfileFormData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
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
        return !!(formData.frequency && formData.frequencyUnit);
      case 5:
        return true; // Level objective is optional
      default:
        return false;
    }
  };

  const goToNextStep = () => {
    if (currentStep < TOTAL_STEPS && isStepValid(currentStep)) {
      setDirection(1);
      setCurrentStep((prev) => prev + 1);
      setError(null);
    }
  };

  const goToPrevStep = () => {
    if (currentStep > 1) {
      setDirection(-1);
      setCurrentStep((prev) => prev - 1);
      setError(null);
    }
  };

  const handleSubmit = async () => {
    if (!isStepValid(currentStep)) {
      setError(t('general.fillRequired') || 'Please fill in all required fields');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await updateProfile(formData, isEditMode);
      if (isEditMode) {
        navigate('/profile');
      } else {
        navigate('/assessment');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getFrequencyLabel = (value: number): string => {
    if (value === 1) return `1 ${t('general.time')}`;
    return `${value} ${t('general.times')}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        >
          <Loader2 className="h-8 w-8 text-primary" />
        </motion.div>
      </div>
    );
  }

  // Step content renderers
  const renderStep1 = () => (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <motion.img
          src="/imgs/c-notalk.png"
          alt="Lingu"
          className="w-24 h-24 mx-auto mb-4 object-contain"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2 }}
        />
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-muted-foreground"
        >
          {t('general.welcomeMessage') || "Let's get to know you!"}
        </motion.p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">{t('general.nameLabel')} *</Label>
        <Input
          id="name"
          type="text"
          placeholder={t('general.namePlaceholder') || 'Enter your name'}
          value={formData.displayName}
          onChange={(e) => updateField('displayName', e.target.value)}
          autoFocus
        />
      </div>
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-xl font-semibold text-foreground">
          {t('general.aboutYou') || 'Tell us about yourself'}
        </h2>
      </div>

      <div className="space-y-2">
        <Label htmlFor="age">{t('general.ageLabel')} *</Label>
        <Input
          id="age"
          type="number"
          min={1}
          max={120}
          placeholder={t('general.agePlaceholder') || 'Enter your age'}
          value={formData.age || ''}
          onChange={(e) =>
            updateField('age', e.target.value ? parseInt(e.target.value) : null)
          }
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <Label>{t('general.genderLabel')} *</Label>
        <div className="grid grid-cols-2 gap-2">
          {GENDER_OPTIONS.map(({ id, labelKey }) => (
            <Button
              key={id}
              variant="option"
              selected={formData.gender === id}
              onClick={() => updateField('gender', id)}
              className="text-sm"
            >
              {t(labelKey)}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-xl font-semibold text-foreground">
          {t('general.rigorLabel')} *
        </h2>
        <p className="text-sm text-muted-foreground mt-2">
          {t('general.rigorDescription')}
        </p>
      </div>

      <div className="grid gap-3">
        {RIGOR_OPTIONS.map(({ id, labelKey, description }) => (
          <Button
            key={id}
            variant="option"
            selected={formData.rigor === id}
            onClick={() => updateField('rigor', id)}
            className="w-full justify-between h-auto py-4 px-4"
          >
            <span className="font-medium">{t(labelKey)}</span>
            <span className="text-sm text-muted-foreground">{description}</span>
          </Button>
        ))}
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-xl font-semibold text-foreground">
          {t('general.frequencyLabel')} *
        </h2>
        <p className="text-sm text-muted-foreground mt-2">
          {t('general.frequencyDescription')}
        </p>
      </div>

      <div className="space-y-6">
        <div className="px-4">
          <Slider
            min={1}
            max={14}
            value={[formData.frequency || 3]}
            onValueChange={(values) => updateField('frequency', values[0])}
            displayValue={getFrequencyLabel(formData.frequency || 3)}
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          {FREQUENCY_UNIT_OPTIONS.map(({ id, labelKey }) => (
            <Button
              key={id}
              variant="option"
              selected={formData.frequencyUnit === id}
              onClick={() => updateField('frequencyUnit', id)}
            >
              {t(labelKey)}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );

  const renderStep5 = () => (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-xl font-semibold text-foreground">
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
          placeholder={
            t('general.levelObjectivePlaceholder') ||
            'e.g., Pass TOPIK Level 3, Have daily conversations'
          }
          value={formData.levelObjective}
          onChange={(e) => updateField('levelObjective', e.target.value)}
          autoFocus
        />
      </div>

      <p className="text-xs text-muted-foreground text-center">
        {t('general.optionalField') || 'This field is optional'}
      </p>
    </div>
  );

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 1:
        return renderStep1();
      case 2:
        return renderStep2();
      case 3:
        return renderStep3();
      case 4:
        return renderStep4();
      case 5:
        return renderStep5();
      default:
        return null;
    }
  };

  return (
    <AnimatedPage className="min-h-screen flex items-center justify-center p-4">
      <AnimatedCard className="p-8 max-w-md w-full">
        {/* Progress indicator */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-muted-foreground">
              {currentStep} / {TOTAL_STEPS}
            </span>
            {isEditMode && (
              <span className="text-xs text-accent font-medium">
                {t('general.editMode') || 'Edit Mode'}
              </span>
            )}
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${(currentStep / TOTAL_STEPS) * 100}%` }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            />
          </div>
        </div>

        {/* Error message */}
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

        {/* Step content with animation */}
        <div className="min-h-[320px] relative">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={currentStep}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: 'easeInOut' }}
            >
              {renderCurrentStep()}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation buttons */}
        <div className="flex gap-3 mt-8">
          {currentStep > 1 && (
            <Button
              variant="outline"
              onClick={goToPrevStep}
              className="flex-1"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              {t('general.back') || 'Back'}
            </Button>
          )}

          {currentStep < TOTAL_STEPS ? (
            <Button
              onClick={goToNextStep}
              disabled={!isStepValid(currentStep)}
              className="flex-1"
            >
              {t('general.next') || 'Next'}
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              loading={isSubmitting}
              className="flex-1"
            >
              {t('general.continue')}
            </Button>
          )}
        </div>
      </AnimatedCard>
    </AnimatedPage>
  );
}
