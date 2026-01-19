import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { Button } from '../components/common';
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
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-xl p-8 max-w-lg w-full">
        <h1 className="text-2xl font-bold text-center text-purple-accent mb-8">
          {t('categories.title')}
        </h1>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-3 mb-8">
          {CATEGORY_OPTIONS.map(({ id, labelKey }) => (
            <Button
              key={id}
              variant="option"
              selected={selectedCategories.includes(id)}
              onClick={() => toggleCategory(id)}
            >
              {t(labelKey)}
            </Button>
          ))}
        </div>

        <Button
          onClick={handleSubmit}
          loading={isSubmitting}
          disabled={selectedCategories.length === 0}
          className="w-full"
        >
          {t('categories.continue')}
        </Button>
      </div>
    </div>
  );
}
