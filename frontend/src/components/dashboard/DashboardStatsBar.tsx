import { Flame, Clock, Star, Trophy } from 'lucide-react';

interface DashboardStatsBarProps {
  stats: {
    streak: number;
    weeklyMinutes: number;
    weeklyXP: number;
    achievementCount: number;
  };
  t: (key: string) => string;
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  return `${hours}h ${mins}m`;
}

export function DashboardStatsBar({ stats, t }: DashboardStatsBarProps) {
  const items = [
    {
      icon: <Flame size={20} strokeWidth={2.5} />,
      value: `${stats.streak}`,
      label: t('app.dashboard.stats.streak'),
      color: 'bg-destructive/10 text-destructive border-destructive/20',
      iconBg: 'bg-destructive text-white',
    },
    {
      icon: <Clock size={20} strokeWidth={2.5} />,
      value: formatMinutes(stats.weeklyMinutes),
      label: t('app.dashboard.stats.weeklyTime'),
      color: 'bg-primary/10 text-primary border-primary/20',
      iconBg: 'bg-primary text-primary-foreground',
    },
    {
      icon: <Star size={20} strokeWidth={2.5} />,
      value: `+${stats.weeklyXP}`,
      label: t('app.dashboard.stats.weeklyXP'),
      color: 'bg-accent/10 text-accent border-accent/20',
      iconBg: 'bg-accent text-accent-foreground',
    },
    {
      icon: <Trophy size={20} strokeWidth={2.5} />,
      value: `${stats.achievementCount}`,
      label: t('app.dashboard.stats.achievements'),
      color: 'bg-success/10 text-success border-success/20',
      iconBg: 'bg-success text-white',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {items.map((item) => (
        <div
          key={item.label}
          className={`flex items-center gap-4 p-4 rounded-2xl border-2 ${item.color}`}
        >
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center border-2 border-foreground ${item.iconBg}`}>
            {item.icon}
          </div>
          <div>
            <p className="text-lg font-display font-bold">{item.value}</p>
            <p className="text-xs font-semibold opacity-70">{item.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
