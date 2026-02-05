import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  MapPin,
  Mail,
  School,
  GraduationCap,
  Globe,
  Github,
  Facebook,
  Instagram,
  Youtube,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { getUserProfile, updateProfile } from '@/api/user';
import type { UserProfile } from '@/types';

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
    ? `${studentLabel} - ${formState.gradeLevel}`
    : studentLabel;

  const providers: ProviderConfig[] = [
    {
      key: 'google' as ProviderKey,
      label: 'Google Classroom',
      providerId: 'google.com',
      iconType: 'image' as const,
      iconSrc: '/imgs/branding/google-g.svg',
      iconAlt: 'Google',
      iconClassName: 'bg-slate-100',
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
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-slate-900 mb-8">
        {t('app.profile.title')}
      </h1>

      <div className="grid md:grid-cols-3 gap-8">
        <div className="md:col-span-1 space-y-6">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 text-center">
            <div className="relative inline-block mb-4">
              <img
                src={avatarSrc}
                alt={t('app.profile.photo') || 'Profile'}
                className="w-32 h-32 rounded-full object-cover border-4 border-slate-50"
              />
              <button
                type="button"
                onClick={handleAvatarClick}
                className="absolute bottom-0 right-0 p-2 bg-purple-600 text-white rounded-full hover:bg-purple-700 shadow-md border-2 border-white transition-colors"
                aria-label={t('app.profile.changePhoto') || 'Change profile photo'}
                disabled={inputsDisabled}
              >
                <Camera size={18} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
              />
            </div>
            <h2 className="text-xl font-bold text-slate-900">
              {formState.displayName || 'User'}
            </h2>
            <p className="text-slate-500 mb-4">{gradeSummary}</p>

            <div className="flex items-center justify-center space-x-2 text-sm text-slate-600 mb-2">
              <MapPin size={16} />
              <input
                type="text"
                value={formState.location}
                onChange={(event) => handleFieldChange('location', event.target.value)}
                placeholder={t('app.profile.location') || 'Location'}
                className="w-full max-w-[180px] bg-slate-50 rounded-md px-2 py-1 text-center text-slate-600 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-200"
                aria-label={t('app.profile.location') || 'Location'}
                disabled={inputsDisabled}
              />
            </div>
            <div className="flex items-center justify-center space-x-2 text-sm text-slate-600">
              <School size={16} />
              <input
                type="text"
                value={formState.schoolName}
                onChange={(event) => handleFieldChange('schoolName', event.target.value)}
                placeholder={t('app.profile.school') || 'School'}
                className="w-full max-w-[180px] bg-slate-50 rounded-md px-2 py-1 text-center text-slate-600 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-200"
                aria-label={t('app.profile.school') || 'School'}
                disabled={inputsDisabled}
              />
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
            <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Globe size={18} className="text-purple-600" />
              {t('app.profile.languages')}
            </h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-slate-700">Spanish</span>
                  <span className="text-slate-500">{t('app.profile.level')} A2</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2">
                  <div className="bg-purple-600 h-2 rounded-full" style={{ width: '65%' }}></div>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-slate-700">French</span>
                  <span className="text-slate-500">{t('app.profile.level')} A1</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2">
                  <div className="bg-blue-500 h-2 rounded-full" style={{ width: '20%' }}></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="md:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
              <h3 className="text-xl font-bold text-slate-900">
                {t('app.profile.personalInfo')}
              </h3>
              <button
                type="button"
                onClick={handleSave}
                disabled={inputsDisabled}
                className="text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSaving
                  ? t('app.profile.saving') || 'Saving...'
                  : t('app.profile.save') || 'Save Changes'}
              </button>
            </div>

            <div className="grid sm:grid-cols-2 gap-6">
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {t('app.profile.fullName')}
                </label>
                <input
                  type="text"
                  value={formState.displayName}
                  onChange={(event) => handleFieldChange('displayName', event.target.value)}
                  placeholder={t('app.profile.fullName') || 'Full Name'}
                  className="w-full p-3 bg-slate-50 rounded-lg text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-purple-200"
                  disabled={inputsDisabled}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {t('app.profile.email')}
                </label>
                <div className="relative">
                  <input
                    type="email"
                    value={formState.contactEmail}
                    onChange={(event) => handleFieldChange('contactEmail', event.target.value)}
                    placeholder={t('app.profile.email') || 'Email Address'}
                    className="w-full p-3 bg-slate-50 rounded-lg text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-purple-200 pr-10"
                    disabled={inputsDisabled}
                  />
                  <Mail size={16} className="absolute right-3 top-3.5 text-slate-400" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {t('app.profile.gradeLevel')}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={formState.gradeLevel}
                    onChange={(event) => handleFieldChange('gradeLevel', event.target.value)}
                    placeholder={t('app.profile.gradeLevel') || 'Grade Level'}
                    className="w-full p-3 bg-slate-50 rounded-lg text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-purple-200 pr-10"
                    disabled={inputsDisabled}
                  />
                  <GraduationCap size={16} className="absolute right-3 top-3.5 text-slate-400" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {t('app.profile.nativeLanguage')}
                </label>
                <input
                  type="text"
                  value={formState.nativeLanguage}
                  onChange={(event) => handleFieldChange('nativeLanguage', event.target.value)}
                  placeholder={t('app.profile.nativeLanguage') || 'Native Language'}
                  className="w-full p-3 bg-slate-50 rounded-lg text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-purple-200"
                  disabled={inputsDisabled}
                />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
            <h3 className="text-xl font-bold text-slate-900 mb-6 border-b border-slate-100 pb-4">
              {t('app.profile.connectedAccounts')}
            </h3>
            <div className="space-y-4">
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
                    className="flex items-center justify-between p-4 border border-slate-100 rounded-xl hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center space-x-4">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center ${provider.iconClassName}`}
                      >
                        {provider.iconType === 'image' ? (
                          <img
                            src={provider.iconSrc}
                            alt={provider.iconAlt}
                            className="w-5 h-5"
                          />
                        ) : Icon ? (
                          <Icon size={20} />
                        ) : null}
                      </div>
                      <div>
                        <div className="font-bold text-slate-900">{provider.label}</div>
                        <div className="text-sm text-slate-500">{statusLabel}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleProviderAction(provider.key)}
                      disabled={busy || !firebaseUser}
                      className={`text-sm font-semibold transition-colors ${
                        provider.unsupported
                          ? 'text-slate-300 hover:text-slate-400'
                          : connected
                          ? 'text-slate-400 hover:text-red-500'
                          : 'text-purple-600 hover:text-purple-700'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
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
          </div>
        </div>
      </div>
    </div>
  );
}
