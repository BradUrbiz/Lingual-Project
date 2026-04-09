import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, AlertTriangle, Info, BookOpen } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { Button, Progress, Badge, Card, Alert, AlertDescription } from '@/components/ui';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { LanguageToggle } from '../components/common';
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

  const formatSectionLabel = (value: string): string => {
    if (value === 'self_assessment' || value === 'self_assesment') {
      return 'Self Assesment';
    }
    return value
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
        >
          <Loader2 className="h-12 w-12 text-primary" strokeWidth={3} />
        </motion.div>
      </div>
    );
  }

  if (!currentItem) {
    return (
      <AnimatedPage className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="p-8 text-center">
          <p className="text-foreground font-display font-bold text-xl mb-4">
            No assessment items found
          </p>
          <Button onClick={() => navigate('/general')}>Go Back</Button>
        </Card>
      </AnimatedPage>
    );
  }

  const progressValue = ((currentIndex + 1) / items.length) * 100;

  return (
    <AnimatedPage className="min-h-screen bg-background overflow-y-auto py-8 px-6">
      <Card className="p-8 max-w-3xl w-full mx-auto">
        {/* Header */}
        <div className="border-b-2 border-border pb-6 mb-6 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-accent text-accent-foreground border-2 border-foreground flex items-center justify-center shadow-stamp-sm">
                <BookOpen size={24} strokeWidth={2.5} />
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  Diagnostic
                </p>
                <h1 className="text-2xl font-display font-bold">Placement Check‑in</h1>
                <p className="text-muted-foreground mt-1">
                  Answer a few quick questions to calibrate your level.
                </p>
              </div>
            </div>
            <LanguageToggle />
          </div>

          {/* Progress */}
          <div>
            <div className="flex items-center justify-between text-sm text-muted-foreground mb-3 font-medium">
              <span>
                {t('assessment.progress')} {currentIndex + 1} {t('assessment.of')} {items.length}
              </span>
              <span>{Math.round(progressValue)}% complete</span>
            </div>
            <Progress value={progressValue} variant="chunky" size="lg" />
          </div>

          {/* Section Badge */}
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <Badge variant="accent" size="lg">
              {formatSectionLabel(currentItem.section)}
            </Badge>
          </motion.div>
        </div>

        {/* Error Alert */}
        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6"
            >
              <Alert variant="destructive">
                <AlertTriangle className="h-5 w-5" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Content */}
        <div className="border-t-2 border-border pt-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentIndex}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="mb-6"
            >
              <p className="text-xl font-display font-semibold text-foreground mb-4">
                {getPrompt()}
              </p>
              {currentItem.ui.context && (
                <div className="mt-4 rounded-xl border-2 border-border bg-secondary p-4 relative overflow-hidden">
                  <div className="absolute left-0 top-3 bottom-3 w-1 bg-primary rounded-full" />
                  <div className="pl-4">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                      <Info className="h-4 w-4" />
                      Context
                    </div>
                    <pre className="text-foreground whitespace-pre-wrap font-body text-base leading-relaxed">
                      {currentItem.ui.context}
                    </pre>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Answer Input */}
          <AnimatePresence mode="wait">
            <motion.div
              key={`answer-${currentIndex}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30, delay: 0.1 }}
              className="mb-8"
            >
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
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Action Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex gap-4 mt-6"
        >
          <Button
            variant="outline"
            onClick={handleSkip}
            disabled={submitting}
            className="flex-1"
          >
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
        </motion.div>
      </Card>
    </AnimatedPage>
  );
}
