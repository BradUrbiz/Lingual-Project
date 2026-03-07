import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  Languages,
  BookOpen,
  MessageSquare,
  Gamepad2,
  TrendingUp,
  User,
  Settings,
  LogOut,
  Flame,
  Bell,
  Menu,
  X,
  LayoutDashboard,
  Mic,
} from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { motion } from 'motion/react';
import { Toaster } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useMembership } from '@/contexts/MembershipContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useLearningLocale } from '@/contexts/LearningLocaleContext';
import { LEARNING_LOCALES } from '@/lib/learningLocales';
import { getUserProfile } from '@/api/user';
import type { UserProfile } from '@/types';

const FALLBACK_AVATAR = '/imgs/landing/student.jpg';

export function AppLayout() {
  const navigate = useNavigate();
  const { user, logout, avatarUrl, updateAvatarUrl } = useAuth();
  const { hasAnyRole, activeMembership } = useMembership();
  const { t } = useLanguage();
  const { learningLocale } = useLearningLocale();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (!user) return;
    getUserProfile().then((p) => {
      setProfile(p);
      if (p.avatarUrl) updateAvatarUrl(p.avatarUrl);
    }).catch(() => {});
  }, [user, updateAvatarUrl]);

  const displayName = profile?.displayName || user?.name || 'Student';
  const userAvatar = avatarUrl || profile?.avatarUrl || FALLBACK_AVATAR;
  const canAccessTeacherView = hasAnyRole(['teacher', 'school_admin']);
  const roleLabel = canAccessTeacherView
    ? activeMembership?.orgName
      ? `${t('app.layout.nav.teacher')} · ${activeMembership.orgName}`
      : t('app.layout.nav.teacher')
    : profile?.gradeLevel
    ? `${t('app.layout.role.learner')} · ${profile.gradeLevel}`
    : t('app.layout.role.learner');
  const localeOption = LEARNING_LOCALES.find((locale) => locale.value === learningLocale);
  const mobilePrimaryNav = [
    { icon: BookOpen, label: t('app.layout.nav.learning'), path: '/app/learn' },
    { icon: MessageSquare, label: t('app.layout.nav.chat'), path: '/app/chat' },
    { icon: Mic, label: t('app.layout.nav.practice'), path: '/app/practice' },
    { icon: Gamepad2, label: t('app.layout.nav.games'), path: '/app/games' },
    { icon: TrendingUp, label: t('app.layout.nav.progress'), path: '/app/progress' },
  ];
  const mobileMenuNav = [
    { icon: User, label: t('nav.profile'), path: '/app/profile' },
    { icon: Settings, label: t('nav.settings'), path: '/app/settings' },
    ...(canAccessTeacherView
      ? [{ icon: LayoutDashboard, label: t('app.layout.nav.teacher'), path: '/app/teacher' }]
      : []),
  ];

  const handleLogout = async () => {
    await logout();
    navigate('/auth');
  };

  return (
    <div className="min-h-screen bg-background font-body text-foreground flex flex-col">
      <Toaster position="top-right" richColors />
      {/* Top Navigation */}
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b-3 border-foreground">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-6 h-20 flex items-center justify-between">
          {/* Left: Logo & Mobile Menu */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              className="md:hidden p-2 -ml-2 text-foreground hover:bg-secondary rounded-lg border-2 border-foreground transition-colors"
              onClick={() => setIsMobileMenuOpen((open) => !open)}
              aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={isMobileMenuOpen}
              aria-controls="mobile-nav-drawer"
            >
              {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <button
              type="button"
              className="flex items-center gap-3 cursor-pointer"
              onClick={() => navigate('/app/learn')}
              aria-label="Go to learning dashboard"
            >
              <div className="w-12 h-12 bg-primary border-3 border-foreground rounded-xl flex items-center justify-center text-primary-foreground shadow-stamp-sm">
                <Languages size={26} strokeWidth={2.5} />
              </div>
              <span className="text-2xl font-display font-bold tracking-tight hidden sm:block">
                Lingual
              </span>
            </button>

            {/* Learning Locale */}
            <div className="hidden md:flex items-center gap-2 bg-card rounded-full px-4 py-2 ml-6 border-2 border-border">
              <span className="text-lg">{localeOption?.flag || '🌐'}</span>
              <span className="text-sm font-semibold text-foreground">
                {localeOption?.shortLabel || t('app.layout.language.korean')}
              </span>
            </div>
          </div>

          {/* Right: Progress & User */}
          <div className="flex items-center gap-4">
            {/* Streak */}
            <div className="hidden sm:flex items-center space-x-1.5 text-accent-foreground bg-accent/20 px-4 py-2 rounded-full border-2 border-accent">
              <Flame size={18} fill="currentColor" />
              <span className="text-sm font-bold">12</span>
            </div>

            {/* Notifications */}
            <button
              type="button"
              aria-label="Notifications"
              className="p-2.5 text-muted-foreground hover:text-primary hover:bg-secondary rounded-xl border-2 border-transparent hover:border-border transition-colors relative"
            >
              <Bell size={20} />
              <span className="absolute top-2 right-2 w-2 h-2 bg-destructive rounded-full border border-background"></span>
            </button>

            {/* User Dropdown */}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="flex items-center gap-2 pl-2 rounded-full hover:bg-secondary transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <img
                    src={userAvatar}
                    alt="User"
                    className="w-10 h-10 rounded-full border-2 border-border object-cover"
                  />
                  <div className="hidden lg:block text-left mr-2">
                    <div className="text-sm font-semibold text-foreground leading-none">
                      {displayName}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{roleLabel}</div>
                  </div>
                </button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="min-w-[220px] bg-card rounded-2xl shadow-stamp border-3 border-foreground p-2 z-50 animate-in fade-in zoom-in-95 duration-200"
                  align="end"
                  sideOffset={5}
                >
                  <DropdownMenu.Item
                    className="flex items-center px-3 py-2.5 text-sm font-medium text-foreground rounded-xl hover:bg-secondary cursor-pointer outline-none"
                    onClick={() => navigate('/app/profile')}
                  >
                    <User size={16} className="mr-2" /> {t('nav.profile')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="flex items-center px-3 py-2.5 text-sm font-medium text-foreground rounded-xl hover:bg-secondary cursor-pointer outline-none"
                    onClick={() => navigate('/app/settings')}
                  >
                    <Settings size={16} className="mr-2" /> {t('nav.settings')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="flex items-center px-3 py-2.5 text-sm font-medium text-foreground rounded-xl hover:bg-secondary cursor-pointer outline-none"
                    onClick={() => navigate('/app/learn')}
                  >
                    <BookOpen size={16} className="mr-2" /> {t('app.layout.nav.learning')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="flex items-center px-3 py-2.5 text-sm font-medium text-foreground rounded-xl hover:bg-secondary cursor-pointer outline-none"
                    onClick={() => navigate('/app/practice')}
                  >
                    <Mic size={16} className="mr-2" /> {t('app.layout.nav.practice')}
                  </DropdownMenu.Item>
                  {canAccessTeacherView ? (
                    <DropdownMenu.Item
                      className="flex items-center px-3 py-2.5 text-sm font-medium text-foreground rounded-xl hover:bg-secondary cursor-pointer outline-none"
                      onClick={() => navigate('/app/teacher')}
                    >
                      <LayoutDashboard size={16} className="mr-2" /> {t('app.layout.nav.teacher')}
                    </DropdownMenu.Item>
                  ) : null}
                  <DropdownMenu.Separator className="h-px bg-border my-1" />
                  <DropdownMenu.Item
                    className="flex items-center px-3 py-2.5 text-sm font-medium text-destructive rounded-xl hover:bg-destructive/10 cursor-pointer outline-none"
                    onClick={handleLogout}
                  >
                    <LogOut size={16} className="mr-2" /> {t('nav.logout')}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-screen-2xl w-full mx-auto px-4 sm:px-6 lg:px-6 py-6 pb-28 md:pb-6">
        <Outlet />
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t-3 border-foreground bg-card/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.4rem)] pt-2 backdrop-blur md:hidden"
        aria-label="Primary app navigation"
      >
        <div className="grid grid-cols-5 gap-1">
          {mobilePrimaryNav.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl border-2 px-1 text-[11px] font-semibold transition-colors ${
                  isActive
                    ? 'border-foreground bg-primary text-primary-foreground shadow-stamp-sm'
                    : 'border-transparent text-muted-foreground hover:border-border hover:bg-secondary hover:text-foreground'
                }`
              }
            >
              <item.icon size={18} strokeWidth={2.5} />
              <span className="leading-none">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Mobile Nav Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <motion.div
            id="mobile-nav-drawer"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 left-0 w-3/4 max-w-xs bg-card border-r-3 border-foreground shadow-stamp p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 bg-primary border-3 border-foreground rounded-xl flex items-center justify-center text-primary-foreground shadow-stamp-sm">
                  <Languages size={22} strokeWidth={2.5} />
                </div>
                <span className="text-2xl font-display font-bold">Lingual</span>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-2 hover:bg-secondary rounded-lg border-2 border-border"
                aria-label="Close mobile navigation"
              >
                <X size={20} />
              </button>
            </div>

            <nav className="space-y-2">
              {mobileMenuNav.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center space-x-3 px-4 py-3 rounded-xl border-2 transition-colors ${
                      isActive
                        ? 'bg-primary text-primary-foreground border-foreground shadow-stamp-sm font-semibold'
                        : 'text-foreground/80 border-transparent hover:bg-secondary hover:border-border'
                    }`
                  }
                >
                  <item.icon size={20} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </nav>

            <div className="absolute bottom-24 left-6 right-6">
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center space-x-2 px-4 py-3 text-destructive bg-destructive/10 rounded-xl border-2 border-destructive/30 font-medium hover:bg-destructive/20 transition-colors"
              >
                <LogOut size={20} />
                <span>{t('nav.logout')}</span>
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
