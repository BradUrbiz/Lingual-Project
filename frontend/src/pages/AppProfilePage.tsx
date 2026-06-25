import { useEffect, useReducer, useRef } from 'react';
import type { ChangeEvent, RefObject } from 'react';
import { Camera, CircleUserRound, Globe, MapPin, School } from 'lucide-react';
import { toast } from 'sonner';
import { getMinigameSummary } from '@/api/minigames';
import { getUserProfile, updateProfile } from '@/api/user';
import { Button, Input } from '@/components/ui';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { DEFAULT_LEARNING_LOCALE, LEARNING_LOCALES } from '@/lib/learningLocales';
import {
  PROFILE_COUNTRIES,
  PROFILE_GRADE_OPTIONS,
  PROFILE_LANGUAGES,
} from '@/lib/profileOptions';
import type { Language, LearningLocale, MinigameSummary, UserProfile } from '@/types';

type PracticeLevelBand = {
  minMinutes: number;
  maxMinutes: number;
  labelEn: string;
  labelKo: string;
  barClassName: string;
};

const PRACTICE_LEVEL_BANDS: PracticeLevelBand[] = [
  {
    minMinutes: 0,
    maxMinutes: 30,
    labelEn: 'Starter',
    labelKo: '입문',
    barClassName: 'bg-[var(--color-chart-4)]',
  },
  {
    minMinutes: 30,
    maxMinutes: 120,
    labelEn: 'Explorer',
    labelKo: '탐색',
    barClassName: 'bg-primary',
  },
  {
    minMinutes: 120,
    maxMinutes: 300,
    labelEn: 'Builder',
    labelKo: '성장',
    barClassName: 'bg-accent',
  },
  {
    minMinutes: 300,
    maxMinutes: 600,
    labelEn: 'Conversational',
    labelKo: '대화',
    barClassName: 'bg-success',
  },
  {
    minMinutes: 600,
    maxMinutes: Number.POSITIVE_INFINITY,
    labelEn: 'Immersed',
    labelKo: '몰입',
    barClassName: 'bg-foreground',
  },
];

const PRACTICE_TIME_FORMATTERS = {
  en: new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }),
  ko: new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }),
};

const isLearningLocale = (value: string): value is LearningLocale =>
  LEARNING_LOCALES.some((option) => option.value === value);

const getPracticeLevelBand = (minutes: number) =>
  PRACTICE_LEVEL_BANDS.find(
    (band) => minutes >= band.minMinutes && minutes < band.maxMinutes
  ) ?? PRACTICE_LEVEL_BANDS[PRACTICE_LEVEL_BANDS.length - 1];

const getPracticeLevelLabel = (minutes: number, lang: Language) => {
  const band = getPracticeLevelBand(minutes);
  return lang === 'ko' ? band.labelKo : band.labelEn;
};

const getPracticeLevelProgress = (minutes: number) => {
  const band = getPracticeLevelBand(minutes);
  if (!Number.isFinite(band.maxMinutes)) return 100;
  const span = band.maxMinutes - band.minMinutes;
  if (span <= 0) return 100;
  return Math.min(100, Math.max(8, ((minutes - band.minMinutes) / span) * 100));
};

const formatPracticeTime = (durationSeconds: number, lang: Language) => {
  const totalMinutes = Math.max(0, Math.round(durationSeconds / 60));
  const formatter = lang === 'ko' ? PRACTICE_TIME_FORMATTERS.ko : PRACTICE_TIME_FORMATTERS.en;

  if (totalMinutes >= 60) {
    const totalHours = totalMinutes / 60;
    return lang === 'ko'
      ? `${formatter.format(totalHours)}시간 연습`
      : `${formatter.format(totalHours)} hrs practiced`;
  }

  return lang === 'ko'
    ? `${formatter.format(totalMinutes)}분 연습`
    : `${formatter.format(totalMinutes)} min practiced`;
};

type ProfileFormState = {
  displayName: string;
  contactEmail: string;
  gradeLevel: string;
  nativeLanguage: string;
  location: string;
  schoolName: string;
  avatarUrl: string;
};

type ProfileFormField = keyof ProfileFormState;

type AppProfileState = {
  profile: UserProfile | null;
  minigameSummary: MinigameSummary | null;
  isLoading: boolean;
  isSaving: boolean;
  formState: ProfileFormState;
};

type AppProfileAction =
  | {
      type: 'profile:loaded';
      profile: UserProfile;
      minigameSummary: MinigameSummary | null;
      formState: ProfileFormState;
    }
  | { type: 'profile:loadFailed' }
  | { type: 'form:fieldChanged'; field: ProfileFormField; value: string }
  | { type: 'save:started' }
  | { type: 'save:succeeded'; profile: UserProfile; formState: ProfileFormState }
  | { type: 'save:failed' };

const EMPTY_PROFILE_FORM: ProfileFormState = {
  displayName: '',
  contactEmail: '',
  gradeLevel: '',
  nativeLanguage: '',
  location: '',
  schoolName: '',
  avatarUrl: '',
};

const INITIAL_PROFILE_STATE: AppProfileState = {
  profile: null,
  minigameSummary: null,
  isLoading: true,
  isSaving: false,
  formState: EMPTY_PROFILE_FORM,
};

function createProfileFormState(
  profile: UserProfile,
  userName?: string | null,
  userEmail?: string | null,
): ProfileFormState {
  return {
    displayName: profile.displayName || userName || '',
    contactEmail: profile.contactEmail || userEmail || '',
    gradeLevel: profile.gradeLevel || '',
    nativeLanguage: profile.nativeLanguage || '',
    location: profile.location || '',
    schoolName: profile.schoolName || '',
    avatarUrl: profile.avatarUrl || '',
  };
}

function appProfileReducer(state: AppProfileState, action: AppProfileAction): AppProfileState {
  switch (action.type) {
    case 'profile:loaded':
      return {
        ...state,
        profile: action.profile,
        minigameSummary: action.minigameSummary,
        formState: action.formState,
        isLoading: false,
      };
    case 'profile:loadFailed':
      return {
        ...state,
        isLoading: false,
      };
    case 'form:fieldChanged':
      return {
        ...state,
        formState: {
          ...state.formState,
          [action.field]: action.value,
        },
      };
    case 'save:started':
      return {
        ...state,
        isSaving: true,
      };
    case 'save:succeeded':
      return {
        ...state,
        profile: action.profile,
        formState: action.formState,
        isSaving: false,
      };
    case 'save:failed':
      return {
        ...state,
        isSaving: false,
      };
    default:
      return state;
  }
}

export function AppProfilePage() {
  const { lang, t } = useLanguage();
  const { user, updateAvatarUrl } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [state, dispatch] = useReducer(appProfileReducer, INITIAL_PROFILE_STATE);

  useEffect(() => {
    let isActive = true;

    const loadProfile = async () => {
      try {
        const [profileResult, summaryResult] = await Promise.allSettled([
          getUserProfile(),
          getMinigameSummary(),
        ]);

        if (!isActive) return;

        if (profileResult.status !== 'fulfilled') {
          throw profileResult.reason;
        }

        if (summaryResult.status !== 'fulfilled') {
          console.error('Failed to load minigame summary:', summaryResult.reason);
        }

        const profile = profileResult.value;
        dispatch({
          type: 'profile:loaded',
          profile,
          minigameSummary: summaryResult.status === 'fulfilled' ? summaryResult.value : null,
          formState: createProfileFormState(profile, user?.name, user?.email),
        });
      } catch (error) {
        console.error('Failed to load profile:', error);
        toast.error(t('app.profile.toast.loadError') || 'Failed to load profile.');
        if (isActive) dispatch({ type: 'profile:loadFailed' });
      }
    };

    loadProfile();
    return () => {
      isActive = false;
    };
  }, [t, user?.email, user?.name]);

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error(t('app.profile.toast.avatarType') || 'Please select an image file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (result) {
        dispatch({ type: 'form:fieldChanged', field: 'avatarUrl', value: result });
      }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const handleFieldChange = (field: ProfileFormField, value: string) => {
    dispatch({ type: 'form:fieldChanged', field, value });
  };

  const handleSave = async () => {
    const { profile, formState } = state;
    if (!profile) return;
    dispatch({ type: 'save:started' });

    try {
      await updateProfile(
        {
          displayName: formState.displayName,
          age: profile.age ?? null,
          gender: profile.gender ?? null,
          rigor: profile.rigor ?? null,
          frequency: profile.frequency ?? 3,
          frequencyUnit: profile.frequencyUnit ?? 'week',
          levelObjective: profile.levelObjective ?? '',
          learningLocale: profile.learningLocale,
          avatarUrl: formState.avatarUrl,
          contactEmail: formState.contactEmail,
          gradeLevel: formState.gradeLevel,
          nativeLanguage: formState.nativeLanguage,
          location: formState.location,
          schoolName: formState.schoolName,
        },
        true
      );

      const refreshed = await getUserProfile();
      dispatch({
        type: 'save:succeeded',
        profile: refreshed,
        formState: createProfileFormState(refreshed, user?.name, user?.email),
      });
      if (refreshed.avatarUrl) updateAvatarUrl(refreshed.avatarUrl);
      toast.success(t('app.profile.toast.saved') || 'Profile updated.');
    } catch (error) {
      console.error('Failed to save profile:', error);
      toast.error(t('app.profile.toast.saveError') || 'Failed to update profile.');
      dispatch({ type: 'save:failed' });
    }
  };

  const { profile, formState, minigameSummary, isLoading, isSaving } = state;
  const avatarSrc = formState.avatarUrl || '';
  const inputsDisabled = isLoading || !profile || isSaving;
  const studentLabel = t('app.profile.student') || 'Student';
  const gradeSummary = formState.gradeLevel ? `${formState.gradeLevel}` : studentLabel;
  const activeLearningLocale = profile?.learningLocale || DEFAULT_LEARNING_LOCALE;
  const durationByLocale = minigameSummary?.durationSecondsByLocale ?? {};
  const languageRows = buildLanguageRows(activeLearningLocale, durationByLocale, lang);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ProfilePageHeader studentLabel={studentLabel} title={t('app.profile.title')} />

      <div className="grid gap-6 md:grid-cols-3">
        <ProfileSummaryColumn
          avatarSrc={avatarSrc}
          fileInputRef={fileInputRef}
          formState={formState}
          gradeSummary={gradeSummary}
          inputsDisabled={inputsDisabled}
          languageRows={languageRows}
          t={t}
          onAvatarChange={handleAvatarChange}
          onAvatarClick={handleAvatarClick}
        />

        <PersonalInfoSection
          formState={formState}
          inputsDisabled={inputsDisabled}
          isSaving={isSaving}
          t={t}
          onFieldChange={handleFieldChange}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}

type TranslationFn = (key: string) => string;

type LanguageRow = {
  locale: string;
  durationSeconds: number;
  isActive: boolean;
  label: string;
  flag: string;
  levelLabel: string;
  progressPercent: number;
  progressClassName: string;
  practiceTimeLabel: string;
};

function buildLanguageRows(
  activeLearningLocale: LearningLocale,
  durationByLocale: Record<string, number>,
  lang: Language,
): LanguageRow[] {
  return Array.from(
    new Set([
      activeLearningLocale,
      ...Object.keys(durationByLocale).filter(isLearningLocale),
    ])
  )
    .map((locale) => {
      const localeOption =
        LEARNING_LOCALES.find((option) => option.value === locale) ??
        LEARNING_LOCALES.find((option) => option.value === DEFAULT_LEARNING_LOCALE);
      const durationSeconds = Math.max(0, durationByLocale[locale] ?? 0);
      const practiceMinutes = Math.round(durationSeconds / 60);
      const practiceLevel = getPracticeLevelBand(practiceMinutes);

      return {
        locale,
        durationSeconds,
        isActive: locale === activeLearningLocale,
        label: localeOption?.shortLabel ?? locale,
        flag: localeOption?.flag ?? '🌐',
        levelLabel: getPracticeLevelLabel(practiceMinutes, lang),
        progressPercent: getPracticeLevelProgress(practiceMinutes),
        progressClassName: practiceLevel.barClassName,
        practiceTimeLabel: formatPracticeTime(durationSeconds, lang),
      };
    })
    .sort((left, right) => {
      if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
      return right.durationSeconds - left.durationSeconds;
    });
}

function ProfilePageHeader({ studentLabel, title }: { studentLabel: string; title: string }) {
  return (
    <header className="space-y-1">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
        {studentLabel}
      </p>
      <h1 className="text-3xl font-display font-bold text-foreground">{title}</h1>
    </header>
  );
}

type ProfileSummaryColumnProps = {
  avatarSrc: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  formState: ProfileFormState;
  gradeSummary: string;
  inputsDisabled: boolean;
  languageRows: LanguageRow[];
  t: TranslationFn;
  onAvatarChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onAvatarClick: () => void;
};

function ProfileSummaryColumn({
  avatarSrc,
  fileInputRef,
  formState,
  gradeSummary,
  inputsDisabled,
  languageRows,
  t,
  onAvatarChange,
  onAvatarClick,
}: ProfileSummaryColumnProps) {
  return (
    <div className="space-y-6 md:col-span-1">
      <section className="rounded-2xl border-3 border-foreground bg-card p-6 text-center shadow-stamp">
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {t('app.profile.photo') || 'Profile photo'}
        </p>
        <div className="relative mx-auto mb-4 inline-block">
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt={t('app.profile.photo') || 'Profile'}
              className="size-32 rounded-2xl border-3 border-foreground bg-secondary object-cover shadow-stamp-sm"
            />
          ) : (
            <div className="flex size-32 items-center justify-center rounded-2xl border-3 border-foreground bg-secondary text-muted-foreground shadow-stamp-sm">
              <CircleUserRound className="size-16" strokeWidth={1.75} />
            </div>
          )}
          <button
            type="button"
            onClick={onAvatarClick}
            className="absolute -bottom-1 -right-1 flex size-10 items-center justify-center rounded-xl border-2 border-foreground bg-primary text-primary-foreground shadow-stamp-sm transition-colors hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed"
            aria-label={t('app.profile.changePhoto') || 'Change profile photo'}
            disabled={inputsDisabled}
          >
            <Camera size={16} strokeWidth={2.5} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            aria-label={t('app.profile.changePhoto') || 'Change profile photo'}
            onChange={onAvatarChange}
          />
        </div>

        <h2 className="text-xl font-display font-bold text-foreground">
          {formState.displayName || 'User'}
        </h2>
        <p className="mt-1 text-sm font-medium text-muted-foreground">{gradeSummary}</p>

        <div className="mt-5 space-y-2 text-sm">
          <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-1.5 text-muted-foreground">
            <MapPin size={14} />
            <span>{formState.location || t('app.profile.location') || 'Location'}</span>
          </div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-1.5 text-muted-foreground">
            <School size={14} />
            <span>{formState.schoolName || t('app.profile.school') || 'School'}</span>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border-3 border-foreground bg-card p-6 shadow-stamp">
        <h3 className="mb-4 flex items-center gap-2 text-lg font-display font-bold text-foreground">
          <Globe size={18} className="text-primary" strokeWidth={2.5} />
          {t('app.profile.languages')}
        </h3>
        <div className="space-y-4">
          {languageRows.map((language) => (
            <LanguageProgressCard key={language.locale} language={language} t={t} />
          ))}
        </div>
      </section>
    </div>
  );
}

function LanguageProgressCard({
  language,
  t,
}: {
  language: LanguageRow;
  t: TranslationFn;
}) {
  return (
    <div className="rounded-xl border-2 border-border bg-secondary/60 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base" aria-hidden="true">
              {language.flag}
            </span>
            <span className="font-semibold text-foreground">{language.label}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {language.practiceTimeLabel}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('app.profile.level')}
          </p>
          <p className="text-sm font-bold text-foreground">{language.levelLabel}</p>
        </div>
      </div>
      <div className="h-2.5 rounded-full bg-background">
        <div
          className={`h-full rounded-full ${language.progressClassName}`}
          style={{ width: `${language.progressPercent}%` }}
        />
      </div>
    </div>
  );
}

type PersonalInfoSectionProps = {
  formState: ProfileFormState;
  inputsDisabled: boolean;
  isSaving: boolean;
  t: TranslationFn;
  onFieldChange: (field: ProfileFormField, value: string) => void;
  onSave: () => void;
};

function PersonalInfoSection({
  formState,
  inputsDisabled,
  isSaving,
  t,
  onFieldChange,
  onSave,
}: PersonalInfoSectionProps) {
  return (
    <div className="space-y-6 md:col-span-2">
      <section className="rounded-2xl border-3 border-foreground bg-card p-6 shadow-stamp">
        <div className="mb-5 flex flex-col gap-3 border-b-2 border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-xl font-display font-bold text-foreground">
            {t('app.profile.personalInfo')}
          </h3>
          <Button
            type="button"
            onClick={onSave}
            disabled={inputsDisabled}
            className="min-w-[138px]"
          >
            {isSaving
              ? t('app.profile.saving') || 'Saving...'
              : t('app.profile.save') || 'Save Changes'}
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={t('app.profile.fullName')}
            type="text"
            value={formState.displayName}
            onChange={(event) => onFieldChange('displayName', event.target.value)}
            placeholder={t('app.profile.fullName') || 'Full Name'}
            disabled={inputsDisabled}
          />

          <Input
            label={t('app.profile.email')}
            type="email"
            value={formState.contactEmail}
            onChange={(event) => onFieldChange('contactEmail', event.target.value)}
            placeholder={t('app.profile.email') || 'Email Address'}
            disabled={inputsDisabled}
          />

          <ProfileSelect
            label={t('app.profile.student') || 'Education Level'}
            value={formState.gradeLevel}
            placeholder={t('app.profile.selectGradeLevel') || 'Select Education Level'}
            disabled={inputsDisabled}
            options={PROFILE_GRADE_OPTIONS}
            onChange={(value) => onFieldChange('gradeLevel', value)}
          />

          <ProfileSelect
            label={t('app.profile.nativeLanguage') || 'Native Language'}
            value={formState.nativeLanguage}
            placeholder={t('app.profile.selectNativeLanguage') || 'Select Native Language'}
            disabled={inputsDisabled}
            options={PROFILE_LANGUAGES}
            onChange={(value) => onFieldChange('nativeLanguage', value)}
          />

          <ProfileSelect
            label={t('app.profile.location') || 'Location'}
            value={formState.location}
            placeholder={t('app.profile.selectCountry') || 'Select Country'}
            disabled={inputsDisabled}
            options={PROFILE_COUNTRIES}
            onChange={(value) => onFieldChange('location', value)}
          />

          <Input
            label={t('app.profile.school')}
            type="text"
            value={formState.schoolName}
            onChange={(event) => onFieldChange('schoolName', event.target.value)}
            placeholder={t('app.profile.school') || 'School'}
            disabled={inputsDisabled}
          />
        </div>
      </section>
    </div>
  );
}

type ProfileSelectProps = {
  disabled: boolean;
  label: string;
  options: string[];
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
};

function ProfileSelect({
  disabled,
  label,
  options,
  placeholder,
  value,
  onChange,
}: ProfileSelectProps) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-base font-medium">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="h-11 rounded-xl border-2 border-border bg-background px-3 text-sm focus:border-primary focus:outline-none"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
