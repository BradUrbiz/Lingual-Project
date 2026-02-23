import {
  BarChart as BarChartIcon,
  Users,
  Clock,
  Calendar,
  Download,
  Filter,
  Plus,
  MoreHorizontal,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';

const PROGRESS_DATA = [
  { day: 'Mon', minutes: 120, students: 45 },
  { day: 'Tue', minutes: 180, students: 52 },
  { day: 'Wed', minutes: 150, students: 48 },
  { day: 'Thu', minutes: 240, students: 60 },
  { day: 'Fri', minutes: 200, students: 55 },
  { day: 'Sat', minutes: 90, students: 25 },
  { day: 'Sun', minutes: 60, students: 15 },
];

const SKILL_DATA = [
  { name: 'Pronunciation', score: 85 },
  { name: 'Vocabulary', score: 72 },
  { name: 'Grammar', score: 68 },
  { name: 'Fluency', score: 78 },
  { name: 'Confidence', score: 90 },
];

const STUDENTS = [
  { id: 1, name: 'Alice Freeman', grade: 'A', time: '4h 20m', status: 'Active' },
  { id: 2, name: 'Bob Smith', grade: 'B+', time: '3h 15m', status: 'Active' },
  { id: 3, name: 'Charlie Davis', grade: 'A-', time: '3h 50m', status: 'Active' },
  { id: 4, name: 'Diana Evans', grade: 'C', time: '1h 10m', status: 'At Risk' },
  { id: 5, name: 'Ethan Hunt', grade: 'B', time: '2h 45m', status: 'Inactive' },
];

export function TeacherDashboardPage() {
  const { t } = useLanguage();
  const localizedSkillData = SKILL_DATA.map((skill) => ({
    ...skill,
    name: t(`app.teacher.skills.${skill.name.toLowerCase()}`),
  }));
  const statusLabels: Record<string, string> = {
    Active: t('app.teacher.status.active'),
    'At Risk': t('app.teacher.status.atRisk'),
    Inactive: t('app.teacher.status.inactive'),
  };
  const statusClassNames: Record<string, string> = {
    Active: 'border border-success/40 bg-success/15 text-success',
    'At Risk': 'border border-destructive/40 bg-destructive/10 text-destructive',
    Inactive: 'border border-border bg-secondary text-muted-foreground',
  };

  const stats = [
    {
      label: t('app.teacher.stats.fluency'),
      value: '82%',
      change: '+4%',
      icon: BarChartIcon,
      color: 'bg-primary/15 border-primary/30 text-primary',
    },
    {
      label: t('app.teacher.stats.activeStudents'),
      value: '24/28',
      change: '-1',
      icon: Users,
      color: 'bg-accent/20 border-accent/35 text-accent-foreground',
    },
    {
      label: t('app.teacher.stats.speakingTime'),
      value: '142h',
      change: '+12h',
      icon: Clock,
      color: 'bg-success/20 border-success/35 text-success',
    },
    {
      label: t('app.teacher.stats.assignments'),
      value: '3',
      change: 'Next: Fri',
      icon: Calendar,
      color: 'bg-secondary border-border text-foreground',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">
            {t('app.teacher.classTitle')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('app.teacher.classOverview')}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" size="sm" className="h-11 min-h-11 gap-2">
            <Download size={16} strokeWidth={2.5} />
            {t('app.teacher.actions.export')}
          </Button>
          <Button size="sm" className="h-11 min-h-11 gap-2">
            <Plus size={16} strokeWidth={2.5} />
            {t('app.teacher.actions.assignment')}
          </Button>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <article
            key={stat.label}
            className="rounded-2xl border-3 border-foreground bg-card p-5 shadow-stamp"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-xl border-2 ${stat.color}`}
              >
                <stat.icon size={22} strokeWidth={2.5} />
              </div>
              <span
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${
                  stat.change.startsWith('+')
                    ? 'border-success/35 bg-success/15 text-success'
                    : stat.change.startsWith('-')
                    ? 'border-destructive/35 bg-destructive/10 text-destructive'
                    : 'border-border bg-secondary text-muted-foreground'
                }`}
              >
                {stat.change}
              </span>
            </div>
            <p className="text-3xl font-display font-bold text-foreground">{stat.value}</p>
            <p className="mt-1 text-sm font-medium text-muted-foreground">{stat.label}</p>
          </article>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2 rounded-2xl border-3 border-foreground bg-card p-6 shadow-stamp">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-xl font-display font-bold text-foreground">
              {t('app.teacher.activity')}
            </h3>
            <label htmlFor="teacher-activity-range" className="sr-only">
              {t('app.teacher.range.label') || 'Activity range'}
            </label>
            <select
              id="teacher-activity-range"
              className="h-11 rounded-xl border-2 border-border bg-secondary px-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none"
            >
              <option>{t('app.teacher.range.week')}</option>
              <option>{t('app.teacher.range.month')}</option>
            </select>
          </div>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={PROGRESS_DATA}>
                <defs>
                  <linearGradient id="colorMinutes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="4 4"
                  vertical={false}
                  stroke="var(--color-border)"
                />
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{
                    fill: 'var(--color-muted-foreground)',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                  dy={10}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{
                    fill: 'var(--color-muted-foreground)',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: '12px',
                    border: '2px solid var(--color-border)',
                    background: 'var(--color-card)',
                    boxShadow: '4px 4px 0 0 var(--color-foreground)',
                  }}
                  labelStyle={{
                    color: 'var(--color-muted-foreground)',
                    fontWeight: 600,
                  }}
                  itemStyle={{
                    color: 'var(--color-foreground)',
                    fontWeight: 700,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="minutes"
                  stroke="var(--color-primary)"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorMinutes)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-2xl border-3 border-foreground bg-card p-6 shadow-stamp">
          <h3 className="mb-6 text-xl font-display font-bold text-foreground">
            {t('app.teacher.skills.title')}
          </h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={localizedSkillData} layout="vertical" barSize={20}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={100}
                  axisLine={false}
                  tickLine={false}
                  tick={{
                    fill: 'var(--color-muted-foreground)',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                />
                <Tooltip
                  cursor={{ fill: 'transparent' }}
                  contentStyle={{
                    borderRadius: '12px',
                    border: '2px solid var(--color-border)',
                    background: 'var(--color-card)',
                    boxShadow: '4px 4px 0 0 var(--color-foreground)',
                  }}
                />
                <Bar
                  dataKey="score"
                  fill="var(--color-chart-4)"
                  radius={[0, 4, 4, 0]}
                  background={{ fill: 'var(--color-secondary)', radius: 4 }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border-3 border-foreground bg-card shadow-stamp">
        <div className="flex flex-col gap-4 border-b-2 border-border p-6 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-xl font-display font-bold text-foreground">
            {t('app.teacher.students.title')}
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-border bg-secondary text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
              aria-label={t('app.teacher.students.actions') || 'Filter students'}
            >
              <Filter size={16} strokeWidth={2.5} />
            </button>
            <input
              type="text"
              placeholder={t('app.teacher.students.search')}
              className="h-11 w-64 rounded-xl border-2 border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-secondary text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-6 py-4">{t('app.teacher.students.name')}</th>
                <th className="px-6 py-4">{t('app.teacher.students.status')}</th>
                <th className="px-6 py-4">{t('app.teacher.students.grade')}</th>
                <th className="px-6 py-4">{t('app.teacher.students.practice')}</th>
                <th className="px-6 py-4 text-right">{t('app.teacher.students.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {STUDENTS.map((student) => (
                <tr
                  key={student.id}
                  className="transition-colors hover:bg-secondary/50"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      <div className="mr-3 flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-secondary text-xs font-bold text-foreground">
                        {student.name
                          .split(' ')
                          .map((n) => n[0])
                          .join('')}
                      </div>
                      <span className="font-semibold text-foreground">{student.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${
                        statusClassNames[student.status] || statusClassNames.Inactive
                      }`}
                    >
                      {statusLabels[student.status] || student.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-semibold text-foreground">{student.grade}</td>
                  <td className="px-6 py-4 text-muted-foreground">{student.time}</td>
                  <td className="px-6 py-4 text-right">
                    <button
                      type="button"
                      aria-label={`${t('app.teacher.students.actions') || 'Student actions'}: ${student.name}`}
                      className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t-2 border-border p-4 text-center">
          <button
            type="button"
            className="text-sm font-semibold text-primary transition-colors hover:text-primary/80"
          >
            {t('app.teacher.students.viewAll')}
          </button>
        </div>
      </section>
    </div>
  );
}
