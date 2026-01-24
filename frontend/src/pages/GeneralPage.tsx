import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';
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
import { staggerContainer, staggerItem } from '@/lib/animations';
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

export function GeneralPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isEditMode = searchParams.get('edit') === 'true';
  const { t } = useLanguage();

  const [loading, setLoading] = useState(true);
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

  const isFormValid = (): boolean => {
    return !!(
      formData.displayName.trim() &&
      formData.age &&
      formData.age > 0 &&
      formData.gender &&
      formData.rigor &&
      formData.frequency &&
      formData.frequencyUnit
    );
  };

  const handleSubmit = async () => {
    if (!isFormValid()) {
      setError(t('general.fillRequired') || 'Please fill in all required fields');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await updateProfile(formData, isEditMode);
      if (isEditMode) {
        // In edit mode, go back to profile page
        navigate('/profile');
      } else {
        // First time setup, go to assessment
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

  return (
    <AnimatedPage className="min-h-screen flex items-center justify-center p-4">
      <AnimatedCard className="p-8 max-w-lg w-full">
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl font-bold text-center text-accent mb-8"
        >
          {t('general.title')}
        </motion.h1>

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

        <motion.div
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          className="space-y-6"
        >
          {/* Name Input */}
          <motion.div variants={staggerItem} className="space-y-2">
            <Label htmlFor="name">{t('general.nameLabel')} *</Label>
            <Input
              id="name"
              type="text"
              placeholder={t('general.namePlaceholder') || 'Enter your name'}
              value={formData.displayName}
              onChange={(e) => updateField('displayName', e.target.value)}
            />
          </motion.div>

          {/* Age Input */}
          <motion.div variants={staggerItem} className="space-y-2">
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
            />
          </motion.div>

          {/* Gender Selection */}
          <motion.div variants={staggerItem} className="space-y-2">
            <Label>{t('general.genderLabel')} *</Label>
            <div className="flex flex-wrap gap-2">
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
          </motion.div>

          {/* Rigor Selection */}
          <motion.div variants={staggerItem} className="space-y-2">
            <Label>{t('general.rigorLabel')} *</Label>
            <p className="text-sm text-muted-foreground mb-2">
              {t('general.rigorDescription')}
            </p>
            <div className="flex flex-wrap gap-2">
              {RIGOR_OPTIONS.map(({ id, labelKey, description }) => (
                <Button
                  key={id}
                  variant="option"
                  selected={formData.rigor === id}
                  onClick={() => updateField('rigor', id)}
                  className="flex-col h-auto py-2 px-3"
                >
                  <span>{t(labelKey)}</span>
                  <span className="text-xs text-muted-foreground">{description}</span>
                </Button>
              ))}
            </div>
          </motion.div>

          {/* Frequency Selection */}
          <motion.div variants={staggerItem} className="space-y-3">
            <Label>{t('general.frequencyLabel')} *</Label>
            <p className="text-sm text-muted-foreground">
              {t('general.frequencyDescription')}
            </p>

            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Slider
                  min={1}
                  max={14}
                  value={[formData.frequency || 3]}
                  onValueChange={(values) => updateField('frequency', values[0])}
                  displayValue={getFrequencyLabel(formData.frequency || 3)}
                />
              </div>
            </div>

            <div className="flex gap-2">
              {FREQUENCY_UNIT_OPTIONS.map(({ id, labelKey }) => (
                <Button
                  key={id}
                  variant="option"
                  selected={formData.frequencyUnit === id}
                  onClick={() => updateField('frequencyUnit', id)}
                  className="flex-1"
                >
                  {t(labelKey)}
                </Button>
              ))}
            </div>
          </motion.div>

          {/* Level Objective */}
          <motion.div variants={staggerItem} className="space-y-2">
            <Label htmlFor="levelObjective">{t('general.levelObjectiveLabel')}</Label>
            <p className="text-sm text-muted-foreground">
              {t('general.levelObjectiveDescription')}
            </p>
            <Input
              id="levelObjective"
              type="text"
              placeholder={
                t('general.levelObjectivePlaceholder') ||
                'e.g., Pass TOPIK Level 3, Have daily conversations'
              }
              value={formData.levelObjective}
              onChange={(e) => updateField('levelObjective', e.target.value)}
            />
          </motion.div>

          {/* Submit Button */}
          <motion.div variants={staggerItem}>
            <Button
              onClick={handleSubmit}
              loading={isSubmitting}
              disabled={!isFormValid()}
              className="w-full"
            >
              {t('general.continue')}
            </Button>
          </motion.div>
        </motion.div>
      </AnimatedCard>
    </AnimatedPage>
  );
}
