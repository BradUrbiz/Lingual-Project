import { useEffect, useRef, useState } from 'react';
import { Camera, CircleUserRound, Globe, MapPin, School } from 'lucide-react';
import { toast } from 'sonner';
import { getMinigameSummary } from '@/api/minigames';
import { getUserProfile, updateProfile } from '@/api/user';
import { Button, Input } from '@/components/ui';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { DEFAULT_LEARNING_LOCALE, LEARNING_LOCALES } from '@/lib/learningLocales';
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
  const formatter = new Intl.NumberFormat(lang === 'ko' ? 'ko-KR' : 'en-US', {
    maximumFractionDigits: totalMinutes >= 60 ? 1 : 0,
  });

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

export function AppProfilePage() {
  const { lang, t } = useLanguage();
  const {
    user,
    updateAvatarUrl,
  } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [minigameSummary, setMinigameSummary] = useState<MinigameSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [formState, setFormState] = useState({
    displayName: '',
    contactEmail: '',
    gradeLevel: '',
    nativeLanguage: '',
    location: '',
    schoolName: '',
    avatarUrl: '',
  });

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

        const data = profileResult.value;
        setProfile(data);
        setFormState({
          displayName: data.displayName || user?.name || '',
          contactEmail: data.contactEmail || user?.email || '',
          gradeLevel: data.gradeLevel || '',
          nativeLanguage: data.nativeLanguage || '',
          location: data.location || '',
          schoolName: data.schoolName || '',
          avatarUrl: data.avatarUrl || '',
        });

        if (summaryResult.status === 'fulfilled') {
          setMinigameSummary(summaryResult.value);
        } else {
          console.error('Failed to load minigame summary:', summaryResult.reason);
        }
      } catch (error) {
        console.error('Failed to load profile:', error);
        toast.error(t('app.profile.toast.loadError') || 'Failed to load profile.');
      } finally {
        if (isActive) setIsLoading(false);
      }
    };

    loadProfile();
    return () => {
      isActive = false;
    };
  }, [t, user?.email, user?.name]);


const countries = [
  "Afghanistan",
  "Albania",
  "Algeria",
  "Andorra",
  "Angola",
  "Antigua and Barbuda",
  "Argentina",
  "Armenia",
  "Australia",
  "Austria",
  "Azerbaijan",
  "Bahamas",
  "Bahrain",
  "Bangladesh",
  "Barbados",
  "Belarus",
  "Belgium",
  "Belize",
  "Benin",
  "Bhutan",
  "Bolivia",
  "Bosnia and Herzegovina",
  "Botswana",
  "Brazil",
  "Brunei",
  "Bulgaria",
  "Burkina Faso",
  "Burundi",
  "Cabo Verde",
  "Cambodia",
  "Cameroon",
  "Canada",
  "Central African Republic",
  "Chad",
  "Chile",
  "China",
  "Colombia",
  "Comoros",
  "Congo",
  "Costa Rica",
  "Croatia",
  "Cuba",
  "Cyprus",
  "Czech Republic",
  "Democratic Republic of the Congo",
  "Denmark",
  "Djibouti",
  "Dominica",
  "Dominican Republic",
  "Ecuador",
  "Egypt",
  "El Salvador",
  "Equatorial Guinea",
  "Eritrea",
  "Estonia",
  "Eswatini",
  "Ethiopia",
  "Fiji",
  "Finland",
  "France",
  "Gabon",
  "Gambia",
  "Georgia",
  "Germany",
  "Ghana",
  "Greece",
  "Grenada",
  "Guatemala",
  "Guinea",
  "Guinea-Bissau",
  "Guyana",
  "Haiti",
  "Honduras",
  "Hungary",
  "Iceland",
  "India",
  "Indonesia",
  "Iran",
  "Iraq",
  "Ireland",
  "Israel",
  "Italy",
  "Jamaica",
  "Japan",
  "Jordan",
  "Kazakhstan",
  "Kenya",
  "Kiribati",
  "Kuwait",
  "Kyrgyzstan",
  "Laos",
  "Latvia",
  "Lebanon",
  "Lesotho",
  "Liberia",
  "Libya",
  "Liechtenstein",
  "Lithuania",
  "Luxembourg",
  "Madagascar",
  "Malawi",
  "Malaysia",
  "Maldives",
  "Mali",
  "Malta",
  "Marshall Islands",
  "Mauritania",
  "Mauritius",
  "Mexico",
  "Micronesia",
  "Moldova",
  "Monaco",
  "Mongolia",
  "Montenegro",
  "Morocco",
  "Mozambique",
  "Myanmar",
  "Namibia",
  "Nauru",
  "Nepal",
  "Netherlands",
  "New Zealand",
  "Nicaragua",
  "Niger",
  "Nigeria",
  "North Korea",
  "North Macedonia",
  "Norway",
  "Oman",
  "Pakistan",
  "Palau",
  "Palestine",
  "Panama",
  "Papua New Guinea",
  "Paraguay",
  "Peru",
  "Philippines",
  "Poland",
  "Portugal",
  "Qatar",
  "Romania",
  "Russia",
  "Rwanda",
  "Saint Kitts and Nevis",
  "Saint Lucia",
  "Saint Vincent and the Grenadines",
  "Samoa",
  "San Marino",
  "Sao Tome and Principe",
  "Saudi Arabia",
  "Senegal",
  "Serbia",
  "Seychelles",
  "Sierra Leone",
  "Singapore",
  "Slovakia",
  "Slovenia",
  "Solomon Islands",
  "Somalia",
  "South Africa",
  "South Korea",
  "South Sudan",
  "Spain",
  "Sri Lanka",
  "Sudan",
  "Suriname",
  "Sweden",
  "Switzerland",
  "Syria",
  "Taiwan",
  "Tajikistan",
  "Tanzania",
  "Thailand",
  "Timor-Leste",
  "Togo",
  "Tonga",
  "Trinidad and Tobago",
  "Tunisia",
  "Turkey",
  "Turkmenistan",
  "Tuvalu",
  "Uganda",
  "Ukraine",
  "United Arab Emirates",
  "United Kingdom",
  "United States",
  "Uruguay",
  "Uzbekistan",
  "Vanuatu",
  "Vatican City",
  "Venezuela",
  "Vietnam",
  "Yemen",
  "Zambia",
  "Zimbabwe",
].sort();

const languages = [
  "Afrikaans",
  "Albanian",
  "Amharic",
  "Arabic",
  "Armenian",
  "Azerbaijani",
  "Basque",
  "Belarusian",
  "Bengali",
  "Bosnian",
  "Bulgarian",
  "Burmese",
  "Catalan",
  "Cebuano",
  "Chinese (Cantonese)",
  "Chinese (Mandarin)",
  "Corsican",
  "Croatian",
  "Czech",
  "Danish",
  "Dutch",
  "English",
  "Esperanto",
  "Estonian",
  "Filipino",
  "Finnish",
  "French",
  "Frisian",
  "Galician",
  "Georgian",
  "German",
  "Greek",
  "Gujarati",
  "Haitian Creole",
  "Hausa",
  "Hawaiian",
  "Hebrew",
  "Hindi",
  "Hmong",
  "Hungarian",
  "Icelandic",
  "Igbo",
  "Indonesian",
  "Irish",
  "Italian",
  "Japanese",
  "Javanese",
  "Kannada",
  "Kazakh",
  "Khmer",
  "Kinyarwanda",
  "Korean",
  "Kurdish",
  "Kyrgyz",
  "Lao",
  "Latin",
  "Latvian",
  "Lithuanian",
  "Luxembourgish",
  "Macedonian",
  "Malagasy",
  "Malay",
  "Malayalam",
  "Maltese",
  "Maori",
  "Marathi",
  "Mongolian",
  "Nepali",
  "Norwegian",
  "Nyanja",
  "Odia",
  "Pashto",
  "Persian",
  "Polish",
  "Portuguese",
  "Punjabi",
  "Romanian",
  "Russian",
  "Samoan",
  "Scots Gaelic",
  "Serbian",
  "Sesotho",
  "Shona",
  "Sindhi",
  "Sinhala",
  "Slovak",
  "Slovenian",
  "Somali",
  "Spanish",
  "Sundanese",
  "Swahili",
  "Swedish",
  "Tagalog",
  "Tajik",
  "Tamil",
  "Tatar",
  "Telugu",
  "Thai",
  "Turkish",
  "Turkmen",
  "Ukrainian",
  "Urdu",
  "Uyghur",
  "Uzbek",
  "Vietnamese",
  "Welsh",
  "Xhosa",
  "Yiddish",
  "Yoruba",
  "Zulu",
].sort();

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
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
        setFormState((prev) => ({ ...prev, avatarUrl: result }));
      }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const handleFieldChange = (field: keyof typeof formState, value: string) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!profile) return;
    setIsSaving(true);

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
      setProfile(refreshed);
      setFormState({
        displayName: refreshed.displayName || user?.name || '',
        contactEmail: refreshed.contactEmail || user?.email || '',
        gradeLevel: refreshed.gradeLevel || '',
        nativeLanguage: refreshed.nativeLanguage || '',
        location: refreshed.location || '',
        schoolName: refreshed.schoolName || '',
        avatarUrl: refreshed.avatarUrl || '',
      });
      if (refreshed.avatarUrl) updateAvatarUrl(refreshed.avatarUrl);
      toast.success(t('app.profile.toast.saved') || 'Profile updated.');
    } catch (error) {
      console.error('Failed to save profile:', error);
      toast.error(t('app.profile.toast.saveError') || 'Failed to update profile.');
    } finally {
      setIsSaving(false);
    }
  };

const gradeOptions = [
  'Kindergarten',
  ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`),
  'College',
  'Out of School',
]
  const avatarSrc = formState.avatarUrl || '';
  const inputsDisabled = isLoading || !profile || isSaving;
  const studentLabel = t('app.profile.student') || 'Student';
  const gradeSummary = formState.gradeLevel
    ? `${formState.gradeLevel}`
    : studentLabel;
  const activeLearningLocale = profile?.learningLocale || DEFAULT_LEARNING_LOCALE;
  const durationByLocale = minigameSummary?.durationSecondsByLocale ?? {};
  const languageRows = Array.from(
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

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
          {studentLabel}
        </p>
        <h1 className="text-3xl font-display font-bold text-foreground">
          {t('app.profile.title')}
        </h1>
      </header>

      <div className="grid gap-6 md:grid-cols-3">
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
                  className="h-32 w-32 rounded-2xl border-3 border-foreground bg-secondary object-cover shadow-stamp-sm"
                />
              ) : (
                <div className="flex h-32 w-32 items-center justify-center rounded-2xl border-3 border-foreground bg-secondary text-muted-foreground shadow-stamp-sm">
                  <CircleUserRound className="h-16 w-16" strokeWidth={1.75} />
                </div>
              )}
              <button
                type="button"
                onClick={handleAvatarClick}
                className="absolute -bottom-1 -right-1 flex h-10 w-10 items-center justify-center rounded-xl border-2 border-foreground bg-primary text-primary-foreground shadow-stamp-sm transition-colors hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed"
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
                onChange={handleAvatarChange}
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
                <div
                  key={language.locale}
                  className="rounded-xl border-2 border-border bg-secondary/60 p-4"
                >
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
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-6 md:col-span-2">
          <section className="rounded-2xl border-3 border-foreground bg-card p-6 shadow-stamp">
            <div className="mb-5 flex flex-col gap-3 border-b-2 border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-xl font-display font-bold text-foreground">
                {t('app.profile.personalInfo')}
              </h3>
              <Button
                type="button"
                onClick={handleSave}
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
                onChange={(event) => handleFieldChange('displayName', event.target.value)}
                placeholder={t('app.profile.fullName') || 'Full Name'}
                disabled={inputsDisabled}
              />

              <Input
                label={t('app.profile.email')}
                type="email"
                value={formState.contactEmail}
                onChange={(event) => handleFieldChange('contactEmail', event.target.value)}
                placeholder={t('app.profile.email') || 'Email Address'}
                disabled={inputsDisabled}
              />

              <div className="flex flex-col gap-2">
                <label className="text-base font-medium">
                  {t('app.profile.student') || 'Education Level'}
                </label>
              

              <select
                value={formState.gradeLevel}
                onChange={(e) => handleFieldChange('gradeLevel', e.target.value)}
                disabled={inputsDisabled}
                className="h-11 rounded-xl border-2 border-border bg-background px-3 text-sm focus:border-primary focus:outline-none"
              >
                <option value="">Select Education Level</option>
                {gradeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              </div>

              <div className="flex flex-col gap-2">
              <label className="text-base font-medium">
                {t('app.profile.nativeLanguage') || 'Native Language'}
              </label>

              <select
                value={formState.nativeLanguage}
                onChange={(e) => handleFieldChange('nativeLanguage', e.target.value)}
                disabled={inputsDisabled}
                className="h-11 rounded-xl border-2 border-border bg-background pl-3 px-3 text-sm focus:border-primary focus:outline-none"
              >
                <option value="">Select Native Language</option>
                {languages.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </select>
            </div>

             <div className="flex flex-col gap-2">
              <label className="text-base font-medium">
                {t('app.profile.location') || 'Location'}
              </label>

              <select
                value={formState.location}
                onChange={(e) => handleFieldChange('location', e.target.value)}
                disabled={inputsDisabled}
                className="h-11 rounded-xl border-2 border-border bg-background pl-3 px-3 text-sm focus:border-primary focus:outline-none"
              >
                <option value="">Select Country</option>
                {countries.map((country) => (
                  <option key={country} value={country}>
                    {country}
                  </option>
                ))}
              </select>
            </div>

              <Input
                label={t('app.profile.school')}
                type="text"
                value={formState.schoolName}
                onChange={(event) => handleFieldChange('schoolName', event.target.value)}
                placeholder={t('app.profile.school') || 'School'}
                disabled={inputsDisabled}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
