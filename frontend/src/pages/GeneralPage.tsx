import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { Button, Slider } from '../components/common';
import { updateProfile } from '../api/user';

const GOAL_OPTIONS = [
  { id: 'business', labelKey: 'general.business' },
  { id: 'leisure', labelKey: 'general.leisure' },
  { id: 'academics', labelKey: 'general.academics' },
  { id: 'native', labelKey: 'general.native' },
];

export function GeneralPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const [duration, setDuration] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleGoal = (goalId: string) => {
    setSelectedGoals((prev) =>
      prev.includes(goalId) ? prev.filter((g) => g !== goalId) : [...prev, goalId]
    );
  };

  const getDurationLabel = (value: number): string => {
    if (value === 0) return t('general.notAtAll');
    if (value === 10) return `10+ ${t('general.years')}`;
    return `${value} ${t('general.years')}`;
  };

  const handleSubmit = async () => {
    if (selectedGoals.length === 0) {
      setError('Please select at least one goal');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await updateProfile(selectedGoals, duration);
      navigate('/assessment');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-xl p-8 max-w-lg w-full">
        <h1 className="text-2xl font-bold text-center text-purple-accent mb-8">
          {t('general.title')}
        </h1>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        <div className="mb-8">
          <p className="text-text font-medium mb-4">{t('general.goalsQuestion')}</p>
          <div className="flex flex-wrap gap-3">
            {GOAL_OPTIONS.map(({ id, labelKey }) => (
              <Button
                key={id}
                variant="option"
                selected={selectedGoals.includes(id)}
                onClick={() => toggleGoal(id)}
              >
                {t(labelKey)}
              </Button>
            ))}
          </div>
        </div>

        <div className="mb-8">
          <p className="text-text font-medium mb-4">{t('general.durationQuestion')}</p>
          <Slider
            min={0}
            max={10}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            displayValue={getDurationLabel(duration)}
          />
        </div>

        <Button
          onClick={handleSubmit}
          loading={isSubmitting}
          disabled={selectedGoals.length === 0}
          className="w-full"
        >
          {t('general.continue')}
        </Button>
      </div>
    </div>
  );
}
