import type { ReactNode } from 'react';
import type { AssignmentBootstrapData, Language } from '@/types';

interface AssignmentContextPanelProps {
  bootstrap: AssignmentBootstrapData;
  lang: Language;
}

function getLocalizedText(value: Record<string, string> | undefined, lang: Language, fallback = ''): string {
  if (!value) return fallback;
  return value[lang] || value.en || Object.values(value)[0] || fallback;
}

function formatModeLabel(mode?: string | null) {
  if (!mode) return 'Mode not specified';
  return mode
    .split('_')
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

function formatSeedValue(value: unknown, fallback = 'context not specified') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function getListWithFallback(primary: string[] | undefined, secondary: string[] | undefined, fallback: string) {
  if (primary && primary.length > 0) return primary;
  if (secondary && secondary.length > 0) return secondary;
  return [fallback];
}

interface ContextCardProps {
  title: string;
  children: ReactNode;
}

function ContextCard({ title, children }: ContextCardProps) {
  return (
    <section className="rounded-2xl border-2 border-border bg-secondary/30 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
      {children}
    </section>
  );
}

interface ContextListProps {
  title: string;
  items: string[];
}

function ContextList({ title, items }: ContextListProps) {
  return (
    <ContextCard title={title}>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-foreground">
        {items.map((item) => (
          <li key={`${title}-${item}`}>{item}</li>
        ))}
      </ul>
    </ContextCard>
  );
}

export function AssignmentContextPanel({ bootstrap, lang }: AssignmentContextPanelProps) {
  const unitTitle = bootstrap.curriculum.unit
    ? getLocalizedText(bootstrap.curriculum.unit.title, lang, bootstrap.curriculum.unit.id)
    : null;
  const moduleTitle = bootstrap.curriculum.module
    ? getLocalizedText(bootstrap.curriculum.module.title, lang, bootstrap.curriculum.module.id)
    : null;
  const moduleGoal = bootstrap.curriculum.module
    ? getLocalizedText(bootstrap.curriculum.module.goal, lang)
    : '';
  const scenario = bootstrap.mapping.generatedScenario || bootstrap.assignment.generatedScenario || bootstrap.assignment.instructions || '';
  const sourceCanvasTitle = bootstrap.mapping.sourceCanvasItemTitle;
  const situation = bootstrap.curriculum.situation;
  const situationSetting = formatSeedValue(situation?.seed?.setting);
  const objectives = bootstrap.curriculum.objectives.length > 0
    ? bootstrap.curriculum.objectives.map((objective) => getLocalizedText(objective.canDo, lang, objective.id))
    : getListWithFallback(bootstrap.assignment.objectives, undefined, 'Complete the assignment-aligned speaking objective.');
  const targetExpressions = getListWithFallback(
    bootstrap.mapping.targetExpressions,
    bootstrap.assignment.targetExpressions,
    'No explicit target expressions configured.',
  );
  const focusGrammar = getListWithFallback(
    bootstrap.mapping.focusGrammar,
    bootstrap.assignment.focusGrammar,
    'No explicit grammar focus configured.',
  );
  const successCriteria = getListWithFallback(
    bootstrap.assignment.successCriteria,
    undefined,
    'Complete the task with sustained, assignment-aligned output.',
  );
  const teacherNotes = bootstrap.mapping.teacherNotes || bootstrap.assignment.teacherNotes || 'No teacher notes were attached to this assignment.';

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {(unitTitle || moduleTitle) ? (
        <ContextCard title="Practice scope">
          {unitTitle ? (
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Unit</p>
          ) : null}
          {unitTitle ? (
            <p className="mt-1 text-sm font-semibold text-foreground">{unitTitle}</p>
          ) : null}
          {moduleTitle ? (
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Module</p>
          ) : null}
          {moduleTitle ? (
            <p className="mt-1 text-sm font-semibold text-foreground">{moduleTitle}</p>
          ) : null}
          {moduleGoal ? (
            <p className="mt-1 text-sm text-muted-foreground">{moduleGoal}</p>
          ) : null}
        </ContextCard>
      ) : null}

      <ContextCard title="Conversation scenario">
        <p className="mt-3 text-sm text-foreground">
          {scenario || bootstrap.assignment.description || 'No conversation scenario was attached to this assignment.'}
        </p>
        {sourceCanvasTitle ? (
          <p className="mt-2 text-xs text-muted-foreground">Based on: {sourceCanvasTitle}</p>
        ) : null}
      </ContextCard>

      <ContextCard title="Situation">
        <p className="mt-2 text-sm font-semibold text-foreground">{situation?.id || 'Canvas-generated'}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatModeLabel(situation?.kind)} - {situationSetting}
        </p>
      </ContextCard>

      <ContextList title="Objectives" items={objectives} />
      <ContextList title="Target expressions" items={targetExpressions} />
      <ContextList title="Focus grammar" items={focusGrammar} />
      <ContextList title="Success criteria" items={successCriteria} />

      <ContextCard title="Teacher notes">
        <p className="mt-3 text-sm text-foreground">{teacherNotes}</p>
      </ContextCard>
    </div>
  );
}
