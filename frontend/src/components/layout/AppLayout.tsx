import { useEffect, useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Languages,
  BookOpen,
  MessageSquare,
  Gamepad2,
  User,
  Settings,
  LogOut,
  Menu,
  X,
  LayoutDashboard,
  Mic,
  CircleUserRound,
  ChevronDown,
  Check,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { m } from 'framer-motion';
import { Toaster, toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useMembership } from '@/contexts/MembershipContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { getLearningLocaleDirection, useLearningLocale } from '@/contexts/LearningLocaleContext';
import { LEARNING_LOCALES } from '@/lib/learningLocales';
import { getUserProfile, updateLearningLocale } from '@/api/user';
import { getPrivilegedHomeRoute, LEARNER_HOME_ROUTE } from '@/lib/homeRoutes';
import type { UserProfile } from '@/types';

type LearningLocaleValue = (typeof LEARNING_LOCALES)[number]['value'];
type AppNavItem = {
  icon: LucideIcon;
  label: string;
  path: string;
};

type LearningLocaleSelectorProps = {
  isTeacherView: boolean;
  learningLocale: LearningLocaleValue;
  isUpdatingLocale: boolean;
  fallbackLabel: string;
  onLocaleChange: (nextLocale: LearningLocaleValue) => void;
};

function LearningLocaleSelector({
  isTeacherView,
  learningLocale,
  isUpdatingLocale,
  fallbackLabel,
  onLocaleChange,
}: LearningLocaleSelectorProps) {
  if (isTeacherView) return null;

  const localeOption = LEARNING_LOCALES.find((locale) => locale.value === learningLocale);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="ml-1 inline-flex items-center gap-2 rounded-full border-2 border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:border-primary hover:bg-secondary sm:ml-4"
          aria-label="Select practice language"
          disabled={isUpdatingLocale}
        >
          <span className="text-lg leading-none">{localeOption?.flag || '🌐'}</span>
          <span className="hidden md:block">
            {localeOption?.shortLabel || fallbackLabel}
          </span>
          {isUpdatingLocale ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground" />
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[220px] rounded-2xl border-3 border-foreground bg-card p-2 shadow-stamp z-50"
          align="start"
          sideOffset={8}
        >
          {LEARNING_LOCALES.map((locale) => (
            <DropdownMenu.Item
              key={locale.value}
              className="flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium text-foreground outline-none hover:bg-secondary"
              onSelect={() => {
                onLocaleChange(locale.value);
              }}
            >
              <span className="flex items-center gap-3">
                <span className="text-lg leading-none">{locale.flag}</span>
                <span>{locale.shortLabel}</span>
              </span>
              {locale.value === learningLocale ? (
                <Check className="size-4 text-primary" />
              ) : null}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

type UserMenuProps = {
  userAvatar: string | null;
  displayName: string;
  roleLabel: string;
  canAccessTeacherView: boolean;
  profileLabel: string;
  settingsLabel: string;
  teacherLabel: string;
  logoutLabel: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
};

function UserMenu({
  userAvatar,
  displayName,
  roleLabel,
  canAccessTeacherView,
  profileLabel,
  settingsLabel,
  teacherLabel,
  logoutLabel,
  onNavigate,
  onLogout,
}: UserMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="flex items-center gap-2 pl-2 rounded-full hover:bg-secondary transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30">
          {userAvatar ? (
            <img
              src={userAvatar}
              alt={displayName}
              className="size-10 rounded-full border-2 border-border object-cover"
            />
          ) : (
            <div className="flex size-10 items-center justify-center rounded-full border-2 border-border bg-card text-muted-foreground">
              <CircleUserRound className="size-6" />
            </div>
          )}
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
            onClick={() => onNavigate('/app/profile')}
          >
            <User size={16} className="mr-2" /> {profileLabel}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="flex items-center px-3 py-2.5 text-sm font-medium text-foreground rounded-xl hover:bg-secondary cursor-pointer outline-none"
            onClick={() => onNavigate('/app/settings')}
          >
            <Settings size={16} className="mr-2" /> {settingsLabel}
          </DropdownMenu.Item>
          {canAccessTeacherView ? (
            <DropdownMenu.Item
              className="flex items-center px-3 py-2.5 text-sm font-medium text-foreground rounded-xl hover:bg-secondary cursor-pointer outline-none"
              onClick={() => onNavigate('/app/teacher')}
            >
              <LayoutDashboard size={16} className="mr-2" /> {teacherLabel}
            </DropdownMenu.Item>
          ) : null}
          <DropdownMenu.Separator className="h-px bg-border my-1" />
          <DropdownMenu.Item
            className="flex items-center px-3 py-2.5 text-sm font-medium text-destructive rounded-xl hover:bg-destructive/10 cursor-pointer outline-none"
            onClick={onLogout}
          >
            <LogOut size={16} className="mr-2" /> {logoutLabel}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MobileBottomNav({ items }: { items: AppNavItem[] }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t-3 border-foreground bg-card/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.4rem)] pt-2 backdrop-blur md:hidden"
      aria-label="Primary app navigation"
    >
      <div className="grid grid-cols-4 gap-1">
        {items.map((item) => (
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
  );
}

type MobileNavDrawerProps = {
  isTeacherView: boolean;
  learningLocale: LearningLocaleValue;
  isUpdatingLocale: boolean;
  mobileMenuNav: AppNavItem[];
  homeLabel: string;
  logoutLabel: string;
  onHomeNavigation: () => void;
  onLocaleChange: (nextLocale: LearningLocaleValue) => void;
  onClose: () => void;
  onLogout: () => void;
};

function MobileNavDrawer({
  isTeacherView,
  learningLocale,
  isUpdatingLocale,
  mobileMenuNav,
  homeLabel,
  logoutLabel,
  onHomeNavigation,
  onLocaleChange,
  onClose,
  onLogout,
}: MobileNavDrawerProps) {
  return (
    <>
      <button
        type="button"
        aria-label="Close navigation menu"
        className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm md:hidden"
        onClick={onClose}
      />
      <m.div
        id="mobile-nav-drawer"
        initial={{ x: '-100%' }}
        animate={{ x: 0 }}
        exit={{ x: '-100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed inset-y-0 left-0 z-50 w-3/4 max-w-xs bg-card border-r-3 border-foreground shadow-stamp p-6"
      >
        <div className="flex items-center justify-between mb-8">
          <button
            type="button"
            onClick={onHomeNavigation}
            className="flex items-center gap-3"
            aria-label={homeLabel}
          >
            <div className="size-11 bg-primary border-3 border-foreground rounded-xl flex items-center justify-center text-primary-foreground shadow-stamp-sm">
              <Languages size={22} strokeWidth={2.5} />
            </div>
            <span className="text-2xl font-display font-bold">Lingual</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-lg border-2 border-border"
            aria-label="Close mobile navigation"
          >
            <X size={20} />
          </button>
        </div>

        {!isTeacherView ? (
          <div className="mb-6 rounded-2xl border-2 border-border bg-secondary/50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
              Practice Language
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {LEARNING_LOCALES.map((locale) => (
                <button
                  key={locale.value}
                  type="button"
                  onClick={() => {
                    onLocaleChange(locale.value);
                  }}
                  disabled={isUpdatingLocale}
                  className={`rounded-xl border-2 px-2 py-2 text-center text-xs font-semibold transition-colors ${
                    locale.value === learningLocale
                      ? 'border-foreground bg-primary text-primary-foreground'
                      : 'border-border bg-card text-foreground hover:border-primary'
                  }`}
                >
                  <div className="text-base leading-none">{locale.flag}</div>
                  <div className="mt-1">{locale.shortLabel}</div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <nav className="space-y-2">
          {mobileMenuNav.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onClose}
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
            type="button"
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-x-2 px-4 py-3 text-destructive bg-destructive/10 rounded-xl border-2 border-destructive/30 font-medium hover:bg-destructive/20 transition-colors"
          >
            <LogOut size={20} />
            <span>{logoutLabel}</span>
          </button>
        </div>
      </m.div>
    </>
  );
}

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, avatarUrl, updateAvatarUrl } = useAuth();
  const { hasAnyRole, activeMembership } = useMembership();
  const { t } = useLanguage();
  const { learningLocale, setLearningLocale } = useLearningLocale();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isUpdatingLocale, setIsUpdatingLocale] = useState(false);

  useEffect(() => {
    if (!user) return;
    getUserProfile().then((p) => {
      setProfile(p);
      if (p.avatarUrl) updateAvatarUrl(p.avatarUrl);
    }).catch(() => {});
  }, [user, updateAvatarUrl]);

  const displayName = profile?.displayName || user?.name || 'Student';
  const userAvatar = avatarUrl || profile?.avatarUrl || null;
  const canAccessTeacherView = hasAnyRole(['teacher', 'school_admin']);
  const isTeacherView = location.pathname.startsWith('/app/teacher');
  // Priority: Lingual admin > school admin > teacher > student.
  // The active membership's org name suffixes school admin / teacher labels;
  // students get their grade level if it's set on their profile.
  const orgSuffix = activeMembership?.orgName ? ` · ${activeMembership.orgName}` : '';
  const roleLabel = user?.lingualAdmin
    ? t('app.layout.role.lingualAdmin')
    : hasAnyRole(['school_admin'])
    ? `${t('app.layout.role.schoolAdmin')}${orgSuffix}`
    : hasAnyRole(['teacher'])
    ? `${t('app.layout.role.teacher')}${orgSuffix}`
    : profile?.gradeLevel
    ? `${t('app.layout.role.student')} · ${profile.gradeLevel}`
    : t('app.layout.role.student');
  const learningLocaleDirection = getLearningLocaleDirection(learningLocale);
  // Home button priority mirrors the post-login dispatcher in lib/homeRoutes:
  // Lingual admin > school admin > teacher > learner. Reusing
  // `getPrivilegedHomeRoute` keeps the logo destination in lockstep with
  // the post-login dispatcher (Plan 5 / Task 27 split school_admin off to
  // /app/admin and lingual admins to /lingual-admin/requests; the latter is
  // mounted at the top level so it bypasses AppLayout entirely).
  const homeDestination = getPrivilegedHomeRoute(user) ?? LEARNER_HOME_ROUTE;
  const homeLabel = user?.lingualAdmin
    ? 'Go to Lingual admin dashboard'
    : hasAnyRole(['school_admin'])
    ? 'Go to school admin dashboard'
    : canAccessTeacherView
    ? 'Go to teacher dashboard'
    : 'Go to learning dashboard';
  const mobilePrimaryNav = [
    { icon: BookOpen, label: t('app.layout.nav.learning'), path: '/app/learn' },
    { icon: MessageSquare, label: t('app.layout.nav.chat'), path: '/app/chat' },
    { icon: Mic, label: t('app.layout.nav.practice'), path: '/app/practice' },
    { icon: Gamepad2, label: t('app.layout.nav.games'), path: '/app/games' },
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
    navigate('/', { replace: true });
  };

  const handleHomeNavigation = () => {
    navigate(homeDestination);
    setIsMobileMenuOpen(false);
  };

  const handleLocaleChange = async (nextLocale: (typeof LEARNING_LOCALES)[number]['value']) => {
    if (nextLocale === learningLocale || isUpdatingLocale) return;

    setIsUpdatingLocale(true);
    try {
      await updateLearningLocale(nextLocale);
      setLearningLocale(nextLocale);
      setProfile((current) => (current ? { ...current, learningLocale: nextLocale } : current));
      toast.success('Default practice language updated. Teacher assignments can still override it.');
    } catch (error) {
      console.error('Failed to update learning locale:', error);
      toast.error('Failed to update practice language.');
    } finally {
      setIsUpdatingLocale(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-background font-body text-foreground flex flex-col"
      dir={learningLocaleDirection}
      lang={learningLocale}
    >
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
              onClick={handleHomeNavigation}
              aria-label={homeLabel}
            >
              <div className="size-12 bg-primary border-3 border-foreground rounded-xl flex items-center justify-center text-primary-foreground shadow-stamp-sm">
                <Languages size={26} strokeWidth={2.5} />
              </div>
              <span className="text-2xl font-display font-bold tracking-tight hidden sm:block">
                Lingual
              </span>
            </button>

            <LearningLocaleSelector
              isTeacherView={isTeacherView}
              learningLocale={learningLocale}
              isUpdatingLocale={isUpdatingLocale}
              fallbackLabel={t('app.layout.language.korean')}
              onLocaleChange={(nextLocale) => {
                void handleLocaleChange(nextLocale);
              }}
            />
          </div>

          <div className="flex items-center gap-4">
            <UserMenu
              userAvatar={userAvatar}
              displayName={displayName}
              roleLabel={roleLabel}
              canAccessTeacherView={canAccessTeacherView}
              profileLabel={t('nav.profile')}
              settingsLabel={t('nav.settings')}
              teacherLabel={t('app.layout.nav.teacher')}
              logoutLabel={t('nav.logout')}
              onNavigate={navigate}
              onLogout={handleLogout}
            />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-screen-2xl w-full mx-auto px-4 sm:px-6 lg:px-6 py-6 pb-28 md:pb-6">
        <Outlet />
      </main>

      <MobileBottomNav items={mobilePrimaryNav} />

      {/* Mobile Nav Overlay */}
      {isMobileMenuOpen && (
        <MobileNavDrawer
          isTeacherView={isTeacherView}
          learningLocale={learningLocale}
          isUpdatingLocale={isUpdatingLocale}
          mobileMenuNav={mobileMenuNav}
          homeLabel={homeLabel}
          logoutLabel={t('nav.logout')}
          onHomeNavigation={handleHomeNavigation}
          onLocaleChange={(nextLocale) => {
            void handleLocaleChange(nextLocale);
          }}
          onClose={() => setIsMobileMenuOpen(false)}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}
