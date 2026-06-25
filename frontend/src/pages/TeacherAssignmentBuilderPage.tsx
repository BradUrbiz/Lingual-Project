import { useCallback, useEffect, useReducer, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  GraduationCap,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { AssignmentPlanPreview } from '@/components/assignments/AssignmentPlanPreview';
import { createAssignment, generateAssignmentDraft, getTeacherAssignments } from '@/api/assignments';
import { getCanvasContentForClass } from '@/api/canvas';
import { createCanvasPractice, generateCanvasPractice } from '@/api/canvasPractice';
import type { CanvasItemContext, CanvasPracticeSuggestions } from '@/api/canvasPractice';
import { getTeacherClasses } from '@/api/teacher';
import { Alert, AlertDescription, Badge, Button, Card, Input, Textarea } from '@/components/ui';
import type { CanvasCourseContentItem } from '@/types/canvas';
import type {
  StudentAssignmentSummary,
  TargetLanguageIntensity,
  TeacherClassSummary,
} from '@/types';
import { useLanguage } from '@/contexts/LanguageContext';

type CanvasPracticePhase = 'idle' | 'generating' | 'reviewing' | 'saving' | 'error';
type BuilderMode = 'quick' | 'advanced';
type AdvancedEntryMode = 'canvas' | 'source' | 'manual' | 'custom_prompt';

function formatStatusVariant(status: string): 'success' | 'secondary' | 'outline' {
  if (status === 'published') return 'success';
  if (status === 'archived') return 'secondary';
  return 'outline';
}

interface TeacherAssignmentBuilderState {
  loading: boolean;
  error: string | null;
  successMessage: string | null;
  teacherClasses: TeacherClassSummary[];
  assignments: StudentAssignmentSummary[];
  canvasContent: CanvasCourseContentItem[];
  builderMode: BuilderMode;
  advancedEntryMode: AdvancedEntryMode;
  sourcePacketText: string;
  draftInstructions: string;
  canvasPhase: CanvasPracticePhase;
  canvasError: string | null;
  selectedCanvasItemId: string;
  canvasItemContext: CanvasItemContext | null;
  canvasTitle: string;
  canvasDescription: string;
  canvasScenario: string;
  canvasTargetExpressions: string[];
  canvasTargetVocabulary: string[];
  canvasFocusGrammar: string[];
  canvasSuccessCriteria: string[];
  canvasObjectives: string[];
  canvasObjectivesFromAI: boolean;
  canvasTeacherNotes: string;
  customStudentInstructions: string;
  canvasTargetLanguageIntensity: TargetLanguageIntensity;
  canvasStatus: 'draft' | 'published';
}

type TeacherAssignmentBuilderAction =
  | { type: 'patch'; payload: Partial<TeacherAssignmentBuilderState> }
  | { type: 'resetCanvasPractice' }
  | { type: 'populateCanvasSuggestions'; suggestions: CanvasPracticeSuggestions; nextInstructions?: string };

const initialTeacherAssignmentBuilderState: TeacherAssignmentBuilderState = {
  loading: true,
  error: null,
  successMessage: null,
  teacherClasses: [],
  assignments: [],
  canvasContent: [],
  builderMode: 'quick',
  advancedEntryMode: 'canvas',
  sourcePacketText: '',
  draftInstructions: '',
  canvasPhase: 'idle',
  canvasError: null,
  selectedCanvasItemId: '',
  canvasItemContext: null,
  canvasTitle: '',
  canvasDescription: '',
  canvasScenario: '',
  canvasTargetExpressions: [],
  canvasTargetVocabulary: [],
  canvasFocusGrammar: [],
  canvasSuccessCriteria: [],
  canvasObjectives: [],
  canvasObjectivesFromAI: false,
  canvasTeacherNotes: '',
  customStudentInstructions: '',
  canvasTargetLanguageIntensity: 'balanced',
  canvasStatus: 'draft',
};

function getResetCanvasPracticePatch(): Partial<TeacherAssignmentBuilderState> {
  return {
    canvasPhase: 'idle',
    canvasError: null,
    selectedCanvasItemId: '',
    canvasItemContext: null,
    sourcePacketText: '',
    draftInstructions: '',
    canvasTitle: '',
    canvasDescription: '',
    canvasScenario: '',
    canvasTargetExpressions: [],
    canvasTargetVocabulary: [],
    canvasFocusGrammar: [],
    canvasSuccessCriteria: [],
    canvasObjectives: [],
    canvasObjectivesFromAI: false,
    canvasTeacherNotes: '',
    customStudentInstructions: '',
    canvasTargetLanguageIntensity: 'balanced',
    canvasStatus: 'draft',
  };
}

function teacherAssignmentBuilderReducer(
  state: TeacherAssignmentBuilderState,
  action: TeacherAssignmentBuilderAction,
): TeacherAssignmentBuilderState {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.payload };
    case 'resetCanvasPractice':
      return { ...state, ...getResetCanvasPracticePatch() };
    case 'populateCanvasSuggestions': {
      const providedObjectives = action.suggestions.objectives || [];
      return {
        ...state,
        canvasTitle: action.suggestions.suggestedTitle || '',
        canvasDescription: action.suggestions.suggestedDescription || '',
        canvasScenario: action.suggestions.scenario || '',
        ...(action.nextInstructions !== undefined ? { draftInstructions: action.nextInstructions } : {}),
        canvasTargetExpressions: action.suggestions.targetExpressions || [],
        canvasTargetVocabulary: action.suggestions.targetVocabulary || [],
        canvasFocusGrammar: action.suggestions.focusGrammar || [],
        canvasSuccessCriteria: action.suggestions.successCriteria || [],
        canvasObjectives: providedObjectives,
        canvasObjectivesFromAI: providedObjectives.length > 0,
        canvasTeacherNotes: action.suggestions.teacherNotes || '',
      };
    }
    default:
      return state;
  }
}

function useTeacherAssignmentBuilderController() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [state, dispatch] = useReducer(
    teacherAssignmentBuilderReducer,
    initialTeacherAssignmentBuilderState,
  );
  const {
    loading,
    error,
    successMessage,
    teacherClasses,
    assignments,
    canvasContent,
    builderMode,
    advancedEntryMode,
    sourcePacketText,
    draftInstructions,
    canvasPhase,
    canvasError,
    selectedCanvasItemId,
    canvasItemContext,
    canvasTitle,
    canvasDescription,
    canvasScenario,
    canvasTargetExpressions,
    canvasTargetVocabulary,
    canvasFocusGrammar,
    canvasSuccessCriteria,
    canvasObjectives,
    canvasObjectivesFromAI,
    canvasTeacherNotes,
    customStudentInstructions,
    canvasTargetLanguageIntensity,
    canvasStatus,
  } = state;
  const patchBuilderState = (payload: Partial<TeacherAssignmentBuilderState>) => {
    dispatch({ type: 'patch', payload });
  };
  const setError = (value: string | null) => patchBuilderState({ error: value });
  const setSuccessMessage = (value: string | null) => patchBuilderState({ successMessage: value });
  const setBuilderMode = (value: BuilderMode) => patchBuilderState({ builderMode: value });
  const setAdvancedEntryMode = (value: AdvancedEntryMode) => patchBuilderState({ advancedEntryMode: value });
  const setSourcePacketText = (value: string) => patchBuilderState({ sourcePacketText: value });
  const setDraftInstructions = (value: string) => patchBuilderState({ draftInstructions: value });
  const setCanvasPhase = (value: CanvasPracticePhase) => patchBuilderState({ canvasPhase: value });
  const setCanvasError = (value: string | null) => patchBuilderState({ canvasError: value });
  const setSelectedCanvasItemId = (value: string) => patchBuilderState({ selectedCanvasItemId: value });
  const setCanvasItemContext = (value: CanvasItemContext | null) => patchBuilderState({ canvasItemContext: value });
  const setCanvasTitle = (value: string) => patchBuilderState({ canvasTitle: value });
  const setCanvasDescription = (value: string) => patchBuilderState({ canvasDescription: value });
  const setCanvasScenario = (value: string) => patchBuilderState({ canvasScenario: value });
  const setCanvasTargetExpressions = (value: string[]) => patchBuilderState({ canvasTargetExpressions: value });
  const setCanvasTargetVocabulary = (value: string[]) => patchBuilderState({ canvasTargetVocabulary: value });
  const setCanvasFocusGrammar = (value: string[]) => patchBuilderState({ canvasFocusGrammar: value });
  const setCanvasSuccessCriteria = (value: string[]) => patchBuilderState({ canvasSuccessCriteria: value });
  const setCanvasObjectives = (value: string[]) => patchBuilderState({ canvasObjectives: value, canvasObjectivesFromAI: false });
  const setCanvasTeacherNotes = (value: string) => patchBuilderState({ canvasTeacherNotes: value });
  const setCustomStudentInstructions = (value: string) => patchBuilderState({ customStudentInstructions: value });
  const setCanvasTargetLanguageIntensity = (value: TargetLanguageIntensity) => patchBuilderState({ canvasTargetLanguageIntensity: value });
  const setCanvasStatus = (value: 'draft' | 'published') => patchBuilderState({ canvasStatus: value });

  const activeClass = teacherClasses.find((item) => item.id === classId) || null;
  const usesCanvasWorkflow = builderMode === 'quick' || advancedEntryMode === 'canvas';

  const loadClassData = useCallback(async (nextClassId: string) => {
    const [classes, classAssignments] = await Promise.all([
      getTeacherClasses(),
      getTeacherAssignments(nextClassId),
    ]);

    dispatch({ type: 'patch', payload: { teacherClasses: classes, assignments: classAssignments } });

    // Load Canvas content (best-effort - not all classes have Canvas).
    try {
      const items = await getCanvasContentForClass(nextClassId);
      dispatch({ type: 'patch', payload: { canvasContent: items } });
    } catch {
      dispatch({ type: 'patch', payload: { canvasContent: [] } });
    }
  }, []);

  useEffect(() => {
    let isActive = true;

    if (!classId) {
      dispatch({
        type: 'patch',
        payload: { loading: false, error: 'Class id is required.' },
      });
      return;
    }

    const load = async () => {
      dispatch({ type: 'patch', payload: { loading: true } });
      try {
        await loadClassData(classId);
        if (!isActive) return;
        dispatch({ type: 'patch', payload: { error: null } });
      } catch (loadError) {
        if (!isActive) return;
        dispatch({
          type: 'patch',
          payload: {
            error:
              loadError instanceof Error
                ? loadError.message
                : 'Failed to load assignment builder.',
          },
        });
      } finally {
        if (isActive) dispatch({ type: 'patch', payload: { loading: false } });
      }
    };

    void load();
    return () => {
      isActive = false;
    };
  }, [classId, loadClassData]);

  const resetCanvasPracticeState = () => {
    dispatch({ type: 'resetCanvasPractice' });
  };

  const populateCanvasFormFromSuggestions = (
    suggestions: CanvasPracticeSuggestions,
    nextInstructions?: string,
  ) => {
    dispatch({ type: 'populateCanvasSuggestions', suggestions, nextInstructions });
  };

  const handleCanvasGenerate = async (targetContentId?: string) => {
    if (!classId) return;
    const contentId = targetContentId || selectedCanvasItemId;
    if (!contentId) {
      setCanvasError('Please select a Canvas item first.');
      return;
    }

    setCanvasPhase('generating');
    setCanvasError(null);
    setError(null);
    setSuccessMessage(null);

    try {
      const result = await generateCanvasPractice(classId, contentId);
      if (!result.success) {
        setCanvasError(result.error || 'Generation failed.');
        setCanvasPhase('error');
        return;
      }
      setCanvasItemContext(result.canvasItem);
      populateCanvasFormFromSuggestions(result.suggestions);
      setCanvasPhase('reviewing');
    } catch (generateError) {
      setCanvasError(
        generateError instanceof Error ? generateError.message : 'Failed to generate practice.'
      );
      setCanvasPhase('error');
    }
  };

  const handleSourceDraftGenerate = async () => {
    if (!classId) return;
    const sourceText = sourcePacketText.trim();
    if (!sourceText) {
      setCanvasError('Please paste a source packet first.');
      return;
    }

    setCanvasPhase('generating');
    setCanvasError(null);
    setError(null);
    setSuccessMessage(null);

    try {
      const result = await generateAssignmentDraft(classId, sourceText);
      if (!result.success) {
        setCanvasError(result.error || 'Generation failed.');
        setCanvasPhase('error');
        return;
      }
      setSelectedCanvasItemId('');
      setCanvasItemContext(null);
      populateCanvasFormFromSuggestions(result.suggestions, sourceText);
      setCanvasPhase('reviewing');
    } catch (generateError) {
      setCanvasError(
        generateError instanceof Error ? generateError.message : 'Failed to generate practice.'
      );
      setCanvasPhase('error');
    }
  };

  const enterManualAuthoringMode = () => {
    setCanvasError(null);
    setSelectedCanvasItemId('');
    setCanvasItemContext(null);
    setCanvasTitle('');
    setCanvasDescription('');
    setDraftInstructions('');
    setCanvasScenario('');
    setCanvasTargetExpressions([]);
    setCanvasTargetVocabulary([]);
    setCanvasFocusGrammar([]);
    setCanvasSuccessCriteria([]);
    setCanvasObjectives([]);
    setCanvasTeacherNotes('');
    setCanvasTargetLanguageIntensity('balanced');
    setCanvasStatus('draft');
    setCanvasPhase('reviewing');
  };

  const handleSelectAdvancedEntryMode = (mode: AdvancedEntryMode) => {
    setAdvancedEntryMode(mode);
    if (mode === 'manual' || mode === 'custom_prompt') {
      enterManualAuthoringMode();
      return;
    }
    resetCanvasPracticeState();
  };

  const handleSelectBuilderMode = (mode: BuilderMode) => {
    setBuilderMode(mode);
    setCanvasError(null);
    if (mode === 'quick') {
      setAdvancedEntryMode('canvas');
      resetCanvasPracticeState();
      return;
    }
    handleSelectAdvancedEntryMode('canvas');
  };

  const handlePublishAssignment = async () => {
    if (!classId) return;
    if (!canvasTitle.trim()) {
      setCanvasError('Title is required before publishing.');
      return;
    }
    if (advancedEntryMode === 'custom_prompt') {
      if (!draftInstructions.trim()) {
        setCanvasError('A custom system prompt is required before publishing.');
        return;
      }
    } else if (!canvasScenario.trim()) {
      setCanvasError('Scenario is required before publishing.');
      return;
    }

    setCanvasPhase('saving');
    setCanvasError(null);
    setError(null);
    setSuccessMessage(null);

    try {
      if (usesCanvasWorkflow) {
        if (!selectedCanvasItemId) {
          setCanvasError('Please select a Canvas item first.');
          setCanvasPhase('idle');
          return;
        }

        const result = await createCanvasPractice(classId, {
          canvasContentId: selectedCanvasItemId,
          canvasModuleItemId: canvasItemContext?.canvasItemId || '',
          title: canvasTitle.trim(),
          description: canvasDescription.trim(),
          scenario: canvasScenario.trim(),
          targetExpressions: canvasTargetExpressions,
          targetVocabulary: canvasTargetVocabulary,
          focusGrammar: canvasFocusGrammar,
          successCriteria: canvasSuccessCriteria,
          objectives: canvasObjectives,
          teacherNotes: canvasTeacherNotes.trim(),
          targetLanguageIntensity: canvasTargetLanguageIntensity,
          status: canvasStatus,
        });
        if (!result.success) {
          throw new Error(result.error || 'Creation failed');
        }
      } else {
        if (!draftInstructions.trim()) {
          setCanvasError('Instructions are required for non-Canvas assignments.');
          setCanvasPhase('reviewing');
          return;
        }

        const isCustomPrompt = advancedEntryMode === 'custom_prompt';
        await createAssignment(classId, {
          title: canvasTitle.trim(),
          description: canvasDescription.trim(),
          status: canvasStatus,
          ...(isCustomPrompt ? { taskType: 'custom_prompt' as const } : {}),
          successCriteria: isCustomPrompt ? [] : canvasSuccessCriteria,
          instructions: draftInstructions.trim(),
          generatedScenario: isCustomPrompt ? '' : canvasScenario.trim(),
          objectives: isCustomPrompt ? [] : canvasObjectives,
          targetExpressions: isCustomPrompt ? [] : canvasTargetExpressions,
          targetVocabulary: isCustomPrompt ? [] : canvasTargetVocabulary,
          focusGrammar: isCustomPrompt ? [] : canvasFocusGrammar,
          teacherNotes: isCustomPrompt ? '' : canvasTeacherNotes.trim(),
          ...(isCustomPrompt ? { studentInstructions: customStudentInstructions.trim() } : {}),
          targetLanguageIntensity: canvasTargetLanguageIntensity,
        });
      }
      await loadClassData(classId);
      const publishedLabel = canvasStatus === 'published' ? t('teacher.builder.publish.published') : t('teacher.builder.publish.savedDraft');
      setSuccessMessage(
        `"${canvasTitle.trim()}" ${t('teacher.builder.publish.successPrefix')} ${publishedLabel}${t('teacher.builder.publish.successSuffix')}`
      );
      resetCanvasPracticeState();
    } catch (saveError) {
      setCanvasError(
        saveError instanceof Error ? saveError.message : 'Failed to create practice.'
      );
      setCanvasPhase('reviewing');
    }
  };

  const handleCanvasRegenerate = () => {
    if (advancedEntryMode === 'source' && builderMode === 'advanced') {
      void handleSourceDraftGenerate();
      return;
    }
    if (!selectedCanvasItemId) return;
    // Regenerate overwrites every review-form field with a new AI draft, so
    // guard against silent edit loss when the teacher is mid-review.
    if (canvasPhase === 'reviewing') {
      const confirmed = window.confirm(t('teacher.builder.regenerate.confirm'));
      if (!confirmed) return;
    }
    void handleCanvasGenerate(selectedCanvasItemId);
  };

  const handleCanvasPickDifferent = () => {
    if (builderMode === 'advanced' && advancedEntryMode === 'manual') {
      enterManualAuthoringMode();
      return;
    }
    resetCanvasPracticeState();
  };

  return {
    classId,
    navigate,
    loading,
    error,
    successMessage,
    teacherClasses,
    assignments,
    canvasContent,
    builderMode,
    advancedEntryMode,
    sourcePacketText,
    draftInstructions,
    canvasPhase,
    canvasError,
    selectedCanvasItemId,
    canvasItemContext,
    canvasTitle,
    canvasDescription,
    canvasScenario,
    canvasTargetExpressions,
    canvasTargetVocabulary,
    canvasFocusGrammar,
    canvasSuccessCriteria,
    canvasObjectives,
    canvasObjectivesFromAI,
    canvasTeacherNotes,
    customStudentInstructions,
    canvasTargetLanguageIntensity,
    canvasStatus,
    activeClass,
    usesCanvasWorkflow,
    setSourcePacketText,
    setDraftInstructions,
    setCanvasError,
    setSelectedCanvasItemId,
    setCanvasTitle,
    setCanvasDescription,
    setCanvasScenario,
    setCanvasTargetExpressions,
    setCanvasTargetVocabulary,
    setCanvasFocusGrammar,
    setCanvasSuccessCriteria,
    setCanvasObjectives,
    setCanvasTeacherNotes,
    setCustomStudentInstructions,
    setCanvasTargetLanguageIntensity,
    setCanvasStatus,
    handleCanvasGenerate,
    handleSourceDraftGenerate,
    handleSelectAdvancedEntryMode,
    handleSelectBuilderMode,
    handlePublishAssignment,
    handleCanvasRegenerate,
    handleCanvasPickDifferent,
  };
}

type TeacherAssignmentBuilderController = ReturnType<typeof useTeacherAssignmentBuilderController>;

function TeacherAssignmentBuilderView({ controller }: { controller: TeacherAssignmentBuilderController }) {
  const { t } = useLanguage();
  const {
    classId,
    navigate,
    loading,
    error,
    successMessage,
    assignments,
    canvasContent,
    builderMode,
    advancedEntryMode,
    sourcePacketText,
    draftInstructions,
    canvasPhase,
    canvasError,
    selectedCanvasItemId,
    canvasItemContext,
    canvasTitle,
    canvasDescription,
    canvasScenario,
    canvasTargetExpressions,
    canvasTargetVocabulary,
    canvasFocusGrammar,
    canvasSuccessCriteria,
    canvasObjectives,
    canvasObjectivesFromAI,
    canvasTeacherNotes,
    customStudentInstructions,
    canvasTargetLanguageIntensity,
    canvasStatus,
    activeClass,
    usesCanvasWorkflow,
    setSourcePacketText,
    setDraftInstructions,
    setCanvasError,
    setSelectedCanvasItemId,
    setCanvasTitle,
    setCanvasDescription,
    setCanvasScenario,
    setCanvasTargetExpressions,
    setCanvasTargetVocabulary,
    setCanvasFocusGrammar,
    setCanvasSuccessCriteria,
    setCanvasObjectives,
    setCanvasTeacherNotes,
    setCustomStudentInstructions,
    setCanvasTargetLanguageIntensity,
    setCanvasStatus,
    handleCanvasGenerate,
    handleSourceDraftGenerate,
    handleSelectAdvancedEntryMode,
    handleSelectBuilderMode,
    handlePublishAssignment,
    handleCanvasRegenerate,
    handleCanvasPickDifferent,
  } = controller;

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!activeClass) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{error || t('teacher.builder.classNotFound')}</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => navigate('/app/teacher')}>
          {t('teacher.builder.backToDashboard')}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="rounded-3xl border-3 border-foreground bg-card p-6 shadow-stamp">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border-2 border-border bg-secondary px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <Sparkles size={14} />
              {t('teacher.builder.badge')}
            </div>
            <h1 className="text-3xl font-display font-bold text-foreground">{activeClass.name}</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              {t('teacher.builder.subtitle')}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-2xl border-2 border-border bg-secondary/50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t('teacher.builder.stat.students')}</p>
              <p className="mt-1 text-xl font-bold text-foreground">{activeClass.studentCount}</p>
            </div>
            <div className="rounded-2xl border-2 border-border bg-secondary/50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t('teacher.builder.stat.assignments')}</p>
              <p className="mt-1 text-xl font-bold text-foreground">{assignments.length}</p>
            </div>
            <div className="rounded-2xl border-2 border-border bg-secondary/50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t('teacher.builder.stat.locale')}</p>
              <p className="mt-1 text-xl font-bold text-foreground">{activeClass.learningLocale}</p>
            </div>
          </div>
        </div>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {successMessage && (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}

      <Card className="border-3 border-foreground p-6 shadow-stamp">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex size-11 items-center justify-center rounded-2xl border-2 border-foreground bg-primary text-primary-foreground">
            <Sparkles size={22} strokeWidth={2.5} />
          </div>
          <div>
            <h2 className="text-xl font-display font-bold text-foreground">{t('teacher.builder.create.title')}</h2>
            <p className="text-sm text-muted-foreground">
              {builderMode === 'quick'
                ? t('teacher.builder.create.subtitleQuick')
                : t('teacher.builder.create.subtitleAdvanced')}
            </p>
          </div>
        </div>

        <div className="mb-6 space-y-4">
          <div className="flex gap-2" role="tablist" aria-label={t('teacher.builder.mode.ariaLabel')}>
            <Button
              type="button"
              variant={builderMode === 'quick' ? 'default' : 'outline'}
              onClick={() => handleSelectBuilderMode('quick')}
            >
              {t('teacher.builder.mode.quick')}
            </Button>
            <Button
              type="button"
              variant={builderMode === 'advanced' ? 'default' : 'outline'}
              onClick={() => handleSelectBuilderMode('advanced')}
            >
              {t('teacher.builder.mode.advanced')}
            </Button>
          </div>

          {builderMode === 'advanced' && (
            <div className="space-y-3 rounded-2xl border-2 border-border bg-secondary/40 p-4">
              <p className="text-sm font-semibold text-foreground">{t('teacher.builder.advanced.entryModeLabel')}</p>
              <div role="radiogroup" aria-label={t('teacher.builder.advanced.entryModeAriaLabel')} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {[
                  {
                    value: 'canvas' as const,
                    label: t('teacher.builder.advanced.canvasLabel'),
                    description: t('teacher.builder.advanced.canvasDesc'),
                  },
                  {
                    value: 'source' as const,
                    label: t('teacher.builder.advanced.sourceLabel'),
                    description: t('teacher.builder.advanced.sourceDesc'),
                  },
                  {
                    value: 'manual' as const,
                    label: t('teacher.builder.advanced.manualLabel'),
                    description: t('teacher.builder.advanced.manualDesc'),
                  },
                  {
                    value: 'custom_prompt' as const,
                    label: t('teacher.builder.advanced.customPromptLabel'),
                    description: t('teacher.builder.advanced.customPromptDesc'),
                  },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-label={option.label}
                    aria-checked={advancedEntryMode === option.value}
                    className={`rounded-xl border-2 p-4 text-left transition-colors ${
                      advancedEntryMode === option.value
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-card hover:border-primary/50'
                    }`}
                    onClick={() => handleSelectAdvancedEntryMode(option.value)}
                  >
                    <p className="font-semibold text-foreground">{option.label}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{option.description}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {canvasError && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{canvasError}</AlertDescription>
            </Alert>
          )}

          {usesCanvasWorkflow && canvasContent.length === 0 && (
            <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-6 text-center">
              <p className="text-sm font-semibold text-foreground">{t('teacher.builder.canvas.connectFirst')}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('teacher.builder.canvas.connectFirstSubtitle')}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-3">
                <Button
                  onClick={() => navigate(`/app/teacher/classes/${classId}/canvas/connect`)}
                >
                  {t('teacher.builder.canvas.connect')}
                </Button>
              </div>
            </div>
          )}

          {usesCanvasWorkflow && canvasContent.length > 0 && canvasPhase === 'idle' && (
            <div className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="canvas-item-picker" className="text-sm font-semibold text-foreground">
                  {t('teacher.builder.canvas.pickerLabel')}
                </label>
                <select
                  id="canvas-item-picker"
                  value={selectedCanvasItemId}
                  onChange={(event) => {
                    setSelectedCanvasItemId(event.target.value);
                    setCanvasError(null);
                  }}
                  className="h-11 w-full rounded-xl border-2 border-border bg-card px-4 text-sm text-foreground focus:border-primary focus:outline-none"
                >
                  <option value="">{t('teacher.builder.canvas.pickerPlaceholder')}</option>
                  {groupCanvasItemsByModule(canvasContent).map((group) => (
                    <optgroup key={group.moduleName} label={group.moduleName}>
                      {group.items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title} · {formatItemTypeBadge(item.itemType)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {selectedCanvasItemId && (() => {
                const picked = canvasContent.find((item) => item.id === selectedCanvasItemId);
                if (!picked) return null;
                return (
                  <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" size="sm">{picked.canvasModuleName}</Badge>
                      <Badge variant="outline" size="sm">{formatItemTypeBadge(picked.itemType)}</Badge>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-foreground">{picked.title}</p>
                  </div>
                );
              })()}

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {t('teacher.builder.canvas.analyzeHint')}
                </p>
                <Button
                  onClick={() => handleCanvasGenerate()}
                  disabled={!selectedCanvasItemId}
                >
                  <Sparkles size={16} className="mr-2" />
                  {t('teacher.builder.canvas.generate')}
                </Button>
              </div>
            </div>
          )}

          {builderMode === 'advanced' && advancedEntryMode === 'source' && canvasPhase === 'idle' && (
            <div className="space-y-5">
              <Textarea
                label={t('teacher.builder.source.label')}
                value={sourcePacketText}
                onChange={(event) => {
                  setSourcePacketText(event.target.value);
                  setCanvasError(null);
                }}
                placeholder={t('teacher.builder.source.placeholder')}
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {t('teacher.builder.source.hint')}
                </p>
                <Button
                  onClick={() => void handleSourceDraftGenerate()}
                  disabled={!sourcePacketText.trim()}
                >
                  <Sparkles size={16} className="mr-2" />
                  {t('teacher.builder.source.generate')}
                </Button>
              </div>
            </div>
          )}

          {canvasPhase === 'generating' && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Loader2 size={40} className="mb-4 animate-spin text-primary" />
              <p className="text-base font-semibold text-foreground">{t('teacher.builder.generating.title')}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {usesCanvasWorkflow
                  ? t('teacher.builder.generating.subtitleCanvas').replace('{item}', canvasItemContext?.title || t('teacher.builder.generating.subtitleCanvasFallback'))
                  : t('teacher.builder.generating.subtitleSource')}
              </p>
            </div>
          )}

          {canvasPhase === 'error' && (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertDescription>{canvasError || 'Generation failed.'}</AlertDescription>
              </Alert>
              <div className="flex flex-wrap gap-3">
                <Button onClick={handleCanvasRegenerate}>{t('teacher.builder.error.tryAgain')}</Button>
                <Button variant="outline" onClick={handleCanvasPickDifferent}>
                  {builderMode === 'advanced' && advancedEntryMode === 'source'
                    ? t('teacher.builder.error.backToSource')
                    : t('teacher.builder.error.pickDifferent')}
                </Button>
              </div>
            </div>
          )}

          {(canvasPhase === 'reviewing' || canvasPhase === 'saving') && (
            <div className="space-y-5">
              {canvasItemContext && (
                <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" size="sm">{canvasItemContext.moduleName || 'Canvas'}</Badge>
                    <Badge variant="outline" size="sm">{formatItemTypeBadge(canvasItemContext.type)}</Badge>
                    <Badge variant="accent" size="sm">{t('teacher.builder.form.aiDraft')}</Badge>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-foreground">{canvasItemContext.title}</p>
                </div>
              )}

              {builderMode === 'advanced' && advancedEntryMode === 'source' && !canvasItemContext && (
                <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="accent" size="sm">{t('teacher.builder.form.pastedSource')}</Badge>
                    <Badge variant="outline" size="sm">{t('teacher.builder.form.aiDraft')}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-foreground/80 line-clamp-4">{sourcePacketText || draftInstructions}</p>
                </div>
              )}

              <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
                <div className="space-y-4">
                  <Input
                    label={t('teacher.builder.form.assignmentTitle')}
                    value={canvasTitle}
                    onChange={(event) => setCanvasTitle(event.target.value)}
                    placeholder={t('teacher.builder.form.assignmentTitlePlaceholder')}
                  />
                  <Textarea
                    label={t('teacher.builder.form.description')}
                    value={canvasDescription}
                    onChange={(event) => setCanvasDescription(event.target.value)}
                    placeholder={t('teacher.builder.form.descriptionPlaceholder')}
                  />

                  {builderMode === 'advanced' && advancedEntryMode === 'custom_prompt' && (
                    <>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <label htmlFor="custom-student-instructions" className="text-base font-semibold text-foreground">
                            {t('teacher.builder.form.studentInstructions')}
                          </label>
                          <Badge variant="outline" size="sm">{t('teacher.builder.form.studentInstructionsBadge')}</Badge>
                        </div>
                        <textarea
                          id="custom-student-instructions"
                          value={customStudentInstructions}
                          onChange={(event) => setCustomStudentInstructions(event.target.value)}
                          rows={6}
                          placeholder={t('teacher.builder.form.studentInstructionsPlaceholder')}
                          className="w-full rounded-xl border-3 border-border bg-card px-4 py-3 text-base text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                        <p className="text-xs text-muted-foreground">
                          {t('teacher.builder.form.studentInstructionsHint')}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <label htmlFor="custom-system-prompt" className="text-base font-semibold text-foreground">
                            {t('teacher.builder.form.systemPrompt')}
                          </label>
                          <Badge variant="outline" size="sm">{t('teacher.builder.form.systemPromptBadge')}</Badge>
                        </div>
                        <textarea
                          id="custom-system-prompt"
                          value={draftInstructions}
                          onChange={(event) => setDraftInstructions(event.target.value)}
                          rows={16}
                          placeholder={t('teacher.builder.form.systemPromptPlaceholder')}
                          className="w-full rounded-xl border-3 border-border bg-card px-4 py-3 text-base text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                        <p className="text-xs text-muted-foreground">
                          {t('teacher.builder.form.systemPromptHint')}
                        </p>
                      </div>
                    </>
                  )}
                  {builderMode === 'advanced' && advancedEntryMode !== 'custom_prompt' && (
                    <Textarea
                      label={t('teacher.builder.form.instructions')}
                      value={draftInstructions}
                      onChange={(event) => setDraftInstructions(event.target.value)}
                      placeholder={t('teacher.builder.form.instructionsPlaceholder')}
                    />
                  )}

                  {advancedEntryMode !== 'custom_prompt' && (
                    <>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <label htmlFor="canvas-scenario" className="text-base font-semibold text-foreground">
                            {t('teacher.builder.form.scenario')}
                          </label>
                          {advancedEntryMode !== 'manual' && (
                            <Badge variant="accent" size="sm">{t('teacher.builder.form.aiGenerated')}</Badge>
                          )}
                        </div>
                        <textarea
                          id="canvas-scenario"
                          value={canvasScenario}
                          onChange={(event) => setCanvasScenario(event.target.value)}
                          rows={5}
                          placeholder={t('teacher.builder.form.scenarioPlaceholder')}
                          className="w-full rounded-xl border-3 border-border bg-card px-4 py-3 text-base text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <p className="text-base font-semibold text-foreground">{t('teacher.builder.form.targetExpressions')}</p>
                          {advancedEntryMode !== 'manual' && (
                            <Badge variant="accent" size="sm">{t('teacher.builder.form.aiGenerated')}</Badge>
                          )}
                        </div>
                        <TagListEditor
                          items={canvasTargetExpressions}
                          onChange={setCanvasTargetExpressions}
                          placeholder={t('teacher.builder.form.targetExpressionsPlaceholder')}
                          ariaLabel={t('teacher.builder.form.targetExpressions')}
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <p className="text-base font-semibold text-foreground">{t('teacher.builder.form.targetVocabulary')}</p>
                          {advancedEntryMode !== 'manual' && (
                            <Badge variant="accent" size="sm">{t('teacher.builder.form.aiGenerated')}</Badge>
                          )}
                        </div>
                        <TagListEditor
                          items={canvasTargetVocabulary}
                          onChange={setCanvasTargetVocabulary}
                          placeholder={t('teacher.builder.form.targetVocabularyPlaceholder')}
                          ariaLabel={t('teacher.builder.form.targetVocabulary')}
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <p className="text-base font-semibold text-foreground">{t('teacher.builder.form.focusGrammar')}</p>
                          {advancedEntryMode !== 'manual' && (
                            <Badge variant="accent" size="sm">{t('teacher.builder.form.aiGenerated')}</Badge>
                          )}
                        </div>
                        <TagListEditor
                          items={canvasFocusGrammar}
                          onChange={setCanvasFocusGrammar}
                          placeholder={t('teacher.builder.form.focusGrammarPlaceholder')}
                          ariaLabel={t('teacher.builder.form.focusGrammar')}
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <p className="text-base font-semibold text-foreground">{t('teacher.builder.form.successCriteria')}</p>
                          {advancedEntryMode !== 'manual' && (
                            <Badge variant="accent" size="sm">{t('teacher.builder.form.aiGenerated')}</Badge>
                          )}
                        </div>
                        <TagListEditor
                          items={canvasSuccessCriteria}
                          onChange={setCanvasSuccessCriteria}
                          placeholder={t('teacher.builder.form.successCriteriaPlaceholder')}
                          ariaLabel={t('teacher.builder.form.successCriteria')}
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <p className="text-base font-semibold text-foreground">{t('teacher.builder.form.objectives')}</p>
                          {advancedEntryMode !== 'manual' && canvasObjectivesFromAI && (
                            <Badge variant="accent" size="sm">{t('teacher.builder.form.aiGenerated')}</Badge>
                          )}
                        </div>
                        <TagListEditor
                          items={canvasObjectives}
                          onChange={setCanvasObjectives}
                          placeholder={t('teacher.builder.form.objectivesPlaceholder')}
                          ariaLabel={t('teacher.builder.form.objectives')}
                        />
                      </div>
                    </>
                  )}
                </div>

                <div className="space-y-4">
                  {advancedEntryMode !== 'custom_prompt' && (
                    <div className="space-y-3 rounded-2xl border-2 border-border bg-secondary/40 p-4">
                      <Textarea
                        label={t('teacher.builder.form.teacherNotes')}
                        value={canvasTeacherNotes}
                        onChange={(event) => setCanvasTeacherNotes(event.target.value)}
                        placeholder={t('teacher.builder.form.teacherNotesPlaceholder')}
                        rows={8}
                        className="min-h-[220px]"
                      />
                    </div>
                  )}

                  <div className="space-y-3 rounded-2xl border-2 border-border bg-secondary/40 p-4">
                    <div className="space-y-1">
                      <p id="canvas-language-mix-label" className="text-base font-semibold text-foreground">
                        {t('teacher.builder.languageMix.title')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('teacher.builder.languageMix.hint')}
                      </p>
                    </div>
                    <div
                      className="flex flex-col gap-2"
                      role="radiogroup"
                      aria-labelledby="canvas-language-mix-label"
                    >
                      {(
                        [
                          {
                            value: 'english_first',
                            label: t('teacher.builder.languageMix.englishFirst'),
                            hint: t('teacher.builder.languageMix.englishFirstHint'),
                          },
                          {
                            value: 'english_led',
                            label: t('teacher.builder.languageMix.englishLed'),
                            hint: t('teacher.builder.languageMix.englishLedHint'),
                          },
                          {
                            value: 'balanced',
                            label: t('teacher.builder.languageMix.balanced'),
                            hint: t('teacher.builder.languageMix.balancedHint'),
                          },
                          {
                            value: 'target_led',
                            label: t('teacher.builder.languageMix.targetLed'),
                            hint: t('teacher.builder.languageMix.targetLedHint'),
                          },
                          {
                            value: 'target_only',
                            label: t('teacher.builder.languageMix.targetOnly'),
                            hint: t('teacher.builder.languageMix.targetOnlyHint'),
                          },
                        ] as Array<{ value: TargetLanguageIntensity; label: string; hint: string }>
                      ).map((option) => {
                        const selected = canvasTargetLanguageIntensity === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            className={`rounded-xl border-2 px-3 py-2 text-left text-sm transition-colors ${
                              selected
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border bg-card text-muted-foreground hover:border-primary/50'
                            }`}
                            onClick={() => setCanvasTargetLanguageIntensity(option.value)}
                          >
                            <div className="font-semibold">{option.label}</div>
                            <div className="text-xs opacity-80">{option.hint}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-3 rounded-2xl border-2 border-border bg-secondary/40 p-4">
                    <p id="canvas-status-label" className="text-base font-semibold text-foreground">{t('teacher.builder.status.title')}</p>
                    <div
                      className="flex gap-2"
                      role="radiogroup"
                      aria-labelledby="canvas-status-label"
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={canvasStatus === 'draft'}
                        className={`flex-1 rounded-xl border-2 px-3 py-2 text-sm font-semibold transition-colors ${
                          canvasStatus === 'draft'
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-card text-muted-foreground hover:border-primary/50'
                        }`}
                        onClick={() => setCanvasStatus('draft')}
                      >
                        {t('teacher.builder.status.draft')}
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={canvasStatus === 'published'}
                        className={`flex-1 rounded-xl border-2 px-3 py-2 text-sm font-semibold transition-colors ${
                          canvasStatus === 'published'
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-card text-muted-foreground hover:border-primary/50'
                        }`}
                        onClick={() => setCanvasStatus('published')}
                      >
                        {t('teacher.builder.status.published')}
                      </button>
                    </div>

                    <Button
                      className="w-full"
                      onClick={handlePublishAssignment}
                      loading={canvasPhase === 'saving'}
                      disabled={
                        canvasPhase === 'saving' ||
                        !canvasTitle.trim() ||
                        (advancedEntryMode === 'custom_prompt'
                          ? !draftInstructions.trim()
                          : !canvasScenario.trim())
                      }
                    >
                      <Sparkles size={16} className="mr-2" />
                      {canvasStatus === 'published' ? t('teacher.builder.status.publish') : t('teacher.builder.status.saveDraft')}
                    </Button>
                    {advancedEntryMode !== 'manual' && advancedEntryMode !== 'custom_prompt' && (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={handleCanvasRegenerate}
                        disabled={canvasPhase === 'saving'}
                      >
                        {t('teacher.builder.status.regenerate')}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      className="w-full"
                      onClick={handleCanvasPickDifferent}
                      disabled={canvasPhase === 'saving'}
                    >
                      {builderMode === 'advanced' && (advancedEntryMode === 'manual' || advancedEntryMode === 'custom_prompt')
                        ? t('teacher.builder.status.startOver')
                        : t('teacher.builder.status.pickDifferent')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Assignments list */}
      <AssignmentListCard
        assignments={assignments}
        classId={classId}
        navigate={navigate}
      />
    </div>
  );
}

export function TeacherAssignmentBuilderPage() {
  const controller = useTeacherAssignmentBuilderController();
  return <TeacherAssignmentBuilderView controller={controller} />;
}

// ── Assignment list card with per-card collapsible plan preview ────────

function AssignmentListCard({
  assignments,
  classId,
  navigate,
}: {
  assignments: StudentAssignmentSummary[];
  classId: string | undefined;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { t } = useLanguage();
  const [expandedPreviews, setExpandedPreviews] = useState<Set<string>>(new Set());

  const togglePreview = (id: string) => {
    setExpandedPreviews((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <Card className="border-3 border-foreground p-6 shadow-stamp">
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-2xl border-2 border-foreground bg-primary text-primary-foreground">
          <GraduationCap size={22} strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">{t('teacher.builder.list.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('teacher.builder.list.subtitle')}
          </p>
        </div>
      </div>
      <div className="mt-5 space-y-3">
        {assignments.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
            {t('teacher.builder.list.empty')}
          </div>
        ) : (
          assignments.map((assignment) => {
            const isExpanded = expandedPreviews.has(assignment.id);
            return (
              <div key={assignment.id} className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={formatStatusVariant(assignment.status)} size="sm">
                        {assignment.status}
                      </Badge>
                    </div>
                    <h3 className="mt-2 text-lg font-display font-bold text-foreground">{assignment.title}</h3>
                    {assignment.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{assignment.description}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/app/teacher/classes/${classId}/assignments/${assignment.id}/analytics`)}
                    >
                      {t('teacher.builder.list.viewAnalytics')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/app/assignments/${assignment.id}`)}
                    >
                      {t('teacher.builder.list.preview')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => togglePreview(assignment.id)}
                      aria-expanded={isExpanded}
                      aria-label={t('teacher.builder.list.aiPlanAriaLabel')}
                    >
                      {isExpanded ? <ChevronUp size={14} className="mr-1" /> : <ChevronDown size={14} className="mr-1" />}
                      {t('teacher.builder.list.aiPlan')}
                    </Button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="mt-3">
                    <AssignmentPlanPreview assignmentId={assignment.id} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

// ── Local helpers for Canvas Quick Assign ──────────────────────────────

interface CanvasItemGroup {
  moduleName: string;
  items: CanvasCourseContentItem[];
}

function groupCanvasItemsByModule(items: CanvasCourseContentItem[]): CanvasItemGroup[] {
  const byModule = new Map<string, CanvasCourseContentItem[]>();
  for (const item of items) {
    const key = item.canvasModuleName || 'Unassigned';
    const bucket = byModule.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      byModule.set(key, [item]);
    }
  }
  return Array.from(byModule.entries()).map(([moduleName, groupItems]) => ({
    moduleName,
    items: Array.from(groupItems).sort((a, b) => a.itemPosition - b.itemPosition),
  }));
}

function formatItemTypeBadge(itemType: string | undefined | null): string {
  if (!itemType) return 'Item';
  const cleaned = itemType.replace(/[_-]+/g, ' ').trim();
  if (!cleaned) return 'Item';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Editable list of string tags with add/remove. Accepts an optional aria-label
 *  so Testing Library can find it by accessible name.
 */
function TagListEditor({
  items,
  onChange,
  placeholder,
  ariaLabel,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  ariaLabel?: string;
}) {
  const [newValue, setNewValue] = useState('');

  const handleAdd = () => {
    const trimmed = newValue.trim();
    if (trimmed && !items.includes(trimmed)) {
      onChange([...items, trimmed]);
      setNewValue('');
    }
  };

  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const handleEdit = (index: number, value: string) => {
    const trimmed = value.trim();
    if (trimmed && items.some((item, itemIndex) => itemIndex !== index && item === trimmed)) {
      return;
    }
    const updated = [...items];
    updated[index] = value;
    onChange(updated);
  };

  return (
    <div className="space-y-2" aria-label={ariaLabel}>
      {items.map((item, i) => (
        <div key={item || `${ariaLabel || placeholder}-empty`} className="flex items-center gap-2">
          <Input
            value={item}
            onChange={(event) => handleEdit(i, event.target.value)}
            className="flex-1"
            aria-label={ariaLabel ? `${ariaLabel} ${i + 1}` : undefined}
          />
          <button
            type="button"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => handleRemove(i)}
            aria-label={`Remove ${ariaLabel || 'item'} ${i + 1}`}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          value={newValue}
          onChange={(event) => setNewValue(event.target.value)}
          placeholder={placeholder}
          className="flex-1"
          aria-label={ariaLabel ? `New ${ariaLabel}` : undefined}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              handleAdd();
            }
          }}
        />
        <Button variant="outline" size="sm" onClick={handleAdd} disabled={!newValue.trim()}>
          <Plus size={14} />
        </Button>
      </div>
    </div>
  );
}
