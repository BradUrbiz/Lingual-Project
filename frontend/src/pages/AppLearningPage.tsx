import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, MessageSquare, Gamepad2, Mic, TrendingUp, GraduationCap, Loader2 } from 'lucide-react';
import { getStudentAssignments } from '@/api/assignments';
import { Alert, AlertDescription, Badge, Button } from '@/components/ui';
import { DashboardStatsBar, ServiceNavigationCard } from '@/components/dashboard';
import { useLanguage } from '@/contexts/LanguageContext';
import type { StudentAssignmentSummary } from '@/types';

// Mock stats — will be replaced with real backend data later
const MOCK_STATS = {
  streak: 7,
  weeklyMinutes: 204,
  weeklyXP: 250,
  achievementCount: 3,
};

export function AppLearningPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const surfaceClass = 'rounded-2xl border-3 border-foreground bg-card shadow-stamp';
  const [assignments, setAssignments] = useState<StudentAssignmentSummary[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(true);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    const loadAssignments = async () => {
      try {
        const nextAssignments = await getStudentAssignments();
        if (!isActive) return;
        setAssignments(nextAssignments);
        setAssignmentError(null);
      } catch (error) {
        if (!isActive) return;
        setAssignmentError(error instanceof Error ? error.message : 'Failed to load assignments.');
      } finally {
        if (isActive) setAssignmentsLoading(false);
      }
    };

    void loadAssignments();
    return () => {
      isActive = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border-3 border-foreground bg-primary text-primary-foreground shadow-stamp-sm">
          <BookOpen size={24} strokeWidth={2.5} />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
            {t('app.layout.nav.learning') || 'Learning'}
          </p>
          <h1 className="text-3xl font-display font-bold text-foreground">
            {t('app.dashboard.title') || 'Learning Dashboard'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('app.dashboard.subtitle') || 'Your learning hub — pick up where you left off'}
          </p>
        </div>
      </header>

      <section className={`${surfaceClass} p-5`}>
        <h2 className="mb-4 text-lg font-display font-bold text-foreground">
          {t('app.dashboard.snapshot') || 'Weekly Snapshot'}
        </h2>
        <DashboardStatsBar stats={MOCK_STATS} t={t} />
      </section>

      <section className={`${surfaceClass} p-6`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-display font-bold text-foreground">Assigned practice</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Published school assignments appear here with their assignment-aware launch page.
            </p>
          </div>
          <Badge variant="secondary" size="sm">
            {assignments.length} active
          </Badge>
        </div>

        {assignmentError ? (
          <Alert className="mt-5">
            <AlertDescription>{assignmentError}</AlertDescription>
          </Alert>
        ) : null}

        {assignmentsLoading ? (
          <div className="mt-6 flex items-center gap-3 rounded-2xl border-2 border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading assignments...
          </div>
        ) : assignments.length === 0 ? (
          <div className="mt-6 rounded-3xl border-3 border-dashed border-border bg-secondary/40 p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-foreground bg-card">
              <GraduationCap size={24} strokeWidth={2.5} />
            </div>
            <h3 className="mt-4 text-xl font-display font-bold text-foreground">No school assignments yet</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              When a teacher publishes an assignment for your class, it will show up here.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {assignments.map((assignment) => (
              <div key={assignment.id} className="rounded-2xl border-2 border-border bg-secondary/40 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={assignment.status === 'published' ? 'success' : 'outline'} size="sm">
                    {assignment.status}
                  </Badge>
                  <Badge variant="secondary" size="sm">
                    {assignment.taskType.replace('_', ' ')}
                  </Badge>
                </div>
                <h3 className="mt-4 text-xl font-display font-bold text-foreground">{assignment.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {assignment.className || 'Your class'} {assignment.dueAt ? `· Due ${assignment.dueAt}` : ''}
                </p>
                <p className="mt-3 text-sm text-foreground/80">
                  {assignment.description || 'Assignment details will be shown on the launch page.'}
                </p>
                <Button className="mt-5" onClick={() => navigate(`/app/assignments/${assignment.id}`)}>
                  Launch assignment
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={`${surfaceClass} p-6`}>
        <div className="mb-5">
          <h2 className="text-lg font-display font-bold text-foreground">
            {t('app.dashboard.services') || 'Continue Learning'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('app.dashboard.nextStep') || 'Pick your next practice route.'}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
          <ServiceNavigationCard
            title={t('app.dashboard.card.chat.title') || 'AI Chat'}
            description={t('app.dashboard.card.chat.description') || 'Practice conversation with your AI tutor'}
            icon={<MessageSquare size={22} strokeWidth={2.5} />}
            href="/app/chat"
            color="primary"
          />
          <ServiceNavigationCard
            title={t('app.dashboard.card.curriculum.title') || 'Curriculum'}
            description={t('app.dashboard.card.curriculum.description') || 'Sample AP French units and guided voice practice'}
            icon={<BookOpen size={22} strokeWidth={2.5} />}
            href="/app/curriculum"
            color="success"
          />
          <ServiceNavigationCard
            title={t('app.dashboard.card.games.title') || 'Practice Games'}
            description={t('app.dashboard.card.games.description') || 'Flashcards, word matching, and more'}
            icon={<Gamepad2 size={22} strokeWidth={2.5} />}
            href="/app/games"
            color="accent"
          />
          <ServiceNavigationCard
            title={t('app.dashboard.card.pronunciation.title') || 'Pronunciation'}
            description={t('app.dashboard.card.pronunciation.description') || 'Practice speaking and get feedback'}
            icon={<Mic size={22} strokeWidth={2.5} />}
            href="/app/practice"
            color="success"
          />
          <ServiceNavigationCard
            title={t('app.dashboard.card.progress.title') || 'Progress'}
            description={t('app.dashboard.card.progress.description') || 'Track your skills and learning path'}
            icon={<TrendingUp size={22} strokeWidth={2.5} />}
            href="/app/progress"
            color="primary"
          />
        </div>
      </section>
    </div>
  );
}
