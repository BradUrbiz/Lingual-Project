import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { Button, ProgressBar, LanguageToggle, LoadingSpinner } from '../components/common';
import { MCQQuestion, TextQuestion, AudioQuestion } from '../components/assessment';
import {
  getAssessmentItems,
  submitAssessmentResponse,
  skipAssessmentQuestion,
} from '../api/assessment';
import type { AssessmentItem } from '../types';

export function AssessmentPage() {
  const navigate = useNavigate();
  const { lang, t } = useLanguage();

  const [items, setItems] = useState<AssessmentItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Response state
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [textAnswer, setTextAnswer] = useState('');
  const [audioTranscript, setAudioTranscript] = useState('');

  useEffect(() => {
    loadAssessment();
  }, []);

  const loadAssessment = async () => {
    try {
      const data = await getAssessmentItems();
      setItems(data.items);
      setCurrentIndex(data.currentIndex);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load assessment');
    } finally {
      setLoading(false);
    }
  };

  const currentItem = items[currentIndex];

  const getResponse = (): string => {
    if (!currentItem) return '';

    switch (currentItem.item_type) {
      case 'mcq_single':
        return selectedOption || '';
      case 'text_short':
        return textAnswer;
      case 'audio_read':
        return audioTranscript;
      default:
        return '';
    }
  };

  const resetResponse = () => {
    setSelectedOption(null);
    setTextAnswer('');
    setAudioTranscript('');
  };

  const handleSubmit = async () => {
    if (!currentItem) return;

    setSubmitting(true);
    setError(null);

    try {
      const result = await submitAssessmentResponse(currentItem.id, getResponse());

      if (result.isComplete) {
        navigate('/categories');
      } else {
        setCurrentIndex(result.nextIndex);
        resetResponse();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit response');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = async () => {
    if (!currentItem) return;

    setSubmitting(true);
    setError(null);

    try {
      const result = await skipAssessmentQuestion(currentItem.id);

      if (result.isComplete) {
        navigate('/categories');
      } else {
        setCurrentIndex(result.nextIndex);
        resetResponse();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to skip question');
    } finally {
      setSubmitting(false);
    }
  };

  const getPrompt = (): string => {
    if (!currentItem) return '';
    return lang === 'ko' ? currentItem.ui.prompt_ko : currentItem.ui.prompt_en;
  };

  const getInstructions = (): string | undefined => {
    if (!currentItem) return undefined;
    return lang === 'ko' ? currentItem.ui.instructions_ko : currentItem.ui.instructions_en;
  };

  const canSubmit = (): boolean => {
    if (!currentItem) return false;

    switch (currentItem.item_type) {
      case 'mcq_single':
        return selectedOption !== null;
      case 'text_short':
        return textAnswer.trim().length > 0;
      case 'audio_read':
        return audioTranscript.length > 0;
      default:
        return false;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!currentItem) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-text mb-4">No assessment items found</p>
          <Button onClick={() => navigate('/general')}>Go Back</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-xl p-8 max-w-2xl w-full">
        <div className="flex justify-between items-center mb-6">
          <span className="text-text-secondary">
            {t('assessment.progress')} {currentIndex + 1} {t('assessment.of')} {items.length}
          </span>
          <LanguageToggle />
        </div>

        <ProgressBar current={currentIndex + 1} total={items.length} className="mb-6" />

        <div className="mb-2">
          <span className="inline-block px-3 py-1 bg-purple-100 text-purple-accent rounded-full text-sm">
            {currentItem.section}
          </span>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        <div className="mb-6">
          <p className="text-xl text-text mb-2">{getPrompt()}</p>
          {getInstructions() && (
            <p className="text-text-secondary text-sm italic">{getInstructions()}</p>
          )}
          {currentItem.ui.context && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
              <pre className="text-text whitespace-pre-wrap font-sans">
                {currentItem.ui.context}
              </pre>
            </div>
          )}
        </div>

        <div className="mb-8">
          {currentItem.item_type === 'mcq_single' && currentItem.content.options && (
            <MCQQuestion
              options={currentItem.content.options}
              selectedId={selectedOption}
              onChange={setSelectedOption}
            />
          )}

          {currentItem.item_type === 'text_short' && (
            <TextQuestion value={textAnswer} onChange={setTextAnswer} />
          )}

          {currentItem.item_type === 'audio_read' && (
            <AudioQuestion
              wordList={currentItem.content.word_list}
              sentences={currentItem.content.sentences}
              onTranscriptChange={setAudioTranscript}
            />
          )}
        </div>

        <div className="flex gap-4">
          <Button variant="secondary" onClick={handleSkip} disabled={submitting} className="flex-1">
            {t('assessment.skip')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit() || submitting}
            loading={submitting}
            className="flex-1"
          >
            {t('assessment.next')}
          </Button>
        </div>
      </div>
    </div>
  );
}
