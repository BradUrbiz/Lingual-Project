import { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { ArrowLeft, Loader2, Plus, Sparkles, Trash2, Check } from 'lucide-react';
import { Alert, AlertDescription, Badge, Button, Card, Input } from '@/components/ui';
import { generateCanvasPractice, createCanvasPractice } from '@/api/canvasPractice';
import type { CanvasPracticeSuggestions, CanvasItemContext } from '@/api/canvasPractice';

type Phase = 'generating' | 'reviewing' | 'saving' | 'success' | 'error';

const TASK_TYPE_OPTIONS = [
  { value: 'information_gap', label: 'Information Gap', description: 'Students exchange missing information' },
  { value: 'opinion_gap', label: 'Opinion Gap', description: 'Students share and compare opinions' },
  { value: 'decision_making', label: 'Decision Making', description: 'Students discuss and reach a decision' },
] as const;

export function CanvasPracticeBuilderPage() {
  const { classId, canvasContentId } = useParams<{ classId: string; canvasContentId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // Canvas item context (passed via navigation state or fetched from generate response)
  const navState = (location.state as { itemTitle?: string; moduleName?: string; itemType?: string }) || {};

  const [phase, setPhase] = useState<Phase>('generating');
  const [error, setError] = useState<string | null>(null);
  const [canvasItem, setCanvasItem] = useState<CanvasItemContext | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scenario, setScenario] = useState('');
  const [taskType, setTaskType] = useState('information_gap');
  const [targetExpressions, setTargetExpressions] = useState<string[]>([]);
  const [focusGrammar, setFocusGrammar] = useState<string[]>([]);
  const [successCriteria, setSuccessCriteria] = useState<string[]>([]);
  const [teacherNotes, setTeacherNotes] = useState('');
  const [status, setStatus] = useState<'draft' | 'published'>('published');
  const [, setCreatedAssignmentId] = useState<string | null>(null);

  // Generate on mount
  useEffect(() => {
    if (!classId || !canvasContentId) return;

    (async () => {
      try {
        const result = await generateCanvasPractice(classId, canvasContentId);
        if (!result.success) {
          setError(result.error || 'Generation failed');
          setPhase('error');
          return;
        }
        setCanvasItem(result.canvasItem);
        populateForm(result.suggestions);
        setPhase('reviewing');
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to generate practice');
        setPhase('error');
      }
    })();
  }, [classId, canvasContentId]);

  function populateForm(s: CanvasPracticeSuggestions) {
    setTitle(s.suggestedTitle);
    setDescription(s.suggestedDescription);
    setScenario(s.scenario);
    setTaskType(s.taskType);
    setTargetExpressions(s.targetExpressions);
    setFocusGrammar(s.focusGrammar);
    setSuccessCriteria(s.successCriteria);
    setTeacherNotes(s.teacherNotes);
  }

  async function handleCreate() {
    if (!classId || !canvasContentId) return;
    setPhase('saving');
    setError(null);
    try {
      const result = await createCanvasPractice(classId, {
        canvasContentId,
        canvasModuleItemId: canvasItem?.canvasItemId || '',
        title,
        description,
        scenario,
        targetExpressions,
        focusGrammar,
        successCriteria,
        taskType,
        teacherNotes,
        status,
      });
      if (result.success) {
        setCreatedAssignmentId(result.assignmentId);
        setPhase('success');
      } else {
        throw new Error('Creation failed');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create practice');
      setPhase('reviewing');
    }
  }

  async function handleRetry() {
    setPhase('generating');
    setError(null);
    if (!classId || !canvasContentId) return;
    try {
      const result = await generateCanvasPractice(classId, canvasContentId);
      if (!result.success) {
        setError(result.error || 'Generation failed');
        setPhase('error');
        return;
      }
      setCanvasItem(result.canvasItem);
      populateForm(result.suggestions);
      setPhase('reviewing');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate');
      setPhase('error');
    }
  }

  const itemTitle = canvasItem?.title || navState.itemTitle || 'Canvas Item';
  const moduleName = canvasItem?.moduleName || navState.moduleName || '';

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* Header */}
      <div>
        <button
          className="mb-3 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <div className="flex items-center gap-3">
          <Sparkles size={24} className="text-amber-500" />
          <div>
            <h1 className="text-2xl font-bold">Create Speaking Practice</h1>
            <p className="text-sm text-muted-foreground">
              {moduleName && <span>{moduleName} &middot; </span>}
              {itemTitle}
            </p>
          </div>
        </div>
      </div>

      {/* Generating phase */}
      {phase === 'generating' && (
        <Card className="p-12 text-center">
          <Loader2 size={40} className="mx-auto mb-4 animate-spin text-amber-500" />
          <p className="text-lg font-medium">AI is designing your speaking practice...</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Analyzing &quot;{itemTitle}&quot; and generating a tailored conversation scenario
          </p>
        </Card>
      )}

      {/* Error phase */}
      {phase === 'error' && (
        <Card className="p-8 text-center">
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button onClick={handleRetry}>Try Again</Button>
        </Card>
      )}

      {/* Success phase */}
      {phase === 'success' && (
        <Card className="p-8 text-center">
          <Check size={40} className="mx-auto mb-4 text-green-600" />
          <h2 className="text-xl font-bold">Practice Created!</h2>
          <p className="mt-1 text-muted-foreground">
            &quot;{title}&quot; has been {status === 'published' ? 'published' : 'saved as draft'}.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button variant="outline" onClick={() => navigate(-1)}>
              Back to Class
            </Button>
            <Button onClick={() => navigate(`/app/teacher`)}>
              Dashboard
            </Button>
          </div>
        </Card>
      )}

      {/* Review/edit phase */}
      {(phase === 'reviewing' || phase === 'saving') && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left column (2/3) */}
          <div className="space-y-4 lg:col-span-2">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Title & Description */}
            <Card className="space-y-3 p-4">
              <label className="text-sm font-medium">Title</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Assignment title"
              />
              <label className="text-sm font-medium">Description</label>
              <textarea
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Brief description for students"
              />
            </Card>

            {/* Scenario */}
            <Card className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">Conversation Scenario</label>
                <Badge variant="secondary" className="text-xs">AI-generated</Badge>
              </div>
              <textarea
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
                rows={4}
                placeholder="Describe the speaking scenario..."
              />
            </Card>

            {/* Target Expressions */}
            <Card className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">Target Expressions</label>
                <Badge variant="secondary" className="text-xs">AI-generated</Badge>
              </div>
              <TagListEditor
                items={targetExpressions}
                onChange={setTargetExpressions}
                placeholder="Add expression..."
              />
            </Card>

            {/* Focus Grammar */}
            <Card className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">Focus Grammar</label>
                <Badge variant="secondary" className="text-xs">AI-generated</Badge>
              </div>
              <TagListEditor
                items={focusGrammar}
                onChange={setFocusGrammar}
                placeholder="Add grammar point..."
              />
            </Card>

            {/* Success Criteria */}
            <Card className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">Success Criteria</label>
                <Badge variant="secondary" className="text-xs">AI-generated</Badge>
              </div>
              <TagListEditor
                items={successCriteria}
                onChange={setSuccessCriteria}
                placeholder="Add criterion..."
              />
            </Card>
          </div>

          {/* Right column (1/3) */}
          <div className="space-y-4">
            {/* Task Type */}
            <Card className="space-y-3 p-4">
              <label className="text-sm font-medium">Task Type</label>
              {TASK_TYPE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                    taskType === opt.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="taskType"
                    value={opt.value}
                    checked={taskType === opt.value}
                    onChange={() => setTaskType(opt.value)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium">{opt.label}</div>
                    <div className="text-xs text-muted-foreground">{opt.description}</div>
                  </div>
                </label>
              ))}
            </Card>

            {/* Teacher Notes */}
            <Card className="space-y-3 p-4">
              <label className="text-sm font-medium">Teacher Notes</label>
              <textarea
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={teacherNotes}
                onChange={(e) => setTeacherNotes(e.target.value)}
                rows={3}
                placeholder="Notes about pedagogical intent..."
              />
            </Card>

            {/* Publish Controls */}
            <Card className="space-y-4 p-4">
              <label className="text-sm font-medium">Status</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    status === 'draft' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'
                  }`}
                  onClick={() => setStatus('draft')}
                >
                  Draft
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    status === 'published' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'
                  }`}
                  onClick={() => setStatus('published')}
                >
                  Published
                </button>
              </div>

              <Button
                className="w-full"
                disabled={phase === 'saving' || !title.trim() || !scenario.trim()}
                onClick={handleCreate}
              >
                {phase === 'saving' ? (
                  <>
                    <Loader2 size={16} className="mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Sparkles size={16} className="mr-2" />
                    Create Practice
                  </>
                )}
              </Button>

              <Button variant="outline" className="w-full" onClick={handleRetry} disabled={phase === 'saving'}>
                Regenerate Suggestions
              </Button>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

/** Editable list of string tags with add/remove. */
function TagListEditor({
  items,
  onChange,
  placeholder,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  const [newValue, setNewValue] = useState('');

  function handleAdd() {
    const v = newValue.trim();
    if (v && !items.includes(v)) {
      onChange([...items, v]);
      setNewValue('');
    }
  }

  function handleRemove(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  function handleEdit(index: number, value: string) {
    const updated = [...items];
    updated[index] = value;
    onChange(updated);
  }

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={item}
            onChange={(e) => handleEdit(i, e.target.value)}
            className="flex-1"
          />
          <button
            type="button"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => handleRemove(i)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder={placeholder}
          className="flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
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
