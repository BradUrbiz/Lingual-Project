import { useEffect, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { User, Bell, Shield, Lock, Smartphone, Settings } from 'lucide-react';
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
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-14 h-14 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-sm">
          <Settings size={28} strokeWidth={2.5} />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Preferences
          </p>
          <h1 className="text-3xl font-display font-bold text-foreground">
            {t('app.settings.title')}
          </h1>
        </div>
      </div>

      <Tabs.Root defaultValue="account" className="flex flex-col md:flex-row gap-6">
        {/* Tab Navigation */}
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
                'group flex items-center space-x-3 px-4 py-3 rounded-lg text-left transition-all border',
                'data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary/20 data-[state=active]:shadow-sm',
                'text-muted-foreground hover:text-foreground hover:bg-secondary border-transparent data-[state=inactive]:hover:border-border'
              )}
            >
              <tab.icon size={18} strokeWidth={2.5} className="opacity-70 group-data-[state=active]:opacity-100" />
              <span className="font-bold">{tab.label}</span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* Content Panel */}
        <div className="flex-1 bg-card rounded-xl border border-border shadow-md p-8 min-h-[500px]">
          {/* Account Tab */}
          <Tabs.Content
            value="account"
            className="space-y-8 outline-none animate-in fade-in slide-in-from-right-4 duration-300"
          >
            <div>
              <h2 className="text-xl font-display font-bold text-foreground mb-1">
                {t('app.settings.account.title')}
              </h2>
              <p className="text-muted-foreground text-sm">
                {t('app.settings.account.subtitle')}
              </p>
            </div>

            <div className="grid gap-6">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-foreground">
                    {t('app.settings.account.firstName')}
                  </label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    placeholder={t('app.settings.account.firstNamePlaceholder')}
                    disabled={isLoading}
                    className="w-full px-4 py-3 rounded-xl border-2 border-border bg-card text-foreground font-medium placeholder:text-muted-foreground focus:border-primary focus:outline-none transition-all disabled:bg-secondary disabled:text-muted-foreground"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-foreground">
                    {t('app.settings.account.lastName')}
                  </label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    placeholder={t('app.settings.account.lastNamePlaceholder')}
                    disabled={isLoading}
                    className="w-full px-4 py-3 rounded-xl border-2 border-border bg-card text-foreground font-medium placeholder:text-muted-foreground focus:border-primary focus:outline-none transition-all disabled:bg-secondary disabled:text-muted-foreground"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-foreground">
                  {t('app.settings.account.email')}
                </label>
                <input
                  type="email"
                  value={user?.email || ''}
                  readOnly
                  disabled
                  className="w-full px-4 py-3 rounded-xl border-2 border-border bg-secondary text-muted-foreground font-medium outline-none"
                />
              </div>

              <div className="pt-4 flex justify-end">
                <button
                  onClick={handleSave}
                  disabled={isLoading || isSaving}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-3 px-6 rounded-lg shadow-sm hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none disabled:hover:translate-y-0"
                >
                  {isSaving ? t('app.settings.account.saving') : t('app.settings.account.save')}
                </button>
              </div>
            </div>
          </Tabs.Content>

          {/* Notifications Tab */}
          <Tabs.Content
            value="notifications"
            className="space-y-8 outline-none animate-in fade-in slide-in-from-right-4 duration-300"
          >
            <div>
              <h2 className="text-xl font-display font-bold text-foreground mb-1">
                {t('app.settings.notifications.title')}
              </h2>
              <p className="text-muted-foreground text-sm">
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
                  className="flex items-center justify-between p-4 border-2 border-border rounded-xl hover:bg-secondary transition-colors"
                >
                  <div>
                    <div className="font-bold text-foreground">{t(setting.labelKey)}</div>
                    <div className="text-sm text-muted-foreground">{t(setting.descKey)}</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" defaultChecked={setting.default} className="sr-only peer" />
                    <div className="w-12 h-7 bg-secondary border-2 border-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-5 peer-checked:after:border-foreground after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-card after:border-2 after:border-border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-checked:border-foreground"></div>
                  </label>
                </div>
              ))}
            </div>
          </Tabs.Content>

          {/* Privacy Tab */}
          <Tabs.Content
            value="privacy"
            className="space-y-8 outline-none animate-in fade-in slide-in-from-right-4 duration-300"
          >
            <div>
              <h2 className="text-xl font-display font-bold text-foreground mb-1">
                {t('app.settings.privacy.title')}
              </h2>
              <p className="text-muted-foreground text-sm">{t('app.settings.privacy.subtitle')}</p>
            </div>

            <div className="space-y-6">
              <div className="p-4 bg-accent/10 border-2 border-accent/30 rounded-xl text-foreground text-sm">
                {t('app.settings.privacy.notice')}
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 border-2 border-border rounded-xl">
                  <span className="font-bold text-foreground">
                    {t('app.settings.privacy.audio')}
                  </span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" defaultChecked className="sr-only peer" />
                    <div className="w-12 h-7 bg-secondary border-2 border-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-5 peer-checked:after:border-foreground after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-card after:border-2 after:border-border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-success peer-checked:border-foreground"></div>
                  </label>
                </div>
                <p className="text-sm text-muted-foreground ml-0">
                  {t('app.settings.privacy.audioNote')}
                </p>
              </div>

              <div className="pt-8 border-t-2 border-border">
                <h3 className="font-display font-bold text-foreground mb-4">
                  {t('app.settings.privacy.danger')}
                </h3>
                <button className="text-destructive font-bold border-2 border-destructive bg-destructive/10 hover:bg-destructive/20 px-4 py-3 rounded-xl transition-colors">
                  {t('app.settings.privacy.delete')}
                </button>
              </div>
            </div>
          </Tabs.Content>

          {/* Password Tab (Placeholder) */}
          <Tabs.Content
            value="password"
            className="outline-none animate-in fade-in slide-in-from-right-4 duration-300"
          >
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <div className="w-16 h-16 rounded-2xl bg-secondary border-2 border-border flex items-center justify-center mb-4">
                <Lock size={32} strokeWidth={2} />
              </div>
              <p className="font-medium">{t('app.settings.password.placeholder')}</p>
            </div>
          </Tabs.Content>

          {/* Devices Tab (Placeholder) */}
          <Tabs.Content
            value="devices"
            className="outline-none animate-in fade-in slide-in-from-right-4 duration-300"
          >
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <div className="w-16 h-16 rounded-2xl bg-secondary border-2 border-border flex items-center justify-center mb-4">
                <Smartphone size={32} strokeWidth={2} />
              </div>
              <p className="font-medium">{t('app.settings.devices.placeholder')}</p>
            </div>
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </div>
  );
}
