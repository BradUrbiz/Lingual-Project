import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as Tabs from '@radix-ui/react-tabs';
import {
  AlertCircle,
  Bell,
  ChevronRight,
  KeyRound,
  Lock,
  Mail,
  Mic,
  Settings,
  Shield,
  Smartphone,
  User,
} from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { getUserProfile, updateProfile } from '@/api/user';
import { getStudentCompliance } from '@/api/voiceConsent';
import { Alert, AlertDescription, Badge, Button } from '@/components/ui';
import type { LearningLocale, UserProfile } from '@/types';
import type { StudentComplianceRecord } from '@/types/school';
import { useLanguage } from '@/contexts/LanguageContext';
import { useLearningLocale } from '@/contexts/LearningLocaleContext';
import { DEFAULT_LEARNING_LOCALE, LEARNING_LOCALES } from '@/lib/learningLocales';
import { AGE_RANGES, ageToRangeLabel } from '@/lib/ageRanges';

export function AppSettingsPage() {
  const { t } = useLanguage();
  const { user, changePassword, sendPasswordReset } = useAuth();
  const navigate = useNavigate();
  const { learningLocale, setLearningLocale } = useLearningLocale();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [selectedLocale, setSelectedLocale] = useState<LearningLocale>(learningLocale);
  const [selectedAge, setSelectedAge] = useState<number | null>(null);
  const [compliance, setCompliance] = useState<StudentComplianceRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const data = await getUserProfile();
        setProfile(data);
        const nameSource = data.displayName || user?.name || '';
        const parts = nameSource.trim().split(/\s+/).filter(Boolean);
        setFirstName(parts[0] || '');
        setLastName(parts.slice(1).join(' '));
        setSelectedLocale(data.learningLocale || learningLocale || DEFAULT_LEARNING_LOCALE);
        setSelectedAge(data.age ?? null);
      } catch (error) {
        console.error('Failed to load profile:', error);
        toast.error(t('app.settings.toast.loadError'));
      } finally {
        setIsLoading(false);
      }
    };

    loadProfile();
  }, [user?.name, t, learningLocale]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const record = await getStudentCompliance();
        if (active) setCompliance(record);
      } catch (err) {
        // Silent: students not in a school org get 400 here. Fine to skip.
        if (active) setCompliance(null);
        console.debug('compliance fetch skipped:', err);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleSave = async () => {
    if (!profile) return;
    setIsSaving(true);
    try {
      const displayName = [firstName, lastName].filter(Boolean).join(' ').trim();
      await updateProfile(
        {
          displayName: displayName || profile.displayName || '',
          age: selectedAge ?? null,
          gender: profile.gender ?? null,
          rigor: profile.rigor ?? null,
          frequency: profile.frequency ?? 3,
          frequencyUnit: profile.frequencyUnit ?? 'week',
          levelObjective: profile.levelObjective ?? '',
          learningLocale: selectedLocale,
        },
        true
      );
      const refreshed = await getUserProfile();
      setProfile(refreshed);
      if (refreshed.learningLocale) {
        setLearningLocale(refreshed.learningLocale);
      } else {
        setLearningLocale(selectedLocale);
      }
      toast.success(t('app.settings.toast.saved'));
    } catch (error) {
      console.error('Failed to save settings:', error);
      toast.error(t('app.settings.toast.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handlePasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError(t('app.settings.password.error.required'));
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError(t('app.settings.password.error.tooShort'));
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError(t('app.settings.password.error.mismatch'));
      return;
    }

    setIsChangingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success(t('app.settings.password.toast.changed'));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('app.settings.password.toast.changeError');
      setPasswordError(message);
      toast.error(message);
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handlePasswordReset = async () => {
    setPasswordError(null);

    if (!user?.email) {
      setPasswordError(t('app.settings.password.error.noEmail'));
      return;
    }

    setIsSendingReset(true);
    try {
      await sendPasswordReset(user.email);
      toast.success(t('app.settings.password.toast.resetSent'));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('app.settings.password.toast.resetError');
      setPasswordError(message);
      toast.error(message);
    } finally {
      setIsSendingReset(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border-3 border-foreground bg-primary text-primary-foreground shadow-stamp-sm">
          <Settings size={24} strokeWidth={2.5} />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
            {t('nav.settings')}
          </p>
          <h1 className="text-3xl font-display font-bold text-foreground">
            {t('app.settings.title')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('app.settings.account.subtitle')}
          </p>
        </div>
      </header>

      <Tabs.Root defaultValue="account" className="flex flex-col gap-6 md:flex-row">
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
                'group flex min-h-11 items-center space-x-3 rounded-xl border-2 px-4 text-left transition-all',
                'data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-foreground data-[state=active]:shadow-stamp',
                'text-muted-foreground hover:text-foreground hover:bg-secondary border-transparent data-[state=inactive]:hover:border-border'
              )}
            >
              <tab.icon size={18} strokeWidth={2.5} className="opacity-70 group-data-[state=active]:opacity-100" />
              <span className="font-bold">{tab.label}</span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* Content Panel */}
        <div className="flex-1 min-h-[500px] rounded-2xl border-3 border-foreground bg-card p-6 shadow-stamp">
          {/* Account Tab */}
          <Tabs.Content
            value="account"
            className="space-y-6 outline-none animate-in fade-in slide-in-from-right-4 duration-300"
          >
            <div>
              <h2 className="mb-2 text-lg font-display font-bold text-foreground">
                {t('app.settings.account.title')}
              </h2>
              <p className="text-muted-foreground text-sm">
                {t('app.settings.account.subtitle')}
              </p>
            </div>

            <div className="grid gap-6">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label htmlFor="settings-first-name" className="text-sm font-bold text-foreground">
                    {t('app.settings.account.firstName')}
                  </label>
                  <input
                    id="settings-first-name"
                    type="text"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    placeholder={t('app.settings.account.firstNamePlaceholder')}
                    disabled={isLoading}
                    className="w-full px-4 py-3 rounded-xl border-2 border-border bg-card text-foreground font-medium placeholder:text-muted-foreground focus:border-primary focus:outline-none transition-all disabled:bg-secondary disabled:text-muted-foreground"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="settings-last-name" className="text-sm font-bold text-foreground">
                    {t('app.settings.account.lastName')}
                  </label>
                  <input
                    id="settings-last-name"
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
                <label htmlFor="settings-email" className="text-sm font-bold text-foreground">
                  {t('app.settings.account.email')}
                </label>
                <input
                  id="settings-email"
                  type="email"
                  value={user?.email || ''}
                  readOnly
                  disabled
                  className="w-full px-4 py-3 rounded-xl border-2 border-border bg-secondary text-muted-foreground font-medium outline-none"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="settings-learning-locale" className="text-sm font-bold text-foreground">
                  {t('app.settings.learningLocale.label')}
                </label>
                <select
                  id="settings-learning-locale"
                  value={selectedLocale}
                  onChange={(event) => setSelectedLocale(event.target.value as LearningLocale)}
                  disabled={isLoading}
                  className="h-11 w-full rounded-xl border-2 border-border bg-card px-4 text-foreground font-medium focus:border-primary focus:outline-none transition-all disabled:bg-secondary disabled:text-muted-foreground"
                >
                  {LEARNING_LOCALES.map((locale) => (
                    <option key={locale.value} value={locale.value}>
                      {locale.flag} {locale.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {t('app.settings.learningLocale.subtitle')}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-foreground">
                  {t('app.settings.ageRangeLabel')}
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {AGE_RANGES.map((range) => (
                    <Button
                      key={range.midpoint}
                      variant="option"
                      selected={ageToRangeLabel(selectedAge) === range.label}
                      aria-pressed={ageToRangeLabel(selectedAge) === range.label}
                      disabled={isLoading}
                      onClick={() => setSelectedAge(range.midpoint)}
                      className="text-sm"
                    >
                      {t(range.i18nKey)}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="pt-4 flex justify-end">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isLoading || isSaving}
                  className="min-h-11 rounded-xl border-2 border-foreground bg-primary px-6 text-primary-foreground font-bold shadow-stamp transition-all hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_var(--foreground)] active:translate-y-0.5 active:shadow-[2px_2px_0_0_var(--foreground)] disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none disabled:hover:translate-y-0"
                >
                  {isSaving ? t('app.settings.account.saving') : t('app.settings.account.save')}
                </button>
              </div>
            </div>
          </Tabs.Content>

          {/* Notifications Tab */}
          <Tabs.Content
            value="notifications"
            className="space-y-6 outline-none animate-in fade-in slide-in-from-right-4 duration-300"
          >
            <div>
              <h2 className="mb-2 text-lg font-display font-bold text-foreground">
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
                    <input
                      type="checkbox"
                      defaultChecked={setting.default}
                      className="sr-only peer"
                      aria-label={t(setting.labelKey)}
                    />
                    <div className="w-12 h-7 bg-secondary border-2 border-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-5 peer-checked:after:border-foreground after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-card after:border-2 after:border-border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-checked:border-foreground"></div>
                  </label>
                </div>
              ))}
            </div>
          </Tabs.Content>

          {/* Privacy Tab */}
          <Tabs.Content
            value="privacy"
            className="space-y-6 outline-none animate-in fade-in slide-in-from-right-4 duration-300"
          >
            <div>
              <h2 className="mb-2 text-lg font-display font-bold text-foreground">
                {t('app.settings.privacy.title')}
              </h2>
              <p className="text-muted-foreground text-sm">{t('app.settings.privacy.subtitle')}</p>
            </div>

            <div className="space-y-6">
              <div className="p-4 bg-accent/10 border-2 border-accent/30 rounded-xl text-foreground text-sm">
                {t('app.settings.privacy.notice')}
              </div>

              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => navigate('/app/consent/voice')}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border-2 border-border p-4 text-left transition-colors hover:border-foreground"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-border bg-primary/10 text-primary">
                      <Mic size={18} strokeWidth={2.5} />
                    </div>
                    <div>
                      <div className="font-bold text-foreground">Voice practice consent</div>
                      <div className="text-xs text-muted-foreground">
                        Manage whether your audio is sent to the AI tutor.
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {compliance ? (
                      <Badge
                        variant={
                          compliance.voiceConsentStatus === 'granted'
                            ? 'success'
                            : compliance.voiceConsentStatus === 'revoked'
                              ? 'destructive'
                              : 'outline'
                        }
                        size="sm"
                      >
                        {compliance.voiceConsentStatus}
                      </Badge>
                    ) : null}
                    <ChevronRight size={18} className="text-muted-foreground" />
                  </div>
                </button>

                <p className="text-sm text-muted-foreground">
                  <Link to="/compliance" className="underline">
                    See Lingual's full data policy
                  </Link>{' '}
                  for retention, who can see what, and how deletion works.
                </p>
              </div>

            </div>
          </Tabs.Content>

          {/* Password Tab */}
          <Tabs.Content
            value="password"
            className="space-y-6 outline-none animate-in fade-in slide-in-from-right-4 duration-300"
          >
            <div>
              <h2 className="mb-2 text-lg font-display font-bold text-foreground">
                {t('app.settings.password.title')}
              </h2>
              <p className="text-muted-foreground text-sm">
                {t('app.settings.password.subtitle')}
              </p>
            </div>

            {passwordError && (
              <Alert variant="destructive">
                <AlertCircle size={18} strokeWidth={2.5} />
                <AlertDescription>{passwordError}</AlertDescription>
              </Alert>
            )}

            <section className="rounded-2xl border-2 border-border bg-secondary/40 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-4">
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border-2 border-border bg-card text-primary">
                    <Mail size={20} strokeWidth={2.5} />
                  </div>
                  <div>
                    <h3 className="font-display text-base font-bold text-foreground">
                      {t('app.settings.password.resetTitle')}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('app.settings.password.resetSubtitle')}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-foreground">{user?.email}</p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  loading={isSendingReset}
                  disabled={!user?.email || isSendingReset}
                  onClick={handlePasswordReset}
                  className="w-full sm:w-auto"
                >
                  {t('app.settings.password.reset')}
                </Button>
              </div>
            </section>

            <form
              onSubmit={handlePasswordChange}
              className="space-y-5 rounded-2xl border-2 border-border p-5"
            >
              <div className="flex gap-4">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border-2 border-border bg-primary/10 text-primary">
                  <KeyRound size={20} strokeWidth={2.5} />
                </div>
                <div>
                  <h3 className="font-display text-base font-bold text-foreground">
                    {t('app.settings.password.changeTitle')}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('app.settings.password.changeSubtitle')}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="settings-current-password" className="text-sm font-bold text-foreground">
                  {t('app.settings.password.current')}
                </label>
                <input
                  id="settings-current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  className="w-full px-4 py-3 rounded-xl border-2 border-border bg-card text-foreground font-medium placeholder:text-muted-foreground focus:border-primary focus:outline-none transition-all"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="settings-new-password" className="text-sm font-bold text-foreground">
                    {t('app.settings.password.new')}
                  </label>
                  <input
                    id="settings-new-password"
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={6}
                    className="w-full px-4 py-3 rounded-xl border-2 border-border bg-card text-foreground font-medium placeholder:text-muted-foreground focus:border-primary focus:outline-none transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="settings-confirm-password" className="text-sm font-bold text-foreground">
                    {t('app.settings.password.confirm')}
                  </label>
                  <input
                    id="settings-confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={6}
                    className="w-full px-4 py-3 rounded-xl border-2 border-border bg-card text-foreground font-medium placeholder:text-muted-foreground focus:border-primary focus:outline-none transition-all"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button type="submit" loading={isChangingPassword} disabled={isChangingPassword}>
                  {t('app.settings.password.change')}
                </Button>
              </div>
            </form>
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
