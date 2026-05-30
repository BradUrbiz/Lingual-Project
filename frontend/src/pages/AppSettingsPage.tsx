import { FormEvent, useEffect, useReducer, useRef } from 'react';
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

const NOTIFICATION_SETTINGS = [
  { labelKey: 'app.settings.notifications.email.title', descKey: 'app.settings.notifications.email.desc', default: true },
  { labelKey: 'app.settings.notifications.reminders.title', descKey: 'app.settings.notifications.reminders.desc', default: true },
  { labelKey: 'app.settings.notifications.teacher.title', descKey: 'app.settings.notifications.teacher.desc', default: true },
  { labelKey: 'app.settings.notifications.updates.title', descKey: 'app.settings.notifications.updates.desc', default: false },
];

type SettingsState = {
  firstName: string;
  lastName: string;
  selectedLocale: LearningLocale;
  selectedAge: number | null;
  compliance: StudentComplianceRecord | null;
  isLoading: boolean;
  isSaving: boolean;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  passwordError: string | null;
  isChangingPassword: boolean;
  isSendingReset: boolean;
};

type SettingsTextField = 'firstName' | 'lastName' | 'currentPassword' | 'newPassword' | 'confirmPassword';

type SettingsAction =
  | {
      type: 'profile:loaded';
      firstName: string;
      lastName: string;
      selectedLocale: LearningLocale;
      selectedAge: number | null;
    }
  | { type: 'profile:loadFailed' }
  | { type: 'compliance:set'; compliance: StudentComplianceRecord | null }
  | { type: 'field:set'; field: SettingsTextField; value: string }
  | { type: 'locale:set'; selectedLocale: LearningLocale }
  | { type: 'age:set'; selectedAge: number | null }
  | { type: 'save:started' }
  | { type: 'save:finished' }
  | { type: 'password:errorSet'; message: string | null }
  | { type: 'password:changeStarted' }
  | { type: 'password:changeSucceeded' }
  | { type: 'password:changeFailed'; message: string }
  | { type: 'password:resetStarted' }
  | { type: 'password:resetFinished' };

function createInitialSettingsState(learningLocale: LearningLocale): SettingsState {
  return {
    firstName: '',
    lastName: '',
    selectedLocale: learningLocale,
    selectedAge: null,
    compliance: null,
    isLoading: true,
    isSaving: false,
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    passwordError: null,
    isChangingPassword: false,
    isSendingReset: false,
  };
}

function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
  switch (action.type) {
    case 'profile:loaded':
      return {
        ...state,
        firstName: action.firstName,
        lastName: action.lastName,
        selectedLocale: action.selectedLocale,
        selectedAge: action.selectedAge,
        isLoading: false,
      };
    case 'profile:loadFailed':
      return {
        ...state,
        isLoading: false,
      };
    case 'compliance:set':
      return {
        ...state,
        compliance: action.compliance,
      };
    case 'field:set':
      return {
        ...state,
        [action.field]: action.value,
      };
    case 'locale:set':
      return {
        ...state,
        selectedLocale: action.selectedLocale,
      };
    case 'age:set':
      return {
        ...state,
        selectedAge: action.selectedAge,
      };
    case 'save:started':
      return {
        ...state,
        isSaving: true,
      };
    case 'save:finished':
      return {
        ...state,
        isSaving: false,
      };
    case 'password:errorSet':
      return {
        ...state,
        passwordError: action.message,
      };
    case 'password:changeStarted':
      return {
        ...state,
        passwordError: null,
        isChangingPassword: true,
      };
    case 'password:changeSucceeded':
      return {
        ...state,
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
        passwordError: null,
        isChangingPassword: false,
      };
    case 'password:changeFailed':
      return {
        ...state,
        passwordError: action.message,
        isChangingPassword: false,
      };
    case 'password:resetStarted':
      return {
        ...state,
        passwordError: null,
        isSendingReset: true,
      };
    case 'password:resetFinished':
      return {
        ...state,
        isSendingReset: false,
      };
    default:
      return state;
  }
}

export function AppSettingsPage() {
  const { t } = useLanguage();
  const { user, changePassword, sendPasswordReset } = useAuth();
  const navigate = useNavigate();
  const { learningLocale, setLearningLocale } = useLearningLocale();
  const profileRef = useRef<UserProfile | null>(null);
  const [state, dispatch] = useReducer(settingsReducer, learningLocale, createInitialSettingsState);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const data = await getUserProfile();
        profileRef.current = data;
        const nameSource = data.displayName || user?.name || '';
        const parts = nameSource.trim().split(/\s+/).filter(Boolean);
        dispatch({
          type: 'profile:loaded',
          firstName: parts[0] || '',
          lastName: parts.slice(1).join(' '),
          selectedLocale: data.learningLocale || learningLocale || DEFAULT_LEARNING_LOCALE,
          selectedAge: data.age ?? null,
        });
      } catch (error) {
        console.error('Failed to load profile:', error);
        toast.error(t('app.settings.toast.loadError'));
        dispatch({ type: 'profile:loadFailed' });
      }
    };

    loadProfile();
  }, [user?.name, t, learningLocale]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const record = await getStudentCompliance();
        if (active) {
          dispatch({ type: 'compliance:set', compliance: record });
        }
      } catch (err) {
        // Silent: students not in a school org get 400 here. Fine to skip.
        if (active) {
          dispatch({ type: 'compliance:set', compliance: null });
        }
        console.debug('compliance fetch skipped:', err);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleSave = async () => {
    const profile = profileRef.current;
    if (!profile) return;
    dispatch({ type: 'save:started' });
    try {
      const displayName = [state.firstName, state.lastName].filter(Boolean).join(' ').trim();
      await updateProfile(
        {
          displayName: displayName || profile.displayName || '',
          age: state.selectedAge ?? null,
          gender: profile.gender ?? null,
          rigor: profile.rigor ?? null,
          frequency: profile.frequency ?? 3,
          frequencyUnit: profile.frequencyUnit ?? 'week',
          levelObjective: profile.levelObjective ?? '',
          learningLocale: state.selectedLocale,
        },
        true
      );
      const refreshed = await getUserProfile();
      profileRef.current = refreshed;
      if (refreshed.learningLocale) {
        setLearningLocale(refreshed.learningLocale);
      } else {
        setLearningLocale(state.selectedLocale);
      }
      toast.success(t('app.settings.toast.saved'));
    } catch (error) {
      console.error('Failed to save settings:', error);
      toast.error(t('app.settings.toast.saveError'));
    } finally {
      dispatch({ type: 'save:finished' });
    }
  };

  const handlePasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    dispatch({ type: 'password:errorSet', message: null });

    if (!state.currentPassword || !state.newPassword || !state.confirmPassword) {
      dispatch({ type: 'password:errorSet', message: t('app.settings.password.error.required') });
      return;
    }

    if (state.newPassword.length < 6) {
      dispatch({ type: 'password:errorSet', message: t('app.settings.password.error.tooShort') });
      return;
    }

    if (state.newPassword !== state.confirmPassword) {
      dispatch({ type: 'password:errorSet', message: t('app.settings.password.error.mismatch') });
      return;
    }

    dispatch({ type: 'password:changeStarted' });
    try {
      await changePassword(state.currentPassword, state.newPassword);
      dispatch({ type: 'password:changeSucceeded' });
      toast.success(t('app.settings.password.toast.changed'));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('app.settings.password.toast.changeError');
      dispatch({ type: 'password:changeFailed', message });
      toast.error(message);
    }
  };

  const handlePasswordReset = async () => {
    dispatch({ type: 'password:errorSet', message: null });

    if (!user?.email) {
      dispatch({ type: 'password:errorSet', message: t('app.settings.password.error.noEmail') });
      return;
    }

    dispatch({ type: 'password:resetStarted' });
    try {
      await sendPasswordReset(user.email);
      toast.success(t('app.settings.password.toast.resetSent'));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('app.settings.password.toast.resetError');
      dispatch({ type: 'password:errorSet', message });
      toast.error(message);
    } finally {
      dispatch({ type: 'password:resetFinished' });
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <SettingsHeader t={t} />

      <Tabs.Root defaultValue="account" className="flex flex-col gap-6 md:flex-row">
        <SettingsTabList t={t} />

        <div className="flex-1 min-h-[500px] rounded-2xl border-3 border-foreground bg-card p-6 shadow-stamp">
          <AccountSettingsTab
            email={user?.email || ''}
            state={state}
            t={t}
            onAgeSelect={(selectedAge) => dispatch({ type: 'age:set', selectedAge })}
            onFieldChange={(field, value) => dispatch({ type: 'field:set', field, value })}
            onLocaleChange={(selectedLocale) => dispatch({ type: 'locale:set', selectedLocale })}
            onSave={handleSave}
          />

          <NotificationsSettingsTab t={t} />

          <PrivacySettingsTab
            compliance={state.compliance}
            onOpenVoiceConsent={() => navigate('/app/consent/voice')}
            t={t}
          />

          <PasswordSettingsTab
            email={user?.email}
            state={state}
            t={t}
            onFieldChange={(field, value) => dispatch({ type: 'field:set', field, value })}
            onPasswordChange={handlePasswordChange}
            onPasswordReset={handlePasswordReset}
          />

          <DevicesSettingsTab t={t} />
        </div>
      </Tabs.Root>
    </div>
  );
}

type TranslationFn = (key: string) => string;

function SettingsHeader({ t }: { t: TranslationFn }) {
  return (
    <header className="flex items-start gap-4">
      <div className="flex size-12 items-center justify-center rounded-xl border-3 border-foreground bg-primary text-primary-foreground shadow-stamp-sm">
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
  );
}

function SettingsTabList({ t }: { t: TranslationFn }) {
  const tabs = [
    { value: 'account', icon: User, label: t('app.settings.tabs.account') },
    { value: 'password', icon: Lock, label: t('app.settings.tabs.password') },
    { value: 'notifications', icon: Bell, label: t('app.settings.tabs.notifications') },
    { value: 'privacy', icon: Shield, label: t('app.settings.tabs.privacy') },
    { value: 'devices', icon: Smartphone, label: t('app.settings.tabs.devices') },
  ];

  return (
    <Tabs.List className="flex flex-col gap-y-2 md:w-64 flex-shrink-0">
      {tabs.map((tab) => (
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
  );
}

type AccountSettingsTabProps = {
  email: string;
  state: SettingsState;
  t: TranslationFn;
  onAgeSelect: (selectedAge: number | null) => void;
  onFieldChange: (field: SettingsTextField, value: string) => void;
  onLocaleChange: (selectedLocale: LearningLocale) => void;
  onSave: () => void;
};

function AccountSettingsTab({
  email,
  state,
  t,
  onAgeSelect,
  onFieldChange,
  onLocaleChange,
  onSave,
}: AccountSettingsTabProps) {
  return (
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
          <div className="gap-y-2">
            <label htmlFor="settings-first-name" className="text-sm font-bold text-foreground">
              {t('app.settings.account.firstName')}
            </label>
            <input
              id="settings-first-name"
              type="text"
              value={state.firstName}
              onChange={(event) => onFieldChange('firstName', event.target.value)}
              placeholder={t('app.settings.account.firstNamePlaceholder')}
              disabled={state.isLoading}
              className="w-full px-4 py-3 rounded-xl border-2 border-border bg-card text-foreground font-medium placeholder:text-muted-foreground focus:border-primary focus:outline-none transition-all disabled:bg-secondary disabled:text-muted-foreground"
            />
          </div>
          <div className="gap-y-2">
            <label htmlFor="settings-last-name" className="text-sm font-bold text-foreground">
              {t('app.settings.account.lastName')}
            </label>
            <input
              id="settings-last-name"
              type="text"
              value={state.lastName}
              onChange={(event) => onFieldChange('lastName', event.target.value)}
              placeholder={t('app.settings.account.lastNamePlaceholder')}
              disabled={state.isLoading}
              className="w-full px-4 py-3 rounded-xl border-2 border-border bg-card text-foreground font-medium placeholder:text-muted-foreground focus:border-primary focus:outline-none transition-all disabled:bg-secondary disabled:text-muted-foreground"
            />
          </div>
        </div>

        <div className="gap-y-2">
          <label htmlFor="settings-email" className="text-sm font-bold text-foreground">
            {t('app.settings.account.email')}
          </label>
          <input
            id="settings-email"
            type="email"
            value={email}
            readOnly
            disabled
            className="w-full px-4 py-3 rounded-xl border-2 border-border bg-secondary text-muted-foreground font-medium outline-none"
          />
        </div>

        <div className="gap-y-2">
          <label htmlFor="settings-learning-locale" className="text-sm font-bold text-foreground">
            {t('app.settings.learningLocale.label')}
          </label>
          <select
            id="settings-learning-locale"
            value={state.selectedLocale}
            onChange={(event) => onLocaleChange(event.target.value as LearningLocale)}
            disabled={state.isLoading}
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

        <div className="gap-y-2">
          <label className="text-sm font-bold text-foreground">
            {t('app.settings.ageRangeLabel')}
          </label>
          <div className="grid grid-cols-4 gap-2">
            {AGE_RANGES.map((range) => (
              <Button
                key={range.midpoint}
                variant="option"
                selected={ageToRangeLabel(state.selectedAge) === range.label}
                aria-pressed={ageToRangeLabel(state.selectedAge) === range.label}
                disabled={state.isLoading}
                onClick={() => onAgeSelect(range.midpoint)}
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
            onClick={onSave}
            disabled={state.isLoading || state.isSaving}
            className="min-h-11 rounded-xl border-2 border-foreground bg-primary px-6 text-primary-foreground font-bold shadow-stamp transition-all hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_var(--foreground)] active:translate-y-0.5 active:shadow-[2px_2px_0_0_var(--foreground)] disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none disabled:hover:translate-y-0"
          >
            {state.isSaving ? t('app.settings.account.saving') : t('app.settings.account.save')}
          </button>
        </div>
      </div>
    </Tabs.Content>
  );
}

function NotificationsSettingsTab({ t }: { t: TranslationFn }) {
  return (
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
        {NOTIFICATION_SETTINGS.map((setting) => (
          <div
            key={setting.labelKey}
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
  );
}

type PrivacySettingsTabProps = {
  compliance: StudentComplianceRecord | null;
  onOpenVoiceConsent: () => void;
  t: TranslationFn;
};

function PrivacySettingsTab({ compliance, onOpenVoiceConsent, t }: PrivacySettingsTabProps) {
  return (
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
            onClick={onOpenVoiceConsent}
            className="flex w-full items-center justify-between gap-3 rounded-xl border-2 border-border p-4 text-left transition-colors hover:border-foreground"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl border-2 border-border bg-primary/10 text-primary">
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
  );
}

type PasswordSettingsTabProps = {
  email?: string | null;
  state: SettingsState;
  t: TranslationFn;
  onFieldChange: (field: SettingsTextField, value: string) => void;
  onPasswordChange: (event: FormEvent<HTMLFormElement>) => void;
  onPasswordReset: () => void;
};

function PasswordSettingsTab({
  email,
  state,
  t,
  onFieldChange,
  onPasswordChange,
  onPasswordReset,
}: PasswordSettingsTabProps) {
  return (
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

      {state.passwordError && (
        <Alert variant="destructive">
          <AlertCircle size={18} strokeWidth={2.5} />
          <AlertDescription>{state.passwordError}</AlertDescription>
        </Alert>
      )}

      <section className="rounded-2xl border-2 border-border bg-secondary/40 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-4">
            <div className="flex size-11 flex-shrink-0 items-center justify-center rounded-xl border-2 border-border bg-card text-primary">
              <Mail size={20} strokeWidth={2.5} />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-foreground">
                {t('app.settings.password.resetTitle')}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('app.settings.password.resetSubtitle')}
              </p>
              <p className="mt-2 text-sm font-semibold text-foreground">{email}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            loading={state.isSendingReset}
            disabled={!email || state.isSendingReset}
            onClick={onPasswordReset}
            className="w-full sm:w-auto"
          >
            {t('app.settings.password.reset')}
          </Button>
        </div>
      </section>

      <form
        onSubmit={onPasswordChange}
        className="space-y-5 rounded-2xl border-2 border-border p-5"
      >
        <div className="flex gap-4">
          <div className="flex size-11 flex-shrink-0 items-center justify-center rounded-xl border-2 border-border bg-primary/10 text-primary">
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

        <div className="gap-y-2">
          <label htmlFor="settings-current-password" className="text-sm font-bold text-foreground">
            {t('app.settings.password.current')}
          </label>
          <input
            id="settings-current-password"
            type="password"
            value={state.currentPassword}
            onChange={(event) => onFieldChange('currentPassword', event.target.value)}
            autoComplete="current-password"
            className="w-full px-4 py-3 rounded-xl border-2 border-border bg-card text-foreground font-medium placeholder:text-muted-foreground focus:border-primary focus:outline-none transition-all"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="gap-y-2">
            <label htmlFor="settings-new-password" className="text-sm font-bold text-foreground">
              {t('app.settings.password.new')}
            </label>
            <input
              id="settings-new-password"
              type="password"
              value={state.newPassword}
              onChange={(event) => onFieldChange('newPassword', event.target.value)}
              autoComplete="new-password"
              minLength={6}
              className="w-full px-4 py-3 rounded-xl border-2 border-border bg-card text-foreground font-medium placeholder:text-muted-foreground focus:border-primary focus:outline-none transition-all"
            />
          </div>
          <div className="gap-y-2">
            <label htmlFor="settings-confirm-password" className="text-sm font-bold text-foreground">
              {t('app.settings.password.confirm')}
            </label>
            <input
              id="settings-confirm-password"
              type="password"
              value={state.confirmPassword}
              onChange={(event) => onFieldChange('confirmPassword', event.target.value)}
              autoComplete="new-password"
              minLength={6}
              className="w-full px-4 py-3 rounded-xl border-2 border-border bg-card text-foreground font-medium placeholder:text-muted-foreground focus:border-primary focus:outline-none transition-all"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" loading={state.isChangingPassword} disabled={state.isChangingPassword}>
            {t('app.settings.password.change')}
          </Button>
        </div>
      </form>
    </Tabs.Content>
  );
}

function DevicesSettingsTab({ t }: { t: TranslationFn }) {
  return (
    <Tabs.Content
      value="devices"
      className="outline-none animate-in fade-in slide-in-from-right-4 duration-300"
    >
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <div className="size-16 rounded-2xl bg-secondary border-2 border-border flex items-center justify-center mb-4">
          <Smartphone size={32} strokeWidth={2} />
        </div>
        <p className="font-medium">{t('app.settings.devices.placeholder')}</p>
      </div>
    </Tabs.Content>
  );
}
