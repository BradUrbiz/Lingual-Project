import { useEffect, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { User, Bell, Shield, Lock, Smartphone } from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { getUserProfile, updateProfile } from '@/api/user';
import type { UserProfile } from '@/types';
import { useLanguage } from '@/contexts/LanguageContext';

export function AppSettingsPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const data = await getUserProfile();
        setProfile(data);
        const nameSource = data.displayName || user?.name || '';
        const parts = nameSource.trim().split(/\s+/).filter(Boolean);
        setFirstName(parts[0] || '');
        setLastName(parts.slice(1).join(' '));
      } catch (error) {
        console.error('Failed to load profile:', error);
        toast.error(t('app.settings.toast.loadError'));
      } finally {
        setIsLoading(false);
      }
    };

    loadProfile();
  }, [user?.name, t]);

  const handleSave = async () => {
    if (!profile) return;
    setIsSaving(true);
    try {
      const displayName = [firstName, lastName].filter(Boolean).join(' ').trim();
      await updateProfile(
        {
          displayName: displayName || profile.displayName || '',
          age: profile.age ?? null,
          gender: profile.gender ?? null,
          rigor: profile.rigor ?? null,
          frequency: profile.frequency ?? 3,
          frequencyUnit: profile.frequencyUnit ?? 'week',
          levelObjective: profile.levelObjective ?? '',
        },
        true
      );
      const refreshed = await getUserProfile();
      setProfile(refreshed);
      toast.success(t('app.settings.toast.saved'));
    } catch (error) {
      console.error('Failed to save settings:', error);
      toast.error(t('app.settings.toast.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-slate-900 mb-8">
        {t('app.settings.title')}
      </h1>

      <Tabs.Root defaultValue="account" className="flex flex-col md:flex-row gap-8">
        <Tabs.List className="flex flex-col space-y-2 md:w-64 flex-shrink-0">
          {[
            { value: 'account', icon: User, label: t('app.settings.tabs.account') },
            { value: 'password', icon: Lock, label: t('app.settings.tabs.password') },
            { value: 'notifications', icon: Bell, label: t('app.settings.tabs.notifications') },
            { value: 'privacy', icon: Shield, label: t('app.settings.tabs.privacy') },
            { value: 'devices', icon: Smartphone, label: t('app.settings.tabs.devices') },
          ].map((tab) => (
            <Tabs.Trigger
              key={tab.value}
              value={tab.value}
              className={clsx(
                'group flex items-center space-x-3 px-4 py-3 rounded-xl text-left transition-all',
                'data-[state=active]:bg-purple-600 data-[state=active]:text-white',
                'text-slate-600 hover:bg-slate-100 data-[state=active]:shadow-md'
              )}
            >
              <tab.icon size={18} className="opacity-70 group-data-[state=active]:opacity-100" />
              <span className="font-medium">{tab.label}</span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 p-8 min-h-[500px]">
          <Tabs.Content
            value="account"
            className="space-y-8 outline-none animate-in fade-in slide-in-from-right-4 duration-300"
          >
            <div>
              <h2 className="text-xl font-bold text-slate-900 mb-1">
                {t('app.settings.account.title')}
              </h2>
              <p className="text-slate-500 text-sm">
                {t('app.settings.account.subtitle')}
              </p>
            </div>

            <div className="grid gap-6">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">
                    {t('app.settings.account.firstName')}
                  </label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    placeholder={t('app.settings.account.firstNamePlaceholder')}
                    disabled={isLoading}
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none transition-all disabled:bg-slate-50"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">
                    {t('app.settings.account.lastName')}
                  </label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    placeholder={t('app.settings.account.lastNamePlaceholder')}
                    disabled={isLoading}
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none transition-all disabled:bg-slate-50"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">
                  {t('app.settings.account.email')}
                </label>
                <input
                  type="email"
                  value={user?.email || ''}
                  readOnly
                  disabled
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-500 outline-none"
                />
              </div>

              <div className="pt-4 flex justify-end">
                <button
                  onClick={handleSave}
                  disabled={isLoading || isSaving}
                  className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 px-6 rounded-lg shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSaving ? t('app.settings.account.saving') : t('app.settings.account.save')}
                </button>
              </div>
            </div>
          </Tabs.Content>

          <Tabs.Content
            value="notifications"
            className="space-y-8 outline-none animate-in fade-in slide-in-from-right-4 duration-300"
          >
            <div>
              <h2 className="text-xl font-bold text-slate-900 mb-1">
                {t('app.settings.notifications.title')}
              </h2>
              <p className="text-slate-500 text-sm">
                {t('app.settings.notifications.subtitle')}
              </p>
            </div>

            <div className="space-y-4">
              {[
                { labelKey: 'app.settings.notifications.email.title', descKey: 'app.settings.notifications.email.desc', default: true },
                { labelKey: 'app.settings.notifications.reminders.title', descKey: 'app.settings.notifications.reminders.desc', default: true },
                { labelKey: 'app.settings.notifications.teacher.title', descKey: 'app.settings.notifications.teacher.desc', default: true },
                { labelKey: 'app.settings.notifications.updates.title', descKey: 'app.settings.notifications.updates.desc', default: false },
              ].map((setting, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-4 border border-slate-100 rounded-xl hover:bg-slate-50 transition-colors"
                >
                  <div>
                    <div className="font-semibold text-slate-900">{t(setting.labelKey)}</div>
                    <div className="text-sm text-slate-500">{t(setting.descKey)}</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" defaultChecked={setting.default} className="sr-only peer" />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                  </label>
                </div>
              ))}
            </div>
          </Tabs.Content>

          <Tabs.Content
            value="privacy"
            className="space-y-8 outline-none animate-in fade-in slide-in-from-right-4 duration-300"
          >
            <div>
              <h2 className="text-xl font-bold text-slate-900 mb-1">
                {t('app.settings.privacy.title')}
              </h2>
              <p className="text-slate-500 text-sm">{t('app.settings.privacy.subtitle')}</p>
            </div>

            <div className="space-y-6">
              <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl text-amber-800 text-sm">
                {t('app.settings.privacy.notice')}
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">
                    {t('app.settings.privacy.audio')}
                  </span>
                  <input
                    type="checkbox"
                    checked
                    readOnly
                    className="h-5 w-5 text-purple-600 rounded border-slate-300 focus:ring-purple-500"
                  />
                </div>
                <p className="text-sm text-slate-500 ml-0">
                  {t('app.settings.privacy.audioNote')}
                </p>
              </div>

              <div className="pt-8 border-t border-slate-100">
                <h3 className="font-bold text-slate-900 mb-4">
                  {t('app.settings.privacy.danger')}
                </h3>
                <button className="text-red-600 font-semibold border border-red-200 bg-red-50 hover:bg-red-100 px-4 py-2 rounded-lg transition-colors">
                  {t('app.settings.privacy.delete')}
                </button>
              </div>
            </div>
          </Tabs.Content>

          <Tabs.Content
            value="password"
            className="outline-none animate-in fade-in slide-in-from-right-4 duration-300"
          >
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
              <Lock size={48} className="mb-4 opacity-50" />
              <p>{t('app.settings.password.placeholder')}</p>
            </div>
          </Tabs.Content>
          <Tabs.Content
            value="devices"
            className="outline-none animate-in fade-in slide-in-from-right-4 duration-300"
          >
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
              <Smartphone size={48} className="mb-4 opacity-50" />
              <p>{t('app.settings.devices.placeholder')}</p>
            </div>
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </div>
  );
}
