import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Loader2,
  MessageSquareText,
  Mic,
  PlayCircle,
} from 'lucide-react';
import { bootstrapStudentAssignment } from '@/api/assignments';
import { AssignmentPracticeWorkspace } from '@/components/assignments/AssignmentPracticeWorkspace';
import { Alert, AlertDescription, Badge, Button, Card } from '@/components/ui';
import { useLanguage } from '@/contexts/LanguageContext';
import type { AssignmentBootstrapData } from '@/types';

function getLocalizedText(
  value: Record<string, string> | undefined,
  lang: 'en' | 'ko',
  fallback = ''
): string {
  if (!value) return fallback;
  return value[lang] || value.en || Object.values(value)[0] || fallback;
}

function formatModeLabel(value: string) {
  return value.replaceAll('_', ' ');
}

function formatBadgeVariant(status: string): 'success' | 'secondary' | 'outline' {
  if (status === 'published') return 'success';
  if (status === 'archived') return 'secondary';
  return 'outline';
}

export function AssignmentLaunchPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();
  const { lang } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [bootstrap, setBootstrap] = useState<AssignmentBootstrapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);

  useEffect(() => {
    let isActive = true;

    if (!assignmentId) {
      setLoading(false);
      setError('Assignment id is required.');
      return;
    }

    const loadBootstrap = async () => {
      setLoading(true);
      try {
        const nextBootstrap = await bootstrapStudentAssignment(assignmentId, lang);
        if (!isActive) return;
        setBootstrap(nextBootstrap);
        setError(null);
      } catch (loadError) {
        if (!isActive) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load assignment.');
      } finally {
        if (isActive) setLoading(false);
      }
    };

    void loadBootstrap();
    return () => {
      isActive = false;
    };
  }, [assignmentId, lang]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!bootstrap) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{error || 'Assignment launch data is unavailable.'}</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => navigate('/app/learn')}>
          Back to learning dashboard
        </Button>
      </div>
    );
  }

  const isTextLaunch = bootstrap.launch.modality.mode === 'text_only';
  const canStartPractice = bootstrap.launch.voiceAllowed || bootstrap.launch.textAllowed;
  const launchBlockedReasons = bootstrap.launch.blockedReasons ?? [];
  const showTextFallbackNotice = bootstrap.launch.modality.mode === 'text_only';

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="rounded-3xl border-3 border-foreground bg-card p-6 shadow-stamp">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge variant={formatBadgeVariant(bootstrap.assignment.status)} size="sm">
                {bootstrap.assignment.status}
              </Badge>
              {bootstrap.teacherPreview ? (
                <Badge variant="accent" size="sm">
                  Teacher preview
                </Badge>
              ) : null}
            </div>
            <h1 className="text-3xl font-display font-bold text-foreground">{bootstrap.assignment.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {bootstrap.class.name} · {bootstrap.class.subject || 'Language practice'} ·{' '}
              {bootstrap.class.term || 'Current term'}
            </p>
            {bootstrap.assignment.description ? (
              <p className="mt-3 max-w-3xl text-sm text-foreground/80">{bootstrap.assignment.description}</p>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-2xl border-2 border-border bg-secondary/50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Modality</p>
              <p className="mt-1 text-lg font-bold text-foreground">
                {formatModeLabel(bootstrap.launch.modality.mode)}
              </p>
            </div>
            <div className="rounded-2xl border-2 border-border bg-secondary/50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Attempts</p>
              <p className="mt-1 text-lg font-bold text-foreground">
                {bootstrap.launch.maxAttempts ?? 'Unlimited'}
              </p>
            </div>
            <div className="rounded-2xl border-2 border-border bg-secondary/50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Locale</p>
              <p className="mt-1 text-lg font-bold text-foreground">{bootstrap.class.learningLocale}</p>
            </div>
          </div>
        </div>
      </header>

      {bootstrap.teacherPreview ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>
            This launch is running in teacher preview mode. Students will only see it when they are actively enrolled
            and the assignment is published.
          </AlertDescription>
        </Alert>
      ) : null}

      {bootstrap.limitations.map((message) => (
        <Alert key={message}>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ))}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {showTextFallbackNotice ? (
        <Alert>
          <MessageSquareText className="h-4 w-4" />
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {bootstrap.launch.fallbackApplied
                ? 'Voice is blocked for this student, so this assignment has been downgraded to assignment-scoped text practice.'
                : 'This assignment is configured to launch in assignment-scoped text mode.'}
            </span>
            {bootstrap.launch.fallbackApplied ? (
              <Button size="sm" variant="outline" onClick={() => navigate('/app/consent/voice')}>
                Grant voice consent
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {launchBlockedReasons.length > 0 && !canStartPractice ? (
        <Alert variant="destructive">
          <AlertDescription>{launchBlockedReasons.join(' ')}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <details open className="group">
            <summary className="cursor-pointer list-none">
              <Card className="border-3 border-foreground p-5 shadow-stamp transition-colors group-open:border-primary/40">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-foreground bg-primary text-primary-foreground">
                      <BookOpen size={22} strokeWidth={2.5} />
                    </div>
                    <div>
                      <h2 className="text-lg font-display font-bold text-foreground">About this assignment</h2>
                      <p className="text-sm text-muted-foreground">
                        Curriculum scope, objectives, and teacher instructions
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground group-open:hidden">Show details</span>
                  <span className="hidden text-xs font-medium text-muted-foreground group-open:inline">Hide details</span>
                </div>
              </Card>
            </summary>

            <Card className="mt-3 border-3 border-foreground p-6 shadow-stamp">
              <h2 className="text-lg font-display font-bold text-foreground">
                {bootstrap.curriculum.package?.id === 'canvas-generated' ? 'Practice scope' : 'Curriculum scope'}
              </h2>

              {bootstrap.curriculum.unit && bootstrap.curriculum.module ? (
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Unit</p>
                    <p className="mt-2 font-semibold text-foreground">
                      {getLocalizedText(bootstrap.curriculum.unit.title, lang, bootstrap.curriculum.unit.id)}
                    </p>
                  </div>
                  <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Module</p>
                    <p className="mt-2 font-semibold text-foreground">
                      {getLocalizedText(bootstrap.curriculum.module.title, lang, bootstrap.curriculum.module.id)}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {getLocalizedText(bootstrap.curriculum.module.goal, lang)}
                    </p>
                  </div>
                </div>
              ) : bootstrap.mapping?.generatedScenario ? (
                <div className="mt-6 rounded-2xl border-2 border-border bg-secondary/40 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Conversation scenario</p>
                  <p className="mt-2 text-sm text-foreground">{bootstrap.mapping.generatedScenario}</p>
                  {bootstrap.mapping.sourceCanvasItemTitle ? (
                    <p className="mt-2 text-xs text-muted-foreground">Based on: {bootstrap.mapping.sourceCanvasItemTitle}</p>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-5 rounded-2xl border-2 border-border bg-secondary/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Situation</p>
                <p className="mt-2 font-semibold text-foreground">{bootstrap.curriculum.situation?.id || 'Canvas-generated'}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatModeLabel(bootstrap.curriculum.situation?.kind)} · {String(bootstrap.curriculum.situation?.seed?.setting || 'context not specified')}
                </p>
              </div>

              <div className="mt-5">
                <h3 className="text-base font-semibold text-foreground">Objectives</h3>
                <div className="mt-3 grid gap-3">
                  {bootstrap.curriculum.objectives.map((objective) => (
                    <div key={objective.id} className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                      <p className="text-sm font-semibold text-foreground">{objective.id}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {getLocalizedText(objective.canDo, lang, objective.id)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            <Card className="border-3 border-foreground p-6 shadow-stamp">
              <h2 className="text-xl font-display font-bold text-foreground">Teacher-designed practice overlay</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Target expressions</p>
                  <ul className="mt-3 space-y-2 text-sm text-foreground">
                    {(bootstrap.mapping.targetExpressions.length > 0
                      ? bootstrap.mapping.targetExpressions
                      : ['No explicit target expressions configured.']
                    ).map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Target vocabulary</p>
                  <ul className="mt-3 space-y-2 text-sm text-foreground">
                    {((bootstrap.mapping.targetVocabulary ?? []).length > 0
                      ? bootstrap.mapping.targetVocabulary ?? []
                      : ['No explicit target vocabulary configured.']
                    ).map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Focus grammar</p>
                  <ul className="mt-3 space-y-2 text-sm text-foreground">
                    {(bootstrap.mapping.focusGrammar.length > 0
                      ? bootstrap.mapping.focusGrammar
                      : ['No explicit grammar focus configured.']
                    ).map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Success criteria</p>
                  <ul className="mt-3 space-y-2 text-sm text-foreground">
                    {(bootstrap.assignment.successCriteria.length > 0
                      ? bootstrap.assignment.successCriteria
                      : ['Complete the task with sustained, assignment-aligned output.']
                    ).map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Teacher notes</p>
                  <p className="mt-3 text-sm text-foreground">
                    {bootstrap.mapping.teacherNotes || 'No teacher notes were attached to this assignment.'}
                  </p>
                </div>
              </div>
            </Card>
          </details>
        </div>

        <div className="space-y-6">
          <Card className="border-3 border-foreground p-6 shadow-stamp">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-foreground bg-success text-success-foreground">
                <Mic size={22} strokeWidth={2.5} />
              </div>
              <div>
                <h2 className="text-xl font-display font-bold text-foreground">Open practice workspace</h2>
                <p className="text-sm text-muted-foreground">
                  Practice opens in a focused assignment workspace with assignment-only history and your teacher’s goals visible while you talk.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Voice</p>
                <p className="mt-2 font-semibold text-foreground">{bootstrap.launch.voiceAllowed ? 'Allowed' : 'Blocked'}</p>
              </div>
              <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Text fallback</p>
                <p className="mt-2 font-semibold text-foreground">{bootstrap.launch.textAllowed ? 'Available' : 'Blocked'}</p>
              </div>
            </div>

            {bootstrap.launch.retentionPolicy ? (
              <div className="mt-4 rounded-2xl border-2 border-border bg-secondary/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Retention</p>
                <p className="mt-2 text-sm text-foreground">
                  {bootstrap.launch.retentionPolicy.label} · Raw audio{' '}
                  {bootstrap.launch.retentionPolicy.rawAudioStorageAllowed ? 'stored' : 'not stored'}
                </p>
              </div>
            ) : null}

            <div className="mt-4 rounded-2xl border-2 border-border bg-secondary/40 p-4">
              <p className="text-sm font-semibold text-foreground">How it works</p>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>• Opens an assignment-only chat workspace</li>
                <li>• Keeps your assignment goals visible while you practice</li>
                <li>• Saves separate attempts and lets you resume older threads</li>
              </ul>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => setIsWorkspaceOpen(true)} disabled={!canStartPractice}>
                <PlayCircle size={16} className="mr-2" />
                {isTextLaunch ? 'Start text practice' : 'Start assignment practice'}
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <AssignmentPracticeWorkspace
        open={isWorkspaceOpen}
        bootstrap={bootstrap}
        onClose={() => setIsWorkspaceOpen(false)}
      />
    </div>
  );
}
