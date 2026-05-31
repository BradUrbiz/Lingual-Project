import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { m, AnimatePresence } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { Button, AnimatedCard, Alert, AlertDescription } from '@/components/ui';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { staggerContainer, staggerItem } from '@/lib/animations';
import { updateCategories } from '../api/assessment';

const CATEGORY_OPTIONS = [
  { id: 'grammar', labelKey: 'categories.grammar' },
  { id: 'vocabulary', labelKey: 'categories.vocabulary' },
  { id: 'cultural', labelKey: 'categories.cultural' },
  { id: 'pronunciation', labelKey: 'categories.pronunciation' },
];

export function CategoriesPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleCategory = (categoryId: string) => {
    setSelectedCategories((prev) =>
      prev.includes(categoryId)
        ? prev.filter((c) => c !== categoryId)
        : [...prev, categoryId]
    );
  };

  const handleSubmit = async () => {
    if (selectedCategories.length === 0) {
      setError('Please select at least one category');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await updateCategories(selectedCategories);
      navigate('/chat');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save categories');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatedPage className="min-h-screen bg-background flex items-center justify-center p-6">
      <AnimatedCard className="p-8 max-w-lg w-full bg-card border-3 border-foreground shadow-stamp">
        <m.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl font-display font-bold text-center text-foreground mb-3"
        >
          {t('categories.title')}
        </m.h1>
        <m.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center text-sm text-muted-foreground mb-8"
        >
          Pick one or more focus areas so we can personalize your sessions.
        </m.p>

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

        <div className="border-t border-border pt-6">
          <m.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            className="flex flex-wrap gap-3 mb-8"
          >
            {CATEGORY_OPTIONS.map(({ id, labelKey }) => (
              <m.div key={id} variants={staggerItem} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
                <Button
                  variant="option"
                  selected={selectedCategories.includes(id)}
                  onClick={() => toggleCategory(id)}
                  className="rounded-full px-5 border-border bg-card hover:border-primary hover:text-foreground"
                >
                  {t(labelKey)}
                </Button>
              </m.div>
            ))}
          </m.div>

          <m.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <Button
              onClick={handleSubmit}
              loading={isSubmitting}
              disabled={selectedCategories.length === 0}
              className="w-full rounded-xl"
            >
              {t('categories.continue')}
            </Button>
          </m.div>
        </div>
      </AnimatedCard>
    </AnimatedPage>
  );
}
