import { useReducer, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { m, AnimatePresence } from 'framer-motion';
import { Loader2, AlertTriangle, Info, BookOpen } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { Button, Progress, Badge, Card, Alert, AlertDescription } from '@/components/ui';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { LanguageToggle } from '../components/common/LanguageToggle';
import { MCQQuestion } from '../components/assessment/MCQQuestion';
import { TextQuestion } from '../components/assessment/TextQuestion';
import { AudioQuestion } from '../components/assessment/AudioQuestion';
import {
  getAssessmentItems,
  submitAssessmentResponse,
  skipAssessmentQuestion,
} from '../api/assessment';
import type { AssessmentItem } from '../types';

const formatSectionLabel = (value: string): string => {
  if (value === 'self_assessment' || value === 'self_assesment') {
    return 'Self Assesment';
  }
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

type AssessmentPageState = {
  items?: AssessmentItem[];
  currentIndex: number;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  selectedOption: string | null;
  textAnswer: string;
  audioTranscript: string;
};

type AssessmentPageAction =
  | { type: 'loaded'; items: AssessmentItem[]; currentIndex: number }
  | { type: 'failed'; error: string }
  | { type: 'setSubmitting'; submitting: boolean }
  | { type: 'setError'; error: string | null }
  | { type: 'nextQuestion'; currentIndex: number }
  | { type: 'setSelectedOption'; selectedOption: string | null }
  | { type: 'setTextAnswer'; textAnswer: string }
  | { type: 'setAudioTranscript'; audioTranscript: string };

const INITIAL_ASSESSMENT_PAGE_STATE: AssessmentPageState = {
  currentIndex: 0,
  loading: true,
  submitting: false,
  error: null,
  selectedOption: null,
  textAnswer: '',
  audioTranscript: '',
};

function assessmentPageReducer(
  state: AssessmentPageState,
  action: AssessmentPageAction
): AssessmentPageState {
  switch (action.type) {
    case 'loaded':
      return {
        ...state,
        items: action.items,
        currentIndex: action.currentIndex,
        loading: false,
      };
    case 'failed':
      return { ...state, error: action.error, loading: false };
    case 'setSubmitting':
      return { ...state, submitting: action.submitting };
    case 'setError':
      return { ...state, error: action.error };
    case 'nextQuestion':
      return {
        ...state,
        currentIndex: action.currentIndex,
        selectedOption: null,
        textAnswer: '',
        audioTranscript: '',
      };
    case 'setSelectedOption':
      return { ...state, selectedOption: action.selectedOption };
    case 'setTextAnswer':
      return { ...state, textAnswer: action.textAnswer };
    case 'setAudioTranscript':
      return { ...state, audioTranscript: action.audioTranscript };
    default:
      return state;
  }
}

type AssessmentHeaderProps = {
  currentIndex: number;
  totalItems: number;
  progressValue: number;
  progressLabel: string;
  ofLabel: string;
  section: string;
};

function AssessmentHeader({
  currentIndex,
  totalItems,
  progressValue,
  progressLabel,
  ofLabel,
  section,
}: AssessmentHeaderProps) {
  return (
    <div className="border-b-2 border-border pb-6 mb-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="size-12 rounded-xl bg-accent text-accent-foreground border-2 border-foreground flex items-center justify-center shadow-stamp-sm">
            <BookOpen size={24} strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Diagnostic
            </p>
            <h1 className="text-2xl font-display font-bold">Placement Check-in</h1>
            <p className="text-muted-foreground mt-1">
              Answer a few quick questions to calibrate your level.
            </p>
          </div>
        </div>
        <LanguageToggle />
      </div>

      <div>
        <div className="flex items-center justify-between text-sm text-muted-foreground mb-3 font-medium">
          <span>
            {progressLabel} {currentIndex + 1} {ofLabel} {totalItems}
          </span>
          <span>{Math.round(progressValue)}% complete</span>
        </div>
        <Progress value={progressValue} variant="chunky" size="lg" />
      </div>

      <m.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
      >
        <Badge variant="accent" size="lg">
          {formatSectionLabel(section)}
        </Badge>
      </m.div>
    </div>
  );
}

type AssessmentQuestionContentProps = {
  currentIndex: number;
  currentItem: AssessmentItem;
  prompt: string;
  selectedOption: string | null;
  textAnswer: string;
  onSelectedOptionChange: (selectedOption: string | null) => void;
  onTextAnswerChange: (textAnswer: string) => void;
  onAudioTranscriptChange: (audioTranscript: string) => void;
};

function AssessmentQuestionContent({
  currentIndex,
  currentItem,
  prompt,
  selectedOption,
  textAnswer,
  onSelectedOptionChange,
  onTextAnswerChange,
  onAudioTranscriptChange,
}: AssessmentQuestionContentProps) {
  return (
    <div className="border-t-2 border-border pt-6">
      <AnimatePresence mode="wait">
        <m.div
          key={currentIndex}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="mb-6"
        >
          <p className="text-xl font-display font-semibold text-foreground mb-4">
            {prompt}
          </p>
          {currentItem.ui.context && (
            <div className="mt-4 rounded-xl border-2 border-border bg-secondary p-4 relative overflow-hidden">
              <div className="absolute left-0 top-3 bottom-3 w-1 bg-primary rounded-full" />
              <div className="pl-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                  <Info className="size-4" />
                  Context
                </div>
                <pre className="text-foreground whitespace-pre-wrap font-body text-base leading-relaxed">
                  {currentItem.ui.context}
                </pre>
              </div>
            </div>
          )}
        </m.div>
      </AnimatePresence>

      <AnimatePresence mode="wait">
        <m.div
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
              onChange={onSelectedOptionChange}
            />
          )}

          {currentItem.item_type === 'text_short' && (
            <TextQuestion
              value={textAnswer}
              onChange={onTextAnswerChange}
            />
          )}

          {currentItem.item_type === 'audio_read' && (
            <AudioQuestion
              wordList={currentItem.content.word_list}
              sentences={currentItem.content.sentences}
              onTranscriptChange={onAudioTranscriptChange}
            />
          )}
        </m.div>
      </AnimatePresence>
    </div>
  );
}

type AssessmentActionsProps = {
  skipLabel: string;
  nextLabel: string;
  submitting: boolean;
  canSubmit: boolean;
  onSkip: () => void;
  onSubmit: () => void;
};

function AssessmentActions({
  skipLabel,
  nextLabel,
  submitting,
  canSubmit,
  onSkip,
  onSubmit,
}: AssessmentActionsProps) {
  return (
    <m.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="flex gap-4 mt-6"
    >
      <Button
        variant="outline"
        onClick={onSkip}
        disabled={submitting}
        className="flex-1"
      >
        {skipLabel}
      </Button>
      <Button
        onClick={onSubmit}
        disabled={!canSubmit || submitting}
        loading={submitting}
        className="flex-1"
      >
        {nextLabel}
      </Button>
    </m.div>
  );
}

export function AssessmentPage() {
  const navigate = useNavigate();
  const { lang, t } = useLanguage();

  const [state, dispatch] = useReducer(
    assessmentPageReducer,
    INITIAL_ASSESSMENT_PAGE_STATE
  );
  const {
    items,
    currentIndex,
    loading,
    submitting,
    error,
    selectedOption,
    textAnswer,
    audioTranscript,
  } = state;

  useEffect(() => {
    loadAssessment();
  }, []);

  const loadAssessment = async () => {
    try {
      const data = await getAssessmentItems();
      dispatch({ type: 'loaded', items: data.items, currentIndex: data.currentIndex });
    } catch (err) {
      dispatch({
        type: 'failed',
        error: err instanceof Error ? err.message : 'Failed to load assessment',
      });
    }
  };

  const assessmentItems = items ?? [];
  const currentItem = assessmentItems[currentIndex];

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

  const handleSubmit = async () => {
    if (!currentItem) return;

    dispatch({ type: 'setSubmitting', submitting: true });
    dispatch({ type: 'setError', error: null });

    try {
      const result = await submitAssessmentResponse(currentItem.id, getResponse());

      if (result.isComplete) {
        navigate('/categories');
      } else {
        dispatch({ type: 'nextQuestion', currentIndex: result.nextIndex });
      }
    } catch (err) {
      dispatch({
        type: 'setError',
        error: err instanceof Error ? err.message : 'Failed to submit response',
      });
    } finally {
      dispatch({ type: 'setSubmitting', submitting: false });
    }
  };

  const handleSkip = async () => {
    if (!currentItem) return;

    dispatch({ type: 'setSubmitting', submitting: true });
    dispatch({ type: 'setError', error: null });

    try {
      const result = await skipAssessmentQuestion(currentItem.id);

      if (result.isComplete) {
        navigate('/categories');
      } else {
        dispatch({ type: 'nextQuestion', currentIndex: result.nextIndex });
      }
    } catch (err) {
      dispatch({
        type: 'setError',
        error: err instanceof Error ? err.message : 'Failed to skip question',
      });
    } finally {
      dispatch({ type: 'setSubmitting', submitting: false });
    }
  };

  const getPrompt = (): string => {
    if (!currentItem) return '';
    return lang === 'ko' ? currentItem.ui.prompt_ko : currentItem.ui.prompt_en;
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
        <m.div
          animate={{ rotate: 360 }}
          transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
        >
          <Loader2 className="size-12 text-primary" strokeWidth={3} />
        </m.div>
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

  const progressValue = ((currentIndex + 1) / assessmentItems.length) * 100;

  return (
    <AnimatedPage className="min-h-screen bg-background overflow-y-auto py-8 px-6">
      <Card className="p-8 max-w-3xl w-full mx-auto">
        <AssessmentHeader
          currentIndex={currentIndex}
          totalItems={assessmentItems.length}
          progressValue={progressValue}
          progressLabel={t('assessment.progress')}
          ofLabel={t('assessment.of')}
          section={currentItem.section}
        />

        {/* Error Alert */}
        <AnimatePresence mode="wait">
          {error && (
            <m.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6"
            >
              <Alert variant="destructive">
                <AlertTriangle className="size-5" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </m.div>
          )}
        </AnimatePresence>

        <AssessmentQuestionContent
          currentIndex={currentIndex}
          currentItem={currentItem}
          prompt={getPrompt()}
          selectedOption={selectedOption}
          textAnswer={textAnswer}
          onSelectedOptionChange={(selectedOption) => dispatch({
            type: 'setSelectedOption',
            selectedOption,
          })}
          onTextAnswerChange={(textAnswer) => dispatch({ type: 'setTextAnswer', textAnswer })}
          onAudioTranscriptChange={(audioTranscript) => dispatch({
            type: 'setAudioTranscript',
            audioTranscript,
          })}
        />

        <AssessmentActions
          skipLabel={t('assessment.skip')}
          nextLabel={t('assessment.next')}
          submitting={submitting}
          canSubmit={canSubmit()}
          onSkip={handleSkip}
          onSubmit={handleSubmit}
        />
      </Card>
    </AnimatedPage>
  );
}
