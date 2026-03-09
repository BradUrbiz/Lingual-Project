import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Eye,
  GraduationCap,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { createAssignment, createCurriculumMapping, getCurriculumMappings, getTeacherAssignments, getTeacherCurriculumPackages } from '@/api/assignments';
import { getSampleCurriculumPackage } from '@/api/curriculum';
import { getTeacherClasses } from '@/api/teacher';
import { Alert, AlertDescription, Badge, Button, Card, Input, Textarea } from '@/components/ui';
import { useLanguage } from '@/contexts/LanguageContext';
import type {
  ActivityTemplateDefinition,
  AssignmentTaskType,
  CreateAssignmentPayload,
  CreateCurriculumMappingPayload,
  CurriculumMappingDto,
  CurriculumPackageV1,
  ModalityMode,
  StudentAssignmentSummary,
  TeacherClassSummary,
  TeacherCurriculumPackageSummary,
} from '@/types';

type MappingFormState = {
  packageId: string;
  moduleId: string;
  situationId: string;
  objectiveIds: string[];
  targetExpressionsText: string;
  focusGrammarText: string;
  allowedContextTagsText: string;
  rubricFocusText: string;
  teacherNotes: string;
  feedbackMode: string;
  targetOnlyStrict: boolean;
  recastDefault: boolean;
  elicitationRepeatThreshold: string;
  endReviewEnabled: boolean;
  silenceToleranceMs: string;
  hintLadderText: string;
  maxModelingSteps: string;
  minStudentTurnWords: string;
  followUpPressure: 'light' | 'balanced' | 'high';
  allowClarificationRequests: boolean;
  modalityMode: ModalityMode;
  voiceMinutesCap: string;
  textFallbackEnabled: boolean;
};

type AssignmentFormState = {
  mappingId: string;
  title: string;
  description: string;
  status: 'draft' | 'published' | 'archived';
  releaseAt: string;
  dueAt: string;
  taskType: AssignmentTaskType;
  successCriteriaText: string;
  maxAttempts: string;
  overrideMode: 'inherit' | ModalityMode;
  overrideVoiceMinutesCap: string;
  overrideTextFallbackEnabled: boolean;
};

const DEFAULT_MAPPING_FORM: MappingFormState = {
  packageId: '',
  moduleId: '',
  situationId: '',
  objectiveIds: [],
  targetExpressionsText: '',
  focusGrammarText: '',
  allowedContextTagsText: '',
  rubricFocusText: '',
  teacherNotes: '',
  feedbackMode: 'balanced',
  targetOnlyStrict: false,
  recastDefault: true,
  elicitationRepeatThreshold: '3',
  endReviewEnabled: true,
  silenceToleranceMs: '3000',
  hintLadderText: 'wait\ncontext_hint\nchoice_prompt\nmodel_and_retry',
  maxModelingSteps: '1',
  minStudentTurnWords: '8',
  followUpPressure: 'balanced',
  allowClarificationRequests: true,
  modalityMode: 'hybrid',
  voiceMinutesCap: '',
  textFallbackEnabled: true,
};

const DEFAULT_ASSIGNMENT_FORM: AssignmentFormState = {
  mappingId: '',
  title: '',
  description: '',
  status: 'draft',
  releaseAt: '',
  dueAt: '',
  taskType: 'decision_making',
  successCriteriaText: '',
  maxAttempts: '',
  overrideMode: 'inherit',
  overrideVoiceMinutesCap: '',
  overrideTextFallbackEnabled: true,
};

const FEEDBACK_MODE_OPTIONS = [
  { value: 'fluency_first', label: 'Fluency first' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'accuracy_first', label: 'Accuracy first' },
];

const TASK_TYPE_OPTIONS: Array<{ value: AssignmentTaskType; label: string }> = [
  { value: 'information_gap', label: 'Information gap' },
  { value: 'opinion_gap', label: 'Opinion gap' },
  { value: 'decision_making', label: 'Decision making' },
];

const MODALITY_OPTIONS: Array<{ value: ModalityMode; label: string }> = [
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'voice_only', label: 'Voice only' },
  { value: 'text_only', label: 'Text only' },
];

const FOLLOW_UP_PRESSURE_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'high', label: 'High' },
] as const;

function getLocalizedText(
  value: Record<string, string> | undefined,
  lang: 'en' | 'ko',
  fallback = ''
): string {
  if (!value) return fallback;
  return value[lang] || value.en || Object.values(value)[0] || fallback;
}

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseOptionalInt(value: string): number | null | undefined {
  const cleaned = value.trim();
  if (!cleaned) return undefined;
  const parsed = Number.parseInt(cleaned, 10);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function formatStatusVariant(status: string): 'success' | 'secondary' | 'outline' {
  if (status === 'published') return 'success';
  if (status === 'archived') return 'secondary';
  return 'outline';
}

function describeOutputPressure(mapping: CurriculumMappingDto): string {
  const policy = mapping.outputPolicy;
  if (!policy) {
    return 'Uses backend defaults derived at launch time.';
  }

  return `${policy.minStudentTurnWords}+ words per turn · ${policy.followUpPressure.replace('_', ' ')} follow-up pressure · clarification ${policy.allowClarificationRequests ? 'allowed' : 'limited'}`;
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildTemplateIndex(curriculum: CurriculumPackageV1 | null): Map<string, ActivityTemplateDefinition> {
  return new Map((curriculum?.templates.activityTemplates || []).map((template) => [template.id, template]));
}

function resolveActivityTemplates(
  curriculum: CurriculumPackageV1 | null,
  objectiveIds: string[]
): {
  templates: ActivityTemplateDefinition[];
  refs: string[];
  unresolvedRefs: string[];
} {
  const templateIndex = buildTemplateIndex(curriculum);
  const objectives =
    curriculum?.objectives.filter((objective) => objectiveIds.includes(objective.id)) || [];
  const refs = dedupeStrings(objectives.flatMap((objective) => objective.templateRefs || []));
  const templates = refs
    .map((ref) => templateIndex.get(ref))
    .filter((template): template is ActivityTemplateDefinition => Boolean(template));
  const unresolvedRefs = refs.filter((ref) => !templateIndex.has(ref));

  return {
    templates,
    refs,
    unresolvedRefs,
  };
}

function describeInteractionContract(
  curriculum: CurriculumPackageV1 | null,
  objectiveIds: string[],
  lang: 'en' | 'ko'
): string {
  const { templates, unresolvedRefs } = resolveActivityTemplates(curriculum, objectiveIds);
  if (templates.length > 0) {
    return templates.map((template) => getLocalizedText(template.title, lang, template.id)).join(' · ');
  }
  if (unresolvedRefs.length > 0) {
    return `Missing template definitions for ${unresolvedRefs.join(', ')}`;
  }
  return 'No structured interaction contract linked yet.';
}

export function TeacherAssignmentBuilderPage() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const { lang } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [savingMapping, setSavingMapping] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [teacherClasses, setTeacherClasses] = useState<TeacherClassSummary[]>([]);
  const [curriculum, setCurriculum] = useState<CurriculumPackageV1 | null>(null);
  const [packageSummaries, setPackageSummaries] = useState<TeacherCurriculumPackageSummary[]>([]);
  const [packageLimitations, setPackageLimitations] = useState<string[]>([]);
  const [mappings, setMappings] = useState<CurriculumMappingDto[]>([]);
  const [assignments, setAssignments] = useState<StudentAssignmentSummary[]>([]);
  const [mappingForm, setMappingForm] = useState<MappingFormState>(DEFAULT_MAPPING_FORM);
  const [assignmentForm, setAssignmentForm] = useState<AssignmentFormState>(DEFAULT_ASSIGNMENT_FORM);

  const activeClass = teacherClasses.find((item) => item.id === classId) || null;
  const selectedModule = curriculum?.modules.find((module) => module.id === mappingForm.moduleId) || null;
  const selectedPackageId = packageSummaries[0]?.id || curriculum?.curriculum.id || '';
  const speakingSituations = selectedModule
    ? [
        ...selectedModule.situations.interpersonal_speaking.map((situation) => ({
          ...situation,
          label: `${getLocalizedText(selectedModule.title, lang, selectedModule.id)} · Interpersonal`,
        })),
        ...selectedModule.situations.presentational_speaking.map((situation) => ({
          ...situation,
          label: `${getLocalizedText(selectedModule.title, lang, selectedModule.id)} · Presentational`,
        })),
      ]
    : [];
  const selectedSituation = speakingSituations.find((item) => item.id === mappingForm.situationId) || null;
  const moduleObjectives = curriculum?.objectives.filter((objective) => objective.moduleId === mappingForm.moduleId) || [];
  const selectedObjectives = moduleObjectives.filter((objective) => mappingForm.objectiveIds.includes(objective.id));
  const selectedTemplatePreview = resolveActivityTemplates(
    curriculum,
    selectedObjectives.map((objective) => objective.id)
  );

  const loadClassData = async (nextClassId: string) => {
    const [classes, packageResult, sampleCurriculum, classMappings, classAssignments] = await Promise.all([
      getTeacherClasses(),
      getTeacherCurriculumPackages(nextClassId),
      getSampleCurriculumPackage(),
      getCurriculumMappings(nextClassId),
      getTeacherAssignments(nextClassId),
    ]);

    setTeacherClasses(classes);
    setPackageSummaries(packageResult.packages);
    setPackageLimitations(packageResult.limitations);
    setCurriculum(sampleCurriculum);
    setMappings(classMappings);
    setAssignments(classAssignments);
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

  useEffect(() => {
    if (!curriculum) return;

    setMappingForm((current) => {
      const nextPackageId = current.packageId || selectedPackageId;
      const nextModuleId =
        current.moduleId && curriculum.modules.some((module) => module.id === current.moduleId)
          ? current.moduleId
          : curriculum.modules[0]?.id || '';
      const nextModule = curriculum.modules.find((module) => module.id === nextModuleId);
      const nextSituations = nextModule
        ? [
            ...nextModule.situations.interpersonal_speaking,
            ...nextModule.situations.presentational_speaking,
          ]
        : [];
      const nextSituationId =
        current.situationId && nextSituations.some((situation) => situation.id === current.situationId)
          ? current.situationId
          : nextSituations[0]?.id || '';
      const nextSituation = nextSituations.find((situation) => situation.id === nextSituationId);
      const allowedObjectiveIds = new Set(
        curriculum.objectives
          .filter((objective) => objective.moduleId === nextModuleId)
          .map((objective) => objective.id)
      );
      const nextObjectiveIds = current.objectiveIds.filter((objectiveId) => allowedObjectiveIds.has(objectiveId));
      const fallbackObjectiveIds =
        nextObjectiveIds.length > 0
          ? nextObjectiveIds
          : (nextSituation?.objectiveIds || []).filter((objectiveId) => allowedObjectiveIds.has(objectiveId));

      if (
        current.packageId === nextPackageId &&
        current.moduleId === nextModuleId &&
        current.situationId === nextSituationId &&
        current.objectiveIds.join('|') === fallbackObjectiveIds.join('|')
      ) {
        return current;
      }

      return {
        ...current,
        packageId: nextPackageId,
        moduleId: nextModuleId,
        situationId: nextSituationId,
        objectiveIds: fallbackObjectiveIds,
      };
    });
  }, [curriculum, selectedPackageId]);

  useEffect(() => {
    if (!mappings.length) return;
    setAssignmentForm((current) => {
      if (current.mappingId && mappings.some((mapping) => mapping.id === current.mappingId)) {
        return current;
      }
      return {
        ...current,
        mappingId: mappings[0].id,
      };
    });
  }, [mappings]);

  const handleMappingField = <K extends keyof MappingFormState>(field: K, value: MappingFormState[K]) => {
    setMappingForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleAssignmentField = <K extends keyof AssignmentFormState>(field: K, value: AssignmentFormState[K]) => {
    setAssignmentForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleObjectiveToggle = (objectiveId: string) => {
    setMappingForm((current) => {
      const alreadySelected = current.objectiveIds.includes(objectiveId);
      return {
        ...current,
        objectiveIds: alreadySelected
          ? current.objectiveIds.filter((id) => id !== objectiveId)
          : [...current.objectiveIds, objectiveId],
      };
    });
  };

  const handleCreateMapping = async () => {
    if (!classId) return;

    const elicitationRepeatThreshold = parseOptionalInt(mappingForm.elicitationRepeatThreshold);
    const silenceToleranceMs = parseOptionalInt(mappingForm.silenceToleranceMs);
    const maxModelingSteps = parseOptionalInt(mappingForm.maxModelingSteps);
    const minStudentTurnWords = parseOptionalInt(mappingForm.minStudentTurnWords);
    const voiceMinutesCap = parseOptionalInt(mappingForm.voiceMinutesCap);

    if (
      elicitationRepeatThreshold === null ||
      silenceToleranceMs === null ||
      maxModelingSteps === null ||
      minStudentTurnWords === null
    ) {
      setError('Feedback, scaffold, and output-pressure numeric fields must be valid numbers.');
      return;
    }
    if (voiceMinutesCap === null) {
      setError('Voice minutes cap must be blank or a valid number.');
      return;
    }

    setSavingMapping(true);
    setError(null);
    setSuccessMessage(null);

    const payload: CreateCurriculumMappingPayload = {
      packageId: mappingForm.packageId,
      moduleId: mappingForm.moduleId,
      objectiveIds: mappingForm.objectiveIds,
      situationIds: mappingForm.situationId ? [mappingForm.situationId] : [],
      targetExpressions: splitLines(mappingForm.targetExpressionsText),
      focusGrammar: splitLines(mappingForm.focusGrammarText),
      allowedContextTags: splitLines(mappingForm.allowedContextTagsText),
      rubricFocus: splitLines(mappingForm.rubricFocusText),
      teacherNotes: mappingForm.teacherNotes.trim(),
      feedbackPolicy: {
        mode: mappingForm.feedbackMode,
        targetOnlyStrict: mappingForm.targetOnlyStrict,
        recastDefault: mappingForm.recastDefault,
        elicitationRepeatThreshold: elicitationRepeatThreshold ?? 3,
        endReviewEnabled: mappingForm.endReviewEnabled,
      },
      scaffoldPolicy: {
        silenceToleranceMs: silenceToleranceMs ?? 3000,
        hintLadder: splitLines(mappingForm.hintLadderText),
        maxModelingSteps: maxModelingSteps ?? 1,
      },
      outputPolicy: {
        minStudentTurnWords: minStudentTurnWords ?? 8,
        followUpPressure: mappingForm.followUpPressure,
        allowClarificationRequests: mappingForm.allowClarificationRequests,
      },
      modalityPolicy: {
        mode: mappingForm.modalityMode,
        voiceMinutesCap: voiceMinutesCap ?? null,
        textFallbackEnabled: mappingForm.textFallbackEnabled,
      },
    };

    try {
      const createdMapping = await createCurriculumMapping(classId, payload);
      await loadClassData(classId);
      setSuccessMessage('Curriculum mapping created. You can now attach an assignment to it.');
      setAssignmentForm((current) => ({
        ...current,
        mappingId: createdMapping.id,
      }));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to create curriculum mapping.');
    } finally {
      setSavingMapping(false);
    }
  };

  const handleCreateAssignment = async () => {
    if (!classId) return;

    const maxAttempts = parseOptionalInt(assignmentForm.maxAttempts);
    const overrideVoiceMinutesCap = parseOptionalInt(assignmentForm.overrideVoiceMinutesCap);

    if (maxAttempts === null) {
      setError('Max attempts must be blank or a valid number.');
      return;
    }
    if (overrideVoiceMinutesCap === null) {
      setError('Override voice minutes cap must be blank or a valid number.');
      return;
    }

    setSavingAssignment(true);
    setError(null);
    setSuccessMessage(null);

    const payload: CreateAssignmentPayload = {
      mappingId: assignmentForm.mappingId,
      title: assignmentForm.title.trim(),
      description: assignmentForm.description.trim(),
      status: assignmentForm.status,
      releaseAt: assignmentForm.releaseAt || undefined,
      dueAt: assignmentForm.dueAt || undefined,
      taskType: assignmentForm.taskType,
      successCriteria: splitLines(assignmentForm.successCriteriaText),
      maxAttempts: maxAttempts ?? null,
    };

    if (assignmentForm.overrideMode !== 'inherit') {
      payload.modalityOverride = {
        mode: assignmentForm.overrideMode,
        voiceMinutesCap: overrideVoiceMinutesCap ?? null,
        textFallbackEnabled: assignmentForm.overrideTextFallbackEnabled,
      };
    }

    try {
      const createdAssignment = await createAssignment(classId, payload);
      await loadClassData(classId);
      setAssignmentForm({
        ...DEFAULT_ASSIGNMENT_FORM,
        mappingId: createdAssignment.mappingId,
      });
      setSuccessMessage('Assignment created. Students can now launch it from their learning dashboard.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to create assignment.');
    } finally {
      setSavingAssignment(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!activeClass || !curriculum) {
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
              Build the curriculum mapping first, then publish an assignment that bootstraps assignment-aware realtime
              practice for this class.
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

      {packageLimitations.map((message) => (
        <Alert key={message}>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ))}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-3 border-foreground p-6 shadow-stamp">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-foreground bg-primary text-primary-foreground">
              <BookOpen size={22} strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-xl font-display font-bold text-foreground">1. Curriculum mapping</h2>
              <p className="text-sm text-muted-foreground">
                Choose the curriculum scope and define the teacher policy that will shape the live assignment prompt.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="mapping-package" className="text-base font-semibold text-foreground">
                Package
              </label>
              <select
                id="mapping-package"
                value={mappingForm.packageId}
                onChange={(event) => handleMappingField('packageId', event.target.value)}
                className="h-12 w-full rounded-xl border-3 border-border bg-card px-4 text-base text-foreground focus:border-primary focus:outline-none"
              >
                {packageSummaries.map((item) => (
                  <option key={item.id} value={item.id}>
                    {getLocalizedText(item.title, lang, item.id)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="mapping-module" className="text-base font-semibold text-foreground">
                Module
              </label>
              <select
                id="mapping-module"
                value={mappingForm.moduleId}
                onChange={(event) => handleMappingField('moduleId', event.target.value)}
                className="h-12 w-full rounded-xl border-3 border-border bg-card px-4 text-base text-foreground focus:border-primary focus:outline-none"
              >
                {curriculum.modules.map((module) => (
                  <option key={module.id} value={module.id}>
                    {getLocalizedText(module.title, lang, module.id)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <label htmlFor="mapping-situation" className="text-base font-semibold text-foreground">
              Speaking situation
            </label>
            <select
              id="mapping-situation"
              value={mappingForm.situationId}
              onChange={(event) => handleMappingField('situationId', event.target.value)}
              className="h-12 w-full rounded-xl border-3 border-border bg-card px-4 text-base text-foreground focus:border-primary focus:outline-none"
            >
              {speakingSituations.map((situation) => (
                <option key={situation.id} value={situation.id}>
                  {situation.id} · {situation.label}
                </option>
              ))}
            </select>
            {selectedSituation ? (
              <p className="text-sm text-muted-foreground">
                {selectedSituation.seed.setting} · context tags: {(selectedSituation.seed.contextTags || []).join(', ') || 'n/a'}
              </p>
            ) : null}
          </div>

          <div className="mt-5">
            <h3 className="text-base font-semibold text-foreground">Objectives</h3>
            <div className="mt-3 grid gap-3">
              {moduleObjectives.map((objective) => {
                const checked = mappingForm.objectiveIds.includes(objective.id);
                return (
                  <label
                    key={objective.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 p-4 transition-colors ${
                      checked ? 'border-primary bg-primary/5' : 'border-border bg-secondary/40'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleObjectiveToggle(objective.id)}
                      className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    />
                    <div>
                      <p className="text-sm font-semibold text-foreground">{objective.id}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {getLocalizedText(objective.canDo, lang, objective.id)}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Textarea
              label="Target expressions"
              value={mappingForm.targetExpressionsText}
              onChange={(event) => handleMappingField('targetExpressionsText', event.target.value)}
              placeholder={'Could I have\nI would like'}
            />
            <Textarea
              label="Focus grammar"
              value={mappingForm.focusGrammarText}
              onChange={(event) => handleMappingField('focusGrammarText', event.target.value)}
              placeholder={'past tense narrative\npolite requests'}
            />
            <Textarea
              label="Allowed context tags"
              value={mappingForm.allowedContextTagsText}
              onChange={(event) => handleMappingField('allowedContextTagsText', event.target.value)}
              placeholder={'restaurant\nordering'}
            />
            <Textarea
              label="Rubric focus"
              value={mappingForm.rubricFocusText}
              onChange={(event) => handleMappingField('rubricFocusText', event.target.value)}
              placeholder={'task_completion\nextended_output'}
            />
          </div>

          <div className="mt-4">
            <Textarea
              label="Teacher notes"
              value={mappingForm.teacherNotes}
              onChange={(event) => handleMappingField('teacherNotes', event.target.value)}
              placeholder="Keep the learner inside this week's class target and only broaden vocabulary if they stall."
            />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-2 2xl:grid-cols-4">
            <div className="space-y-4 rounded-2xl border-2 border-border bg-secondary/40 p-4">
              <h3 className="text-base font-semibold text-foreground">Feedback policy</h3>
              <div className="space-y-2">
                <label htmlFor="mapping-feedback-mode" className="text-sm font-semibold text-foreground">
                  Mode
                </label>
                <select
                  id="mapping-feedback-mode"
                  value={mappingForm.feedbackMode}
                  onChange={(event) => handleMappingField('feedbackMode', event.target.value)}
                  className="h-11 w-full rounded-xl border-2 border-border bg-card px-4 text-sm text-foreground focus:border-primary focus:outline-none"
                >
                  {FEEDBACK_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <Input
                label="Elicitation repeat threshold"
                type="number"
                min={1}
                value={mappingForm.elicitationRepeatThreshold}
                onChange={(event) => handleMappingField('elicitationRepeatThreshold', event.target.value)}
              />
              <label className="flex items-center gap-3 text-sm font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={mappingForm.targetOnlyStrict}
                  onChange={(event) => handleMappingField('targetOnlyStrict', event.target.checked)}
                />
                Target grammar only strict
              </label>
              <label className="flex items-center gap-3 text-sm font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={mappingForm.recastDefault}
                  onChange={(event) => handleMappingField('recastDefault', event.target.checked)}
                />
                Recast by default
              </label>
              <label className="flex items-center gap-3 text-sm font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={mappingForm.endReviewEnabled}
                  onChange={(event) => handleMappingField('endReviewEnabled', event.target.checked)}
                />
                End-of-session review
              </label>
            </div>

            <div className="space-y-4 rounded-2xl border-2 border-border bg-secondary/40 p-4">
              <h3 className="text-base font-semibold text-foreground">Scaffold ladder</h3>
              <Input
                label="Silence tolerance (ms)"
                type="number"
                min={0}
                value={mappingForm.silenceToleranceMs}
                onChange={(event) => handleMappingField('silenceToleranceMs', event.target.value)}
              />
              <Input
                label="Max modeling steps"
                type="number"
                min={0}
                value={mappingForm.maxModelingSteps}
                onChange={(event) => handleMappingField('maxModelingSteps', event.target.value)}
              />
              <Textarea
                label="Hint ladder"
                value={mappingForm.hintLadderText}
                onChange={(event) => handleMappingField('hintLadderText', event.target.value)}
                placeholder={'wait\ncontext_hint\nchoice_prompt\nmodel_and_retry'}
              />
            </div>

            <div className="space-y-4 rounded-2xl border-2 border-border bg-secondary/40 p-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">Output pressure</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Control how hard the tutor pushes students past short or one-word answers.
                </p>
              </div>
              <Input
                label="Minimum student turn words"
                type="number"
                min={1}
                value={mappingForm.minStudentTurnWords}
                onChange={(event) => handleMappingField('minStudentTurnWords', event.target.value)}
              />
              <div className="space-y-2">
                <label htmlFor="mapping-follow-up-pressure" className="text-sm font-semibold text-foreground">
                  Follow-up pressure
                </label>
                <select
                  id="mapping-follow-up-pressure"
                  value={mappingForm.followUpPressure}
                  onChange={(event) =>
                    handleMappingField(
                      'followUpPressure',
                      event.target.value as MappingFormState['followUpPressure']
                    )
                  }
                  className="h-11 w-full rounded-xl border-2 border-border bg-card px-4 text-sm text-foreground focus:border-primary focus:outline-none"
                >
                  {FOLLOW_UP_PRESSURE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-3 text-sm font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={mappingForm.allowClarificationRequests}
                  onChange={(event) => handleMappingField('allowClarificationRequests', event.target.checked)}
                />
                Allow clarification requests
              </label>
            </div>

            <div className="space-y-4 rounded-2xl border-2 border-border bg-secondary/40 p-4">
              <h3 className="text-base font-semibold text-foreground">Modality policy</h3>
              <div className="space-y-2">
                <label htmlFor="mapping-modality-mode" className="text-sm font-semibold text-foreground">
                  Mode
                </label>
                <select
                  id="mapping-modality-mode"
                  value={mappingForm.modalityMode}
                  onChange={(event) => handleMappingField('modalityMode', event.target.value as ModalityMode)}
                  className="h-11 w-full rounded-xl border-2 border-border bg-card px-4 text-sm text-foreground focus:border-primary focus:outline-none"
                >
                  {MODALITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <Input
                label="Voice minutes cap"
                type="number"
                min={0}
                value={mappingForm.voiceMinutesCap}
                onChange={(event) => handleMappingField('voiceMinutesCap', event.target.value)}
                placeholder="Optional"
              />
              <label className="flex items-center gap-3 text-sm font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={mappingForm.textFallbackEnabled}
                  onChange={(event) => handleMappingField('textFallbackEnabled', event.target.checked)}
                />
                Allow text fallback
              </label>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <Button onClick={handleCreateMapping} loading={savingMapping}>
              Save curriculum mapping
            </Button>
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="border-3 border-foreground p-6 shadow-stamp">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-foreground bg-secondary text-foreground">
                <Eye size={22} strokeWidth={2.5} />
              </div>
              <div>
                <h2 className="text-xl font-display font-bold text-foreground">Interaction contract preview</h2>
                <p className="text-sm text-muted-foreground">
                  This is the structured curriculum template the tutor will follow before teacher overlay policies are applied.
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border-2 border-border bg-secondary/40 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" size="sm">
                  {selectedObjectives.length} objective{selectedObjectives.length === 1 ? '' : 's'}
                </Badge>
                {selectedSituation ? (
                  <Badge variant="secondary" size="sm">
                    {selectedSituation.id} · {selectedSituation.seed.setting}
                  </Badge>
                ) : null}
                <Badge variant="accent" size="sm">
                  {selectedTemplatePreview.templates.length} structured template
                  {selectedTemplatePreview.templates.length === 1 ? '' : 's'}
                </Badge>
              </div>
              {selectedSituation ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Roles: {(selectedSituation.seed.roles || []).join(', ') || 'n/a'} · Register:{' '}
                  {selectedSituation.seed.register || 'n/a'}
                </p>
              ) : null}
              <p className="mt-1 text-sm text-muted-foreground">
                Objective contract: {describeInteractionContract(curriculum, mappingForm.objectiveIds, lang)}
              </p>
            </div>

            {selectedObjectives.length === 0 ? (
              <div className="mt-4 rounded-2xl border-2 border-dashed border-border bg-secondary/30 p-5 text-sm text-muted-foreground">
                Select at least one objective to inspect the interaction contract.
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border-2 border-border bg-card p-4">
                  <p className="text-sm font-semibold text-foreground">Selected objective evidence</p>
                  <div className="mt-3 space-y-3">
                    {selectedObjectives.map((objective) => (
                      <div key={objective.id} className="rounded-2xl border border-border/80 bg-secondary/30 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" size="sm">
                            {objective.id}
                          </Badge>
                          {objective.templateRefs.map((templateRef) => (
                            <Badge key={templateRef} variant="secondary" size="sm">
                              {templateRef}
                            </Badge>
                          ))}
                        </div>
                        <p className="mt-2 text-sm text-foreground">
                          {getLocalizedText(objective.canDo, lang, objective.id)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {selectedTemplatePreview.unresolvedRefs.length > 0 ? (
                  <Alert variant="destructive">
                    <AlertDescription>
                      Missing structured template definitions for: {selectedTemplatePreview.unresolvedRefs.join(', ')}
                    </AlertDescription>
                  </Alert>
                ) : null}

                {selectedTemplatePreview.templates.length === 0 ? (
                  <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/30 p-5 text-sm text-muted-foreground">
                    The selected objectives do not currently resolve to a structured interaction contract.
                  </div>
                ) : (
                  selectedTemplatePreview.templates.map((template) => (
                    <div key={template.id} className="rounded-3xl border-2 border-border bg-card p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" size="sm">
                              {template.id}
                            </Badge>
                            <Badge variant="secondary" size="sm">
                              {template.mode.replace('_', ' ')}
                            </Badge>
                          </div>
                          <h3 className="mt-3 text-lg font-display font-bold text-foreground">
                            {getLocalizedText(template.title, lang, template.id)}
                          </h3>
                          <p className="mt-2 text-sm text-muted-foreground">{template.assistantRole}</p>
                        </div>
                      </div>

                      <div className="mt-5 grid gap-3 md:grid-cols-3">
                        <div className="rounded-2xl border border-border/80 bg-secondary/30 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            Opening moves
                          </p>
                          <ul className="mt-3 space-y-2 text-sm text-foreground">
                            {template.interactionPattern.openingMoves.map((move) => (
                              <li key={move}>• {move}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="rounded-2xl border border-border/80 bg-secondary/30 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            Sustain moves
                          </p>
                          <ul className="mt-3 space-y-2 text-sm text-foreground">
                            {template.interactionPattern.sustainMoves.map((move) => (
                              <li key={move}>• {move}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="rounded-2xl border border-border/80 bg-secondary/30 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            Closing moves
                          </p>
                          <ul className="mt-3 space-y-2 text-sm text-foreground">
                            {template.interactionPattern.closingMoves.map((move) => (
                              <li key={move}>• {move}</li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      <div className="mt-4 rounded-2xl border border-border/80 bg-accent/10 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Completion rule
                        </p>
                        <p className="mt-2 text-sm text-foreground">
                          {template.interactionPattern.completionRule}
                        </p>
                      </div>

                      {template.promptCues.length > 0 ? (
                        <div className="mt-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            Prompt cues
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {template.promptCues.map((cue) => (
                              <Badge key={cue} variant="accent" size="sm">
                                {cue}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            )}
          </Card>

          <Card className="border-3 border-foreground p-6 shadow-stamp">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-foreground bg-success text-success-foreground">
                <GraduationCap size={22} strokeWidth={2.5} />
              </div>
              <div>
                <h2 className="text-xl font-display font-bold text-foreground">2. Assignment authoring</h2>
                <p className="text-sm text-muted-foreground">
                  Publish the assignment record that students will see on their learning dashboard.
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <div className="space-y-2">
                <label htmlFor="assignment-mapping" className="text-base font-semibold text-foreground">
                  Mapping
                </label>
                <select
                  id="assignment-mapping"
                  value={assignmentForm.mappingId}
                  onChange={(event) => handleAssignmentField('mappingId', event.target.value)}
                  className="h-12 w-full rounded-xl border-3 border-border bg-card px-4 text-base text-foreground focus:border-primary focus:outline-none"
                >
                  <option value="">Select a mapping</option>
                  {mappings.map((mapping) => (
                    <option key={mapping.id} value={mapping.id}>
                      {mapping.id} · {mapping.moduleId} · {(mapping.targetExpressions[0] || 'No target expression')}
                    </option>
                  ))}
                </select>
              </div>

              <Input
                label="Assignment title"
                value={assignmentForm.title}
                onChange={(event) => handleAssignmentField('title', event.target.value)}
                placeholder="Past tense weekend recap"
              />

              <Textarea
                label="Description"
                value={assignmentForm.description}
                onChange={(event) => handleAssignmentField('description', event.target.value)}
                placeholder="Ask the AI what happened last weekend and respond with a complete narrative."
              />

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="assignment-status" className="text-base font-semibold text-foreground">
                    Status
                  </label>
                  <select
                    id="assignment-status"
                    value={assignmentForm.status}
                    onChange={(event) => handleAssignmentField('status', event.target.value as AssignmentFormState['status'])}
                    className="h-12 w-full rounded-xl border-3 border-border bg-card px-4 text-base text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label htmlFor="assignment-task-type" className="text-base font-semibold text-foreground">
                    Task type
                  </label>
                  <select
                    id="assignment-task-type"
                    value={assignmentForm.taskType}
                    onChange={(event) => handleAssignmentField('taskType', event.target.value as AssignmentTaskType)}
                    className="h-12 w-full rounded-xl border-3 border-border bg-card px-4 text-base text-foreground focus:border-primary focus:outline-none"
                  >
                    {TASK_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <Input
                  label="Release at"
                  type="datetime-local"
                  value={assignmentForm.releaseAt}
                  onChange={(event) => handleAssignmentField('releaseAt', event.target.value)}
                />
                <Input
                  label="Due at"
                  type="datetime-local"
                  value={assignmentForm.dueAt}
                  onChange={(event) => handleAssignmentField('dueAt', event.target.value)}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Input
                  label="Max attempts"
                  type="number"
                  min={1}
                  value={assignmentForm.maxAttempts}
                  onChange={(event) => handleAssignmentField('maxAttempts', event.target.value)}
                  placeholder="Optional"
                />
                <div className="space-y-2">
                  <label htmlFor="assignment-override-mode" className="text-base font-semibold text-foreground">
                    Modality override
                  </label>
                  <select
                    id="assignment-override-mode"
                    value={assignmentForm.overrideMode}
                    onChange={(event) =>
                      handleAssignmentField(
                        'overrideMode',
                        event.target.value as AssignmentFormState['overrideMode']
                      )
                    }
                    className="h-12 w-full rounded-xl border-3 border-border bg-card px-4 text-base text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="inherit">Inherit mapping policy</option>
                    {MODALITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {assignmentForm.overrideMode !== 'inherit' ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <Input
                    label="Override voice minutes cap"
                    type="number"
                    min={0}
                    value={assignmentForm.overrideVoiceMinutesCap}
                    onChange={(event) => handleAssignmentField('overrideVoiceMinutesCap', event.target.value)}
                    placeholder="Optional"
                  />
                  <label className="flex items-center gap-3 rounded-2xl border-2 border-border bg-secondary/40 px-4 py-3 text-sm font-medium text-foreground">
                    <input
                      type="checkbox"
                      checked={assignmentForm.overrideTextFallbackEnabled}
                      onChange={(event) =>
                        handleAssignmentField('overrideTextFallbackEnabled', event.target.checked)
                      }
                    />
                    Allow text fallback for this assignment
                  </label>
                </div>
              ) : null}

              <Textarea
                label="Success criteria"
                value={assignmentForm.successCriteriaText}
                onChange={(event) => handleAssignmentField('successCriteriaText', event.target.value)}
                placeholder={'Use the target expression twice\nAsk one follow-up question'}
              />

              <div className="flex justify-end">
                <Button onClick={handleCreateAssignment} loading={savingAssignment}>
                  Create assignment
                </Button>
              </div>
            </div>
          </Card>

          <Card className="border-3 border-foreground p-6 shadow-stamp">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-foreground bg-accent text-accent-foreground">
                <ClipboardList size={22} strokeWidth={2.5} />
              </div>
              <div>
                <h2 className="text-xl font-display font-bold text-foreground">Existing mappings</h2>
                <p className="text-sm text-muted-foreground">
                  Reuse a mapping when the pedagogy policy should stay the same across multiple assignments.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {mappings.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
                  No mappings yet.
                </div>
              ) : (
                mappings.map((mapping) => (
                  <div key={mapping.id} className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" size="sm">{mapping.id}</Badge>
                      <Badge variant="secondary" size="sm">{mapping.moduleId}</Badge>
                      <Badge variant="accent" size="sm">{mapping.feedbackPolicy.mode}</Badge>
                      {mapping.outputPolicy ? (
                        <Badge variant="secondary" size="sm">
                          {mapping.outputPolicy.followUpPressure} output
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-3 text-sm font-semibold text-foreground">
                      {(mapping.targetExpressions[0] || 'No target expressions yet')}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Situation: {mapping.situationIds.join(', ') || 'n/a'} · Objectives: {mapping.objectiveIds.join(', ') || 'n/a'}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Output pressure: {describeOutputPressure(mapping)}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Interaction contract: {describeInteractionContract(curriculum, mapping.objectiveIds, lang)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card className="border-3 border-foreground p-6 shadow-stamp">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-foreground bg-primary text-primary-foreground">
                <GraduationCap size={22} strokeWidth={2.5} />
              </div>
              <div>
                <h2 className="text-xl font-display font-bold text-foreground">Assignments</h2>
                <p className="text-sm text-muted-foreground">
                  Published assignments become available on the student learning dashboard.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {assignments.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
                  No assignments created yet.
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
                          <Badge variant="secondary" size="sm">
                            {assignment.taskType.replace('_', ' ')}
                          </Badge>
                        </div>
                        <h3 className="mt-3 text-lg font-display font-bold text-foreground">{assignment.title}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {assignment.description || 'No description yet.'}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/app/teacher/classes/${classId}/assignments/${assignment.id}/analytics`)}
                        >
                          <Sparkles size={16} className="mr-2" />
                          View analytics
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/app/assignments/${assignment.id}`)}
                        >
                          <Eye size={16} className="mr-2" />
                          Preview launch
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
