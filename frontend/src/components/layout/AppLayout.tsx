import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  Languages,
  BookOpen,
  User,
  Settings,
  LogOut,
  Flame,
  Bell,
  Menu,
  X,
  LayoutDashboard,
} from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { motion } from 'motion/react';
import { Toaster } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';

const USER_AVATAR = '/imgs/landing/student.jpg';

export function AppLayout() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const displayName = user?.name || 'Student';
  const roleLabel = t('app.layout.role.learner');

  const handleLogout = async () => {
    await logout();
    navigate('/auth');
  };

  return (
    <div className="min-h-screen bg-background font-body text-foreground flex flex-col">
      <Toaster position="top-right" richColors />
      {/* Top Navigation */}
      <header className="bg-card border-b border-border sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Left: Logo & Mobile Menu */}
          <div className="flex items-center gap-4">
            <button
              className="md:hidden p-2 -ml-2 text-muted-foreground hover:bg-secondary rounded-lg"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <div
              className="flex items-center space-x-2 cursor-pointer"
              onClick={() => navigate('/app/learn')}
            >
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground shadow-sm">
                <Languages size={18} />
              </div>
              <span className="text-lg font-display font-bold tracking-tight text-foreground hidden sm:block">
                Lingual
              </span>
            </div>

            {/* Language Selector (Static for now) */}
            <div className="hidden md:flex items-center space-x-1 bg-secondary rounded-full px-3 py-1.5 ml-6 border border-border hover:border-primary/50 cursor-pointer transition-colors">
              <span className="text-lg">🇰🇷</span>
              <span className="text-sm font-semibold text-foreground">
                {t('app.layout.language.korean')}
              </span>
            </div>
          </div>

          {/* Right: Progress & User */}
          <div className="flex items-center gap-3">
            {/* Streak */}
            <div className="hidden sm:flex items-center space-x-1.5 text-accent-foreground bg-accent/20 px-3 py-1.5 rounded-full border border-accent/30">
              <Flame size={16} fill="currentColor" className="text-accent" />
              <span className="text-sm font-bold">12</span>
            </div>

            {/* Notifications */}
            <button className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors relative">
              <Bell size={20} />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-destructive rounded-full border-2 border-card"></span>
            </button>

            {/* User Dropdown */}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-lg hover:bg-secondary transition-colors focus:outline-none focus:ring-2 focus:ring-ring">
                  <img
                    src={USER_AVATAR}
                    alt="User"
                    className="w-8 h-8 rounded-lg border border-border shadow-sm object-cover"
                  />
                  <div className="hidden lg:block text-left mr-1">
                    <div className="text-sm font-semibold text-foreground leading-none">
                      {displayName}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{roleLabel}</div>
                  </div>
                </button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="min-w-[200px] bg-card rounded-lg shadow-lg border border-border p-1.5 z-50 animate-in fade-in zoom-in-95 duration-200"
                  align="end"
                  sideOffset={5}
                >
                  <DropdownMenu.Item
                    className="flex items-center px-3 py-2 text-sm text-foreground rounded-md hover:bg-primary/10 hover:text-primary cursor-pointer outline-none"
                    onClick={() => navigate('/app/profile')}
                  >
                    <User size={16} className="mr-2" /> {t('nav.profile')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="flex items-center px-3 py-2 text-sm text-foreground rounded-md hover:bg-primary/10 hover:text-primary cursor-pointer outline-none"
                    onClick={() => navigate('/app/settings')}
                  >
                    <Settings size={16} className="mr-2" /> {t('nav.settings')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="flex items-center px-3 py-2 text-sm text-foreground rounded-md hover:bg-primary/10 hover:text-primary cursor-pointer outline-none"
                    onClick={() => navigate('/app/learn')}
                  >
                    <BookOpen size={16} className="mr-2" /> {t('app.layout.nav.learning')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="h-px bg-border my-1" />
                  <DropdownMenu.Item
                    className="flex items-center px-3 py-2 text-sm text-destructive rounded-md hover:bg-destructive/10 cursor-pointer outline-none"
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
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      {/* Mobile Nav Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 left-0 w-3/4 max-w-xs bg-card shadow-lg border-r border-border p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground shadow-sm">
                  <Languages size={18} />
                </div>
                <span className="text-xl font-display font-bold text-foreground">Lingual</span>
              </div>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-2 hover:bg-secondary rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <nav className="space-y-1">
              {[
                { icon: BookOpen, label: t('app.layout.nav.learning'), path: '/app/learn' },
                { icon: User, label: t('nav.profile'), path: '/app/profile' },
                { icon: Settings, label: t('nav.settings'), path: '/app/settings' },
                { icon: LayoutDashboard, label: t('app.layout.nav.teacher'), path: '/app/teacher' },
              ].map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                      isActive
                        ? 'bg-primary/10 text-primary font-semibold'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    }`
                  }
                >
                  <item.icon size={20} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </nav>

            <div className="absolute bottom-8 left-6 right-6">
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center space-x-2 px-4 py-3 text-destructive bg-destructive/10 rounded-lg font-medium hover:bg-destructive/20 transition-colors"
              >
                <LogOut size={20} />
                <span>Log Out</span>
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
