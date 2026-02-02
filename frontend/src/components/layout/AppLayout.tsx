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
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 flex flex-col">
      <Toaster position="top-right" richColors />
      {/* Top Navigation */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Left: Logo & Mobile Menu */}
          <div className="flex items-center gap-4">
            <button
              className="md:hidden p-2 -ml-2 text-slate-500 hover:bg-slate-100 rounded-lg"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <div
              className="flex items-center space-x-2 cursor-pointer"
              onClick={() => navigate('/app/learn')}
            >
              <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center text-white shadow-purple-200 shadow-md">
                <Languages size={18} />
              </div>
              <span className="text-lg font-bold tracking-tight text-slate-900 hidden sm:block">
                Lingual
              </span>
            </div>

            {/* Language Selector (Static for now) */}
            <div className="hidden md:flex items-center space-x-1 bg-slate-100 rounded-full px-3 py-1.5 ml-6 border border-slate-200 hover:border-purple-200 cursor-pointer transition-colors">
              <span className="text-lg">🇰🇷</span>
              <span className="text-sm font-semibold text-slate-700">
                {t('app.layout.language.korean')}
              </span>
            </div>
          </div>

          {/* Right: Progress & User */}
          <div className="flex items-center gap-4">
            {/* Streak */}
            <div className="hidden sm:flex items-center space-x-1 text-orange-500 bg-orange-50 px-3 py-1.5 rounded-full border border-orange-100">
              <Flame size={18} fill="currentColor" />
              <span className="text-sm font-bold">12</span>
            </div>

            {/* Notifications */}
            <button className="p-2 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-full transition-colors relative">
              <Bell size={20} />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border border-white"></span>
            </button>

            {/* User Dropdown */}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="flex items-center gap-2 pl-2 rounded-full hover:bg-slate-50 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-200">
                  <img
                    src={USER_AVATAR}
                    alt="User"
                    className="w-9 h-9 rounded-full border-2 border-white shadow-sm object-cover"
                  />
                  <div className="hidden lg:block text-left mr-2">
                    <div className="text-sm font-semibold text-slate-900 leading-none">
                      {displayName}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">{roleLabel}</div>
                  </div>
                </button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="min-w-[200px] bg-white rounded-xl shadow-xl border border-slate-100 p-2 z-50 animate-in fade-in zoom-in-95 duration-200"
                  align="end"
                  sideOffset={5}
                >
                  <DropdownMenu.Item
                    className="flex items-center px-3 py-2 text-sm text-slate-700 rounded-lg hover:bg-purple-50 hover:text-purple-700 cursor-pointer outline-none"
                    onClick={() => navigate('/app/profile')}
                  >
                    <User size={16} className="mr-2" /> {t('nav.profile')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="flex items-center px-3 py-2 text-sm text-slate-700 rounded-lg hover:bg-purple-50 hover:text-purple-700 cursor-pointer outline-none"
                    onClick={() => navigate('/app/settings')}
                  >
                    <Settings size={16} className="mr-2" /> {t('nav.settings')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="flex items-center px-3 py-2 text-sm text-slate-700 rounded-lg hover:bg-purple-50 hover:text-purple-700 cursor-pointer outline-none"
                    onClick={() => navigate('/app/learn')}
                  >
                    <BookOpen size={16} className="mr-2" /> {t('app.layout.nav.learning')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="h-px bg-slate-100 my-1" />
                  <DropdownMenu.Item
                    className="flex items-center px-3 py-2 text-sm text-red-600 rounded-lg hover:bg-red-50 cursor-pointer outline-none"
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
          className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-sm md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 left-0 w-3/4 max-w-xs bg-white shadow-2xl p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center text-white">
                  <Languages size={18} />
                </div>
                <span className="text-xl font-bold text-slate-900">Lingual</span>
              </div>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-2 hover:bg-slate-100 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <nav className="space-y-2">
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
                    `flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors ${
                      isActive
                        ? 'bg-purple-50 text-purple-700 font-semibold'
                        : 'text-slate-600 hover:bg-slate-50'
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
                className="w-full flex items-center justify-center space-x-2 px-4 py-3 text-red-600 bg-red-50 rounded-xl font-medium hover:bg-red-100 transition-colors"
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
