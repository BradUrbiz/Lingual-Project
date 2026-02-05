import { MessageSquare, Gamepad2, Mic, TrendingUp } from 'lucide-react';
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

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Welcome Header */}
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">
          {t('app.dashboard.title') || 'Learning Dashboard'}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('app.dashboard.subtitle') || 'Your learning hub — pick up where you left off'}
        </p>
      </div>

      {/* Stats Bar */}
      <DashboardStatsBar stats={MOCK_STATS} t={t} />

      {/* Service Navigation Cards */}
      <div>
        <h2 className="text-lg font-display font-bold text-foreground mb-4">
          {t('app.dashboard.services') || 'Continue Learning'}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          <ServiceNavigationCard
            title={t('app.dashboard.card.chat.title') || 'AI Chat'}
            description={t('app.dashboard.card.chat.description') || 'Practice conversation with your AI tutor'}
            icon={<MessageSquare size={24} strokeWidth={2.5} />}
            href="/app/chat"
            color="primary"
          />
          <ServiceNavigationCard
            title={t('app.dashboard.card.games.title') || 'Practice Games'}
            description={t('app.dashboard.card.games.description') || 'Flashcards, word matching, and more'}
            icon={<Gamepad2 size={24} strokeWidth={2.5} />}
            href="/app/games"
            color="accent"
          />
          <ServiceNavigationCard
            title={t('app.dashboard.card.pronunciation.title') || 'Pronunciation'}
            description={t('app.dashboard.card.pronunciation.description') || 'Practice speaking and get feedback'}
            icon={<Mic size={24} strokeWidth={2.5} />}
            href="/app/practice"
            color="success"
          />
          <ServiceNavigationCard
            title={t('app.dashboard.card.progress.title') || 'Progress'}
            description={t('app.dashboard.card.progress.description') || 'Track your skills and learning path'}
            icon={<TrendingUp size={24} strokeWidth={2.5} />}
            href="/app/progress"
            color="secondary"
          />
        </div>
      </div>
    </div>
  );
}
