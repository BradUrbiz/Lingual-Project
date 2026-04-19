import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  CheckCircle2,
  GraduationCap,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
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

type CanvasPracticePhase = 'idle' | 'generating' | 'reviewing' | 'saving' | 'error';
type BuilderMode = 'quick' | 'advanced';
type AdvancedEntryMode = 'canvas' | 'source' | 'manual' | 'custom_prompt';

function formatStatusVariant(status: string): 'success' | 'secondary' | 'outline' {
  if (status === 'published') return 'success';
  if (status === 'archived') return 'secondary';
  return 'outline';
}

export function TeacherAssignmentBuilderPage() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [teacherClasses, setTeacherClasses] = useState<TeacherClassSummary[]>([]);
  const [assignments, setAssignments] = useState<StudentAssignmentSummary[]>([]);
  const [canvasContent, setCanvasContent] = useState<CanvasCourseContentItem[]>([]);
  const [builderMode, setBuilderMode] = useState<BuilderMode>('quick');
  const [advancedEntryMode, setAdvancedEntryMode] = useState<AdvancedEntryMode>('canvas');
  const [sourcePacketText, setSourcePacketText] = useState('');
  const [draftInstructions, setDraftInstructions] = useState('');

  // ── Canvas-powered assignment state ──────────────────────────────────
  const [canvasPhase, setCanvasPhase] = useState<CanvasPracticePhase>('idle');
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [selectedCanvasItemId, setSelectedCanvasItemId] = useState<string>('');
  const [canvasItemContext, setCanvasItemContext] = useState<CanvasItemContext | null>(null);
  const [canvasTitle, setCanvasTitle] = useState('');
  const [canvasDescription, setCanvasDescription] = useState('');
  const [canvasScenario, setCanvasScenario] = useState('');
  const [canvasTargetExpressions, setCanvasTargetExpressions] = useState<string[]>([]);
  const [canvasTargetVocabulary, setCanvasTargetVocabulary] = useState<string[]>([]);
  const [canvasFocusGrammar, setCanvasFocusGrammar] = useState<string[]>([]);
  const [canvasSuccessCriteria, setCanvasSuccessCriteria] = useState<string[]>([]);
  const [canvasObjectives, setCanvasObjectives] = useState<string[]>([]);
  // Track whether objectives were pre-populated by the AI suggestions response.
  // The backend only sometimes returns objectives, so the "AI-generated" badge
  // on the Objectives field can otherwise falsely claim ownership of teacher-
  // authored items.
  const [canvasObjectivesFromAI, setCanvasObjectivesFromAI] = useState(false);
  const [canvasTeacherNotes, setCanvasTeacherNotes] = useState('');
  const [canvasTargetLanguageIntensity, setCanvasTargetLanguageIntensity] =
    useState<TargetLanguageIntensity>('mostly_target');
  // Default to 'draft' so a misclick on Publish doesn't ship an un-reviewed
  // assignment live to students. Teachers must explicitly choose Published.
  const [canvasStatus, setCanvasStatus] = useState<'draft' | 'published'>('draft');

  const activeClass = teacherClasses.find((item) => item.id === classId) || null;
  const usesCanvasWorkflow = builderMode === 'quick' || advancedEntryMode === 'canvas';

  const loadClassData = async (nextClassId: string) => {
    const [classes, classAssignments] = await Promise.all([
      getTeacherClasses(),
      getTeacherAssignments(nextClassId),
    ]);

    setTeacherClasses(classes);
    setAssignments(classAssignments);

    // Load Canvas content (best-effort — not all classes have Canvas).
    try {
      const items = await getCanvasContentForClass(nextClassId);
      setCanvasContent(items);
    } catch {
      setCanvasContent([]);
    }
  };

  useEffect(() => {
    let isActive = true;

    if (!classId) {
      setLoading(false);
      setError('Class id is required.');
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        await loadClassData(classId);
        if (!isActive) return;
        setError(null);
      } catch (loadError) {
        if (!isActive) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load assignment builder.');
      } finally {
        if (isActive) setLoading(false);
      }
    };

    void load();
    return () => {
      isActive = false;
    };
  }, [classId]);

  const resetCanvasPracticeState = () => {
    setCanvasPhase('idle');
    setCanvasError(null);
    setSelectedCanvasItemId('');
    setCanvasItemContext(null);
    setSourcePacketText('');
    setDraftInstructions('');
    setCanvasTitle('');
    setCanvasDescription('');
    setCanvasScenario('');
    setCanvasTargetExpressions([]);
    setCanvasTargetVocabulary([]);
    setCanvasFocusGrammar([]);
    setCanvasSuccessCriteria([]);
    setCanvasObjectives([]);
    setCanvasObjectivesFromAI(false);
    setCanvasTeacherNotes('');
    setCanvasTargetLanguageIntensity('mostly_target');
    setCanvasStatus('draft');
  };

  const populateCanvasFormFromSuggestions = (
    suggestions: CanvasPracticeSuggestions,
    nextInstructions?: string,
  ) => {
    setCanvasTitle(suggestions.suggestedTitle || '');
    setCanvasDescription(suggestions.suggestedDescription || '');
    setCanvasScenario(suggestions.scenario || '');
    if (nextInstructions !== undefined) {
      setDraftInstructions(nextInstructions);
    }
    setCanvasTargetExpressions(suggestions.targetExpressions || []);
    setCanvasTargetVocabulary(suggestions.targetVocabulary || []);
    setCanvasFocusGrammar(suggestions.focusGrammar || []);
    setCanvasSuccessCriteria(suggestions.successCriteria || []);
    // Pre-fill objectives when the backend provides them. If it doesn't,
    // teachers can still add them manually via the TagListEditor below.
    const providedObjectives = suggestions.objectives || [];
    setCanvasObjectives(providedObjectives);
    setCanvasObjectivesFromAI(providedObjectives.length > 0);
    setCanvasTeacherNotes(suggestions.teacherNotes || '');
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
    setCanvasTargetLanguageIntensity('mostly_target');
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
          targetLanguageIntensity: isCustomPrompt ? undefined : canvasTargetLanguageIntensity,
        });
      }
      await loadClassData(classId);
      const publishedLabel = canvasStatus === 'published' ? 'published' : 'saved as draft';
      setSuccessMessage(
        `"${canvasTitle.trim()}" has been ${publishedLabel}. Students will see it on their learning dashboard once published.`
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
      const confirmed = window.confirm(
        'Regenerating will replace your current title, scenario, and other edits with a new AI draft. Continue?'
      );
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

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!activeClass) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{error || 'Teacher class was not found.'}</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => navigate('/app/teacher')}>
          Back to teacher dashboard
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
              Teacher-designed practice
            </div>
            <h1 className="text-3xl font-display font-bold text-foreground">{activeClass.name}</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Choose what your students will practice, customize the AI tutor's behavior, then publish an assignment.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-2xl border-2 border-border bg-secondary/50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Students</p>
              <p className="mt-1 text-xl font-bold text-foreground">{activeClass.studentCount}</p>
            </div>
            <div className="rounded-2xl border-2 border-border bg-secondary/50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Assignments</p>
              <p className="mt-1 text-xl font-bold text-foreground">{assignments.length}</p>
            </div>
            <div className="rounded-2xl border-2 border-border bg-secondary/50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Locale</p>
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
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}

      <Card className="border-3 border-foreground p-6 shadow-stamp">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-foreground bg-primary text-primary-foreground">
            <Sparkles size={22} strokeWidth={2.5} />
          </div>
          <div>
            <h2 className="text-xl font-display font-bold text-foreground">Create an assignment</h2>
            <p className="text-sm text-muted-foreground">
              {builderMode === 'quick'
                ? 'Pick a Canvas page or assignment and let Lingual design a speaking practice tailored to it.'
                : 'Use Advanced mode to build from Canvas, a pasted source packet, a manual scaffold draft, or a scaffold-free custom system prompt.'}
            </p>
          </div>
        </div>

        <div className="mb-6 space-y-4">
          <div className="flex gap-2" role="tablist" aria-label="Assignment builder mode">
            <Button
              type="button"
              variant={builderMode === 'quick' ? 'default' : 'outline'}
              onClick={() => handleSelectBuilderMode('quick')}
            >
              Quick Assign
            </Button>
            <Button
              type="button"
              variant={builderMode === 'advanced' ? 'default' : 'outline'}
              onClick={() => handleSelectBuilderMode('advanced')}
            >
              Advanced
            </Button>
          </div>

          {builderMode === 'advanced' && (
            <div className="space-y-3 rounded-2xl border-2 border-border bg-secondary/40 p-4">
              <p className="text-sm font-semibold text-foreground">Advanced entry mode</p>
              <div role="radiogroup" aria-label="Advanced entry mode" className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {[
                  {
                    value: 'canvas' as const,
                    label: 'Canvas item',
                    description: 'Create from synced Canvas content.',
                  },
                  {
                    value: 'source' as const,
                    label: 'Custom Instruction',
                    description: 'Paste vocabulary, rubric notes, or lesson context.',
                  },
                  {
                    value: 'manual' as const,
                    label: 'Manual authoring',
                    description: 'Write the assignment directly on the scaffold.',
                  },
                  {
                    value: 'custom_prompt' as const,
                    label: 'Scaffold-free prompt',
                    description: 'Write the full system prompt. No scenario or grammar scaffolding; analytics show N/A.',
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
              <p className="text-sm font-semibold text-foreground">Connect a Canvas course first</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Lingual generates speaking practice from your Canvas pages, assignments, and discussions.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-3">
                <Button
                  onClick={() => navigate(`/app/teacher/classes/${classId}/canvas/connect`)}
                >
                  Connect Canvas
                </Button>
              </div>
            </div>
          )}

          {usesCanvasWorkflow && canvasContent.length > 0 && canvasPhase === 'idle' && (
            <div className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="canvas-item-picker" className="text-sm font-semibold text-foreground">
                  Canvas item
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
                  <option value="">Select a Canvas page or assignment...</option>
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
                  Lingual analyzes the Canvas item and drafts a scenario, target expressions, and success criteria.
                </p>
                <Button
                  onClick={() => handleCanvasGenerate()}
                  disabled={!selectedCanvasItemId}
                >
                  <Sparkles size={16} className="mr-2" />
                  Generate practice from this item
                </Button>
              </div>
            </div>
          )}

          {builderMode === 'advanced' && advancedEntryMode === 'source' && canvasPhase === 'idle' && (
            <div className="space-y-5">
              <Textarea
                label="Source packet"
                value={sourcePacketText}
                onChange={(event) => {
                  setSourcePacketText(event.target.value);
                  setCanvasError(null);
                }}
                placeholder="Paste key vocabulary, rubric notes, lesson context, or a custom teacher prompt."
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Lingual will turn the pasted packet into a draft scenario, target expressions, grammar focus, and success criteria.
                </p>
                <Button
                  onClick={() => void handleSourceDraftGenerate()}
                  disabled={!sourcePacketText.trim()}
                >
                  <Sparkles size={16} className="mr-2" />
                  Generate draft from source
                </Button>
              </div>
            </div>
          )}

          {canvasPhase === 'generating' && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Loader2 size={40} className="mb-4 animate-spin text-primary" />
              <p className="text-base font-semibold text-foreground">AI is designing your speaking practice…</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {usesCanvasWorkflow
                  ? `Analyzing ${canvasItemContext?.title || 'the selected Canvas item'} and generating a tailored scenario.`
                  : 'Analyzing your pasted source packet and generating a tailored scenario.'}
              </p>
            </div>
          )}

          {canvasPhase === 'error' && (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertDescription>{canvasError || 'Generation failed.'}</AlertDescription>
              </Alert>
              <div className="flex flex-wrap gap-3">
                <Button onClick={handleCanvasRegenerate}>Try again</Button>
                <Button variant="outline" onClick={handleCanvasPickDifferent}>
                  {builderMode === 'advanced' && advancedEntryMode === 'source'
                    ? 'Back to source input'
                    : 'Pick a different item'}
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
                    <Badge variant="accent" size="sm">AI draft</Badge>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-foreground">{canvasItemContext.title}</p>
                </div>
              )}

              {builderMode === 'advanced' && advancedEntryMode === 'source' && !canvasItemContext && (
                <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="accent" size="sm">Pasted source</Badge>
                    <Badge variant="outline" size="sm">AI draft</Badge>
                  </div>
                  <p className="mt-2 text-sm text-foreground/80 line-clamp-4">{sourcePacketText || draftInstructions}</p>
                </div>
              )}

              <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
                <div className="space-y-4">
                  <Input
                    label="Assignment title"
                    value={canvasTitle}
                    onChange={(event) => setCanvasTitle(event.target.value)}
                    placeholder="What students will see"
                  />
                  <Textarea
                    label="Description"
                    value={canvasDescription}
                    onChange={(event) => setCanvasDescription(event.target.value)}
                    placeholder="Brief description shown on the student dashboard"
                  />

                  {builderMode === 'advanced' && advancedEntryMode === 'custom_prompt' && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <label htmlFor="custom-system-prompt" className="text-base font-semibold text-foreground">
                          System prompt
                        </label>
                        <Badge variant="outline" size="sm">Raw · no scaffold</Badge>
                      </div>
                      <textarea
                        id="custom-system-prompt"
                        value={draftInstructions}
                        onChange={(event) => setDraftInstructions(event.target.value)}
                        rows={16}
                        placeholder="Write the complete system prompt the AI tutor will follow. No scenario, target expressions, grammar, or language-mix scaffolding will be added."
                        className="w-full rounded-xl border-3 border-border bg-card px-4 py-3 text-base text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      <p className="text-xs text-muted-foreground">
                        Analytics that depend on target expressions, grammar, or rubric dimensions will show N/A for this assignment.
                      </p>
                    </div>
                  )}
                  {builderMode === 'advanced' && advancedEntryMode !== 'custom_prompt' && (
                    <Textarea
                      label="Instructions"
                      value={draftInstructions}
                      onChange={(event) => setDraftInstructions(event.target.value)}
                      placeholder="Teacher instructions, pasted source packet, or guidance for the assignment."
                    />
                  )}

                  {advancedEntryMode !== 'custom_prompt' && (
                    <>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <label htmlFor="canvas-scenario" className="text-base font-semibold text-foreground">
                            Conversation scenario
                          </label>
                          {advancedEntryMode !== 'manual' && (
                            <Badge variant="accent" size="sm">AI-generated</Badge>
                          )}
                        </div>
                        <textarea
                          id="canvas-scenario"
                          value={canvasScenario}
                          onChange={(event) => setCanvasScenario(event.target.value)}
                          rows={5}
                          placeholder="Describe the speaking scenario the tutor will run."
                          className="w-full rounded-xl border-3 border-border bg-card px-4 py-3 text-base text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <p className="text-base font-semibold text-foreground">Target expressions</p>
                          {advancedEntryMode !== 'manual' && (
                            <Badge variant="accent" size="sm">AI-generated</Badge>
                          )}
                        </div>
                        <TagListEditor
                          items={canvasTargetExpressions}
                          onChange={setCanvasTargetExpressions}
                          placeholder="Add a target expression…"
                          ariaLabel="Target expressions"
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <p className="text-base font-semibold text-foreground">Target vocabulary</p>
                          {advancedEntryMode !== 'manual' && (
                            <Badge variant="accent" size="sm">AI-generated</Badge>
                          )}
                        </div>
                        <TagListEditor
                          items={canvasTargetVocabulary}
                          onChange={setCanvasTargetVocabulary}
                          placeholder="Add a target vocabulary word…"
                          ariaLabel="Target vocabulary"
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <p className="text-base font-semibold text-foreground">Focus grammar</p>
                          {advancedEntryMode !== 'manual' && (
                            <Badge variant="accent" size="sm">AI-generated</Badge>
                          )}
                        </div>
                        <TagListEditor
                          items={canvasFocusGrammar}
                          onChange={setCanvasFocusGrammar}
                          placeholder="Add a grammar point…"
                          ariaLabel="Focus grammar"
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <p className="text-base font-semibold text-foreground">Success criteria</p>
                          {advancedEntryMode !== 'manual' && (
                            <Badge variant="accent" size="sm">AI-generated</Badge>
                          )}
                        </div>
                        <TagListEditor
                          items={canvasSuccessCriteria}
                          onChange={setCanvasSuccessCriteria}
                          placeholder="Add a success criterion…"
                          ariaLabel="Success criteria"
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <p className="text-base font-semibold text-foreground">Objectives</p>
                          {advancedEntryMode !== 'manual' && canvasObjectivesFromAI && (
                            <Badge variant="accent" size="sm">AI-generated</Badge>
                          )}
                        </div>
                        <TagListEditor
                          items={canvasObjectives}
                          onChange={setCanvasObjectives}
                          placeholder="Add an objective…"
                          ariaLabel="Objectives"
                        />
                      </div>
                    </>
                  )}
                </div>

                <div className="space-y-4">
                  {advancedEntryMode !== 'custom_prompt' && (
                    <div className="space-y-3 rounded-2xl border-2 border-border bg-secondary/40 p-4">
                      <Textarea
                        label="Teacher notes"
                        value={canvasTeacherNotes}
                        onChange={(event) => setCanvasTeacherNotes(event.target.value)}
                        placeholder="Notes about pedagogical intent (optional)"
                        rows={8}
                        className="min-h-[220px]"
                      />
                    </div>
                  )}

                  {advancedEntryMode !== 'custom_prompt' && (
                  <div className="space-y-3 rounded-2xl border-2 border-border bg-secondary/40 p-4">
                    <div className="space-y-1">
                      <p id="canvas-language-mix-label" className="text-base font-semibold text-foreground">
                        AI tutor language mix
                      </p>
                      <p className="text-xs text-muted-foreground">
                        How much should the tutor stay in the target language vs. scaffold in English?
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
                            value: 'target_only',
                            label: 'Target language only',
                            hint: 'Best for advanced classes — AI replies stay in the target language.',
                          },
                          {
                            value: 'mostly_target',
                            label: 'Mostly target language',
                            hint: 'Default. Brief English when the learner stalls, then back to the target language.',
                          },
                          {
                            value: 'bilingual_scaffold',
                            label: 'Bilingual scaffolding',
                            hint: 'Best for novice classes — AI glosses new words in English in parentheses.',
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
                  )}

                  <div className="space-y-3 rounded-2xl border-2 border-border bg-secondary/40 p-4">
                    <p id="canvas-status-label" className="text-base font-semibold text-foreground">Status</p>
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
                        Draft
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
                        Published
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
                      {canvasStatus === 'published' ? 'Publish assignment' : 'Save as draft'}
                    </Button>
                    {advancedEntryMode !== 'manual' && advancedEntryMode !== 'custom_prompt' && (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={handleCanvasRegenerate}
                        disabled={canvasPhase === 'saving'}
                      >
                        Regenerate suggestions
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      className="w-full"
                      onClick={handleCanvasPickDifferent}
                      disabled={canvasPhase === 'saving'}
                    >
                      {builderMode === 'advanced' && (advancedEntryMode === 'manual' || advancedEntryMode === 'custom_prompt')
                        ? 'Start over'
                        : 'Pick a different item'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Assignments list */}
      <Card className="border-3 border-foreground p-6 shadow-stamp">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-foreground bg-primary text-primary-foreground">
              <GraduationCap size={22} strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-xl font-display font-bold text-foreground">Your assignments</h2>
              <p className="text-sm text-muted-foreground">
                Published assignments are live on your students' dashboards.
              </p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {assignments.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
                No assignments yet. Pick a Canvas item above and publish your first one!
              </div>
            ) : (
              assignments.map((assignment) => (
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
                        View analytics
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/app/assignments/${assignment.id}`)}
                      >
                        Preview
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
    </div>
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
    items: [...groupItems].sort((a, b) => a.itemPosition - b.itemPosition),
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
    const updated = [...items];
    updated[index] = value;
    onChange(updated);
  };

  return (
    <div className="space-y-2" aria-label={ariaLabel}>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
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
