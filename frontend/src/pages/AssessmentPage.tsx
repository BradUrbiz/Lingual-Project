import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, AlertTriangle, Info, Lightbulb } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { Button, Progress, Badge, AnimatedCard, Alert, AlertDescription } from '@/components/ui';
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
  const domainLabels: Record<string, string> = {
    grammar: 'Grammar',
    vocabulary: 'Vocabulary',
    pragmatics: 'Pragmatics',
    pronunciation: 'Pronunciation',
  };

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

  const countWords = (value: string): number =>
    value.trim().split(/\s+/).filter(Boolean).length;
  const formatSectionLabel = (value: string): string =>
    value
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());

  const getItemTypeLabel = (): string => {
    if (!currentItem) return 'Question';
    switch (currentItem.item_type) {
      case 'mcq_single':
        return 'Multiple choice';
      case 'text_short':
        return 'Short answer';
      case 'audio_read':
        return 'Read aloud';
      default:
        return 'Question';
    }
  };

  const getItemTips = (): string[] => {
    if (!currentItem) return [];
    const tips: string[] = [];
    const domainEntries = Object.entries(currentItem.domains || {});
    const topDomain = domainEntries.sort((a, b) => b[1] - a[1])[0];

    if (topDomain && topDomain[1] > 0) {
      tips.push(`Focus: ${domainLabels[topDomain[0]] || topDomain[0]}`);
    } else if (currentItem.section) {
      tips.push(`Section: ${formatSectionLabel(currentItem.section)}`);
    }

    if (currentItem.item_type === 'mcq_single') {
      const optionCount = currentItem.content.options?.length ?? 0;
      if (optionCount > 0) tips.push(`${optionCount} answer choices`);
    }

    if (currentItem.item_type === 'text_short') {
      const promptWords = countWords(getPrompt());
      if (promptWords > 0) tips.push(`Prompt: ${promptWords} words`);
    }

    if (currentItem.item_type === 'audio_read') {
      const sentences = currentItem.content.sentences ?? [];
      const wordCount = countWords(sentences.join(' '));
      if (sentences.length > 0) tips.push(`${sentences.length} sentences to read`);
      if (wordCount > 0) tips.push(`~${wordCount} words total`);
    }

    if (currentItem.ui.context) {
      const contextWords = countWords(currentItem.ui.context);
      if (contextWords > 0) tips.push(`Context: ${contextWords} words`);
    }

    const baseTips =
      currentItem.item_type === 'mcq_single'
        ? ['Scan for key words before choosing.', 'Eliminate one option first.']
        : currentItem.item_type === 'text_short'
        ? ['Use 1–2 complete sentences.', 'Focus on clarity over length.']
        : currentItem.item_type === 'audio_read'
        ? ['Speak naturally and pause at commas.', 'Re-record if you stumble.']
        : [];

    const merged = Array.from(new Set([...tips, ...baseTips]));
    return merged.slice(0, 4);
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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        >
          <Loader2 className="h-12 w-12 text-purple-600" />
        </motion.div>
      </div>
    );
  }

  if (!currentItem) {
    return (
      <AnimatedPage className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-900 mb-4">No assessment items found</p>
          <Button onClick={() => navigate('/general')}>Go Back</Button>
        </div>
      </AnimatedPage>
    );
  }

  const progressValue = ((currentIndex + 1) / items.length) * 100;

  return (
    <AnimatedPage className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <AnimatedCard className="p-8 max-w-2xl w-full bg-white border border-slate-200 shadow-sm">
        <div className="border-b border-slate-100 pb-6 mb-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Diagnostic</p>
              <h1 className="text-2xl font-bold text-slate-900">Placement Check‑in</h1>
              <p className="text-sm text-slate-500 mt-1">
                Answer a few quick questions to calibrate your level.
              </p>
            </div>
            <LanguageToggle />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
              <span>
                {t('assessment.progress')} {currentIndex + 1} {t('assessment.of')} {items.length}
              </span>
              <span>{Math.round(progressValue)}% complete</span>
            </div>
            <Progress value={progressValue} />
          </div>

          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <Badge
              variant="accent"
              className="bg-purple-50 text-purple-700 border border-purple-100"
            >
              {currentItem.section}
            </Badge>
          </motion.div>
        </div>

        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-4"
            >
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="border-t border-slate-100 pt-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div>
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentIndex}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                  className="mb-6"
                >
                  <p className="text-xl text-slate-900 mb-2">{getPrompt()}</p>
                  {currentItem.ui.context && (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 relative overflow-hidden">
                      <div className="absolute left-0 top-4 bottom-4 w-1 bg-purple-200 rounded-full" />
                      <div className="pl-4">
                        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-400 mb-2">
                          <Info className="h-3.5 w-3.5" />
                          Context
                        </div>
                        <pre className="text-slate-900 whitespace-pre-wrap font-sans text-sm leading-relaxed">
                          {currentItem.ui.context}
                        </pre>
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>

              <AnimatePresence mode="wait">
                <motion.div
                  key={`answer-${currentIndex}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3, delay: 0.1 }}
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

            <div className="lg:pt-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-4">
                <div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wide text-slate-400">
                      Instructions
                    </p>
                    <span className="text-[10px] font-semibold text-slate-500 bg-white px-2 py-0.5 rounded-full border border-slate-200">
                      {getItemTypeLabel()}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 mt-2">
                    {getInstructions() || 'Answer clearly and keep your response concise.'}
                  </p>
                </div>
                {getItemTips().length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-400">
                      <Lightbulb className="h-3.5 w-3.5" />
                      Tips
                    </div>
                    <div className="mt-2 space-y-2 text-sm text-slate-600">
                      {getItemTips().map((tip) => (
                        <div key={tip} className="flex items-start gap-2">
                          <span className="mt-1 h-2 w-2 rounded-full bg-purple-500" />
                          {tip}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex gap-4"
        >
          <Button
            variant="secondary"
            onClick={handleSkip}
            disabled={submitting}
            className="flex-1 rounded-xl"
          >
            {t('assessment.skip')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit() || submitting}
            loading={submitting}
            className="flex-1 rounded-xl"
          >
            {t('assessment.next')}
          </Button>
        </motion.div>
      </AnimatedCard>
    </AnimatedPage>
  );
}
