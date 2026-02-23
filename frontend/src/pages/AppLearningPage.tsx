import { BookOpen, MessageSquare, Gamepad2, Mic, TrendingUp } from 'lucide-react';
import { DashboardStatsBar, ServiceNavigationCard } from '@/components/dashboard';
import { useLanguage } from '@/contexts/LanguageContext';

// Mock stats — will be replaced with real backend data later
const MOCK_STATS = {
  streak: 7,
  weeklyMinutes: 204,
  weeklyXP: 250,
  achievementCount: 3,
};

export function AppLearningPage() {
  const { t } = useLanguage();
  const surfaceClass = 'rounded-2xl border-3 border-foreground bg-card shadow-stamp';

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
