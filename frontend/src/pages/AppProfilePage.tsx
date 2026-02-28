import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  MapPin,
  School,
  Globe,
  Github,
  Facebook,
  Instagram,
  Youtube,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { getUserProfile, updateProfile } from '@/api/user';
import { Button, Input } from '@/components/ui';
import type { UserProfile } from '@/types';
import { GraduationCap } from "lucide-react";

const USER_AVATAR = '/imgs/landing/student.jpg';

type ProviderKey = 'google' | 'github' | 'facebook' | 'instagram' | 'youtube';
type ProviderConfig = {
  key: ProviderKey;
  label: string;
  providerId?: string;
  iconType: 'image' | 'icon';
  iconSrc?: string;
  iconAlt?: string;
  icon?: LucideIcon;
  iconClassName: string;
  unsupported?: boolean;
  connectedVia?: string;
};

export function AppProfilePage() {
  const { t } = useLanguage();
  const {
    user,
    firebaseUser,
    linkWithGoogle,
    linkWithGithub,
    linkWithFacebook,
    unlinkProvider,
  } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [providerLoading, setProviderLoading] = useState<Record<string, boolean>>({});
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
    const loadProfile = async () => {
      try {
        const data = await getUserProfile();
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
      } catch (error) {
        console.error('Failed to load profile:', error);
        toast.error(t('app.profile.toast.loadError') || 'Failed to load profile.');
      } finally {
        setIsLoading(false);
      }
    };

    loadProfile();
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

  const providerData = firebaseUser?.providerData ?? [];
  const connectionEmail = formState.contactEmail || user?.email || '';

  const getProviderEntry = (providerId: string) =>
    providerData.find((provider) => provider.providerId === providerId);

  const isProviderConnected = (providerId: string) =>
    Boolean(getProviderEntry(providerId));

  const getProviderIdentity = (providerId: string) => {
    const entry = getProviderEntry(providerId);
    return entry?.email || entry?.displayName || connectionEmail;
  };

  const setProviderBusy = (providerKey: ProviderKey, busy: boolean) => {
    setProviderLoading((prev) => ({ ...prev, [providerKey]: busy }));
  };

  const handleProviderAction = async (providerKey: ProviderKey) => {
    if (providerKey === 'instagram' || providerKey === 'youtube') {
      toast.info(t('app.profile.unavailable') || 'Not supported yet.');
      return;
    }

    const providerId =
      providerKey === 'google'
        ? 'google.com'
        : providerKey === 'github'
        ? 'github.com'
        : 'facebook.com';
    const connected = isProviderConnected(providerId);

    if (connected && providerData.length <= 1) {
      toast.error(
        t('app.profile.toast.disconnectLast') ||
          'Add another sign-in method before disconnecting.'
      );
      return;
    }

    setProviderBusy(providerKey, true);
    try {
      if (connected) {
        await unlinkProvider(providerId);
        toast.success(t('app.profile.toast.unlinked') || 'Disconnected.');
      } else {
        if (providerKey === 'google') {
          await linkWithGoogle();
        } else if (providerKey === 'github') {
          await linkWithGithub();
        } else {
          await linkWithFacebook();
        }
        toast.success(t('app.profile.toast.linked') || 'Connected.');
      }
    } catch (error) {
      console.error('Failed to update provider link:', error);
      toast.error(
        connected
          ? t('app.profile.toast.unlinkError') || 'Failed to disconnect.'
          : t('app.profile.toast.linkError') || 'Failed to connect.'
      );
    } finally {
      setProviderBusy(providerKey, false);
    }
  };

  const avatarSrc =
    formState.avatarUrl || firebaseUser?.photoURL || USER_AVATAR;
  const inputsDisabled = isLoading || !profile || isSaving;
  const studentLabel = t('app.profile.student') || 'Student';
  const gradeSummary = formState.gradeLevel
    ? `${formState.gradeLevel}`
    : studentLabel;

  const providers: ProviderConfig[] = [
    {
      key: 'google' as ProviderKey,
      label: 'Google Classroom',
      providerId: 'google.com',
      iconType: 'icon' as const,
      icon: GraduationCap,
      iconAlt: 'Google',
      iconClassName: 'bg-[#0F9D58] text-white',
    },
    {
      key: 'github' as ProviderKey,
      label: 'GitHub',
      providerId: 'github.com',
      iconType: 'icon' as const,
      icon: Github,
      iconClassName: 'bg-black text-white',
    },
    {
      key: 'facebook' as ProviderKey,
      label: 'Facebook',
      providerId: 'facebook.com',
      iconType: 'icon' as const,
      icon: Facebook,
      iconClassName: 'bg-blue-600 text-white',
    },
    {
      key: 'instagram' as ProviderKey,
      label: 'Instagram',
      iconType: 'icon' as const,
      icon: Instagram,
      iconClassName: 'bg-gradient-to-br from-pink-500 via-purple-500 to-orange-400 text-white',
      unsupported: true,
    },
    {
      key: 'youtube' as ProviderKey,
      label: 'YouTube',
      iconType: 'icon' as const,
      icon: Youtube,
      iconClassName: 'bg-red-600 text-white',
      unsupported: true,
      connectedVia: 'google.com',
    },
  ];

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
            <div className="relative mx-auto mb-4 inline-block">
              <img
                src={avatarSrc}
                alt={t('app.profile.photo') || 'Profile'}
                className="h-32 w-32 rounded-2xl border-3 border-foreground bg-secondary object-cover shadow-stamp-sm"
              />
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
              <div>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-semibold text-foreground">Spanish</span>
                  <span className="text-muted-foreground">{t('app.profile.level')} A2</span>
                </div>
                <div className="h-2.5 rounded-full bg-secondary">
                  <div className="h-full w-[65%] rounded-full bg-primary" />
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-semibold text-foreground">French</span>
                  <span className="text-muted-foreground">{t('app.profile.level')} A1</span>
                </div>
                <div className="h-2.5 rounded-full bg-secondary">
                  <div className="h-full w-[20%] rounded-full bg-[var(--color-chart-4)]" />
                </div>
              </div>
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

              <Input
                label={t('app.profile.nativeLanguage')}
                type="text"
                value={formState.nativeLanguage}
                onChange={(event) => handleFieldChange('nativeLanguage', event.target.value)}
                placeholder={t('app.profile.nativeLanguage') || 'Native Language'}
                disabled={inputsDisabled}
              />

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

          <section className="rounded-2xl border-3 border-foreground bg-card p-6 shadow-stamp">
            <h3 className="mb-5 border-b-2 border-border pb-4 text-xl font-display font-bold text-foreground">
              {t('app.profile.connectedAccounts')}
            </h3>
            <div className="space-y-3">
              {providers.map((provider) => {
                const connected = provider.providerId
                  ? isProviderConnected(provider.providerId)
                  : provider.connectedVia
                  ? isProviderConnected(provider.connectedVia)
                  : false;
                const providerEmail = provider.providerId
                  ? getProviderIdentity(provider.providerId)
                  : '';
                const busy = Boolean(providerLoading[provider.key]);
                const actionLabel = provider.unsupported
                  ? t('app.profile.unavailable') || 'Not supported yet'
                  : connected
                  ? t('app.profile.disconnect')
                  : t('app.profile.connect');
                const connectedLabel = providerEmail
                  ? `${t('app.profile.connectedAs')} ${providerEmail}`
                  : t('app.profile.connected') || 'Connected';
                const statusLabel = provider.unsupported
                  ? provider.connectedVia && isProviderConnected(provider.connectedVia)
                    ? t('app.profile.connectedViaGoogle') || 'Connected via Google'
                    : t('app.profile.unavailable') || 'Not supported yet'
                  : connected
                  ? connectedLabel
                  : t('app.profile.notConnected');
                const Icon = provider.iconType === 'icon' ? provider.icon : null;

                return (
                  <div
                    key={provider.key}
                    className="flex flex-col gap-3 rounded-xl border-2 border-border bg-secondary/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={`h-10 w-10 shrink-0 rounded-xl border border-border flex items-center justify-center ${provider.iconClassName}`}
                      >
                        {provider.iconType === 'image' ? (
                          <img
                            src={provider.iconSrc}
                            alt={provider.iconAlt}
                            className="h-5 w-5"
                          />
                        ) : Icon ? (
                          <Icon size={18} />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">{provider.label}</p>
                        <p className="truncate text-sm text-muted-foreground">{statusLabel}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleProviderAction(provider.key)}
                      disabled={busy || !firebaseUser || provider.unsupported}
                      className={clsx(
                        'min-h-11 rounded-xl border-2 px-4 py-2 text-sm font-semibold transition-colors',
                        provider.unsupported
                          ? 'border-border bg-secondary text-muted-foreground'
                          : connected
                          ? 'border-destructive/35 bg-destructive/10 text-destructive hover:bg-destructive/15'
                          : 'border-primary/35 bg-primary/10 text-primary hover:bg-primary/20',
                        (busy || !firebaseUser) && 'opacity-60 cursor-not-allowed'
                      )}
                    >
                      {busy
                        ? connected
                          ? t('app.profile.disconnecting') || 'Disconnecting...'
                          : t('app.profile.connecting') || 'Connecting...'
                        : actionLabel}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
