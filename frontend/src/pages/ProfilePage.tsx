import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  LogOut,
  User,
  Calendar,
  Target,
  Clock,
  Pencil,
  Github,
  Mail,
  Users,
  GraduationCap,
  Globe,
  Star,
  CheckCircle2,
  BookOpen,
  MessageCircle,
  Mic,
  Type,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { getUserProfile, updateProfile } from '@/api/user';
import { getAssessmentResults } from '@/api/assessment';
import { AnimatedPage } from '@/components/layout';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Avatar,
  AvatarFallback,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Input,
  Label,
  Slider,
} from '@/components/ui';
import { LoadingSpinner } from '@/components/common';
import { staggerContainer, staggerItem } from '@/lib/animations';
import type { UserProfile, Rigor, FrequencyUnit, AssessmentResults } from '@/types';

const RIGOR_OPTIONS: { id: Rigor; labelKey: string; description: string }[] = [
  { id: 'light', labelKey: 'general.light', description: '10-15 min' },
  { id: 'casual', labelKey: 'general.casual', description: '15-30 min' },
  { id: 'moderate', labelKey: 'general.moderate', description: '30-45 min' },
  { id: 'serious', labelKey: 'general.serious', description: '45-60 min' },
  { id: 'intense', labelKey: 'general.intense', description: '60+ min' },
];

const FREQUENCY_UNIT_OPTIONS: { id: FrequencyUnit; labelKey: string }[] = [
  { id: 'day', labelKey: 'general.perDay' },
  { id: 'week', labelKey: 'general.perWeek' },
  { id: 'month', labelKey: 'general.perMonth' },
];

export function ProfilePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [assessmentResults, setAssessmentResults] = useState<AssessmentResults | null>(null);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Edit preferences state
  const [showEditPreferences, setShowEditPreferences] = useState(false);
  const [editRigor, setEditRigor] = useState<Rigor | null>(null);
  const [editFrequency, setEditFrequency] = useState<number>(3);
  const [editFrequencyUnit, setEditFrequencyUnit] = useState<FrequencyUnit>('week');
  const [editLevelObjective, setEditLevelObjective] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const data = await getUserProfile();
      setProfile(data);
      if (data.assessed) {
        try {
          const results = await getAssessmentResults();
          setAssessmentResults(results);
        } catch (error) {
          console.error('Failed to load assessment results:', error);
        }
      } else {
        setAssessmentResults(null);
      }
    } catch (error) {
      console.error('Failed to load profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const openEditPreferences = () => {
    if (profile) {
      setEditRigor(profile.rigor || null);
      setEditFrequency(profile.frequency || 3);
      setEditFrequencyUnit(profile.frequencyUnit || 'week');
      setEditLevelObjective(profile.levelObjective || '');
    }
    setShowEditPreferences(true);
  };

  const handleSavePreferences = async () => {
    if (!profile || !editRigor) return;

    setSaving(true);
    try {
      await updateProfile({
        displayName: profile.displayName || '',
        age: profile.age || null,
        gender: profile.gender || null,
        rigor: editRigor,
        frequency: editFrequency,
        frequencyUnit: editFrequencyUnit,
        levelObjective: editLevelObjective,
      }, true); // isEdit = true

      // Reload profile to get updated data
      await loadProfile();
      setShowEditPreferences(false);
    } catch (error) {
      console.error('Failed to save preferences:', error);
    } finally {
      setSaving(false);
    }
  };

  const getInitials = (displayName?: string, name?: string, email?: string) => {
    const nameToUse = displayName || name;
    if (nameToUse) {
      return nameToUse
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    if (email) {
      return email[0].toUpperCase();
    }
    return 'U';
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      navigate('/auth');
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      setLoggingOut(false);
      setShowLogoutDialog(false);
    }
  };

  const domainLabels: Record<string, string> = {
    grammar: t('profile.grammar') || 'Grammar',
    vocabulary: t('profile.vocabulary') || 'Vocabulary',
    pragmatics: t('profile.pragmatics') || 'Pragmatics',
    pronunciation: t('profile.pronunciation') || 'Pronunciation',
  };

  const genderLabels: Record<string, string> = {
    male: t('general.male') || 'Male',
    female: t('general.female') || 'Female',
    other: t('general.other') || 'Other',
    prefer_not_to_say: t('general.preferNotToSay') || 'Prefer not to say',
  };

  const rigorLabels: Record<string, string> = {
    light: t('general.light') || 'Light',
    casual: t('general.casual') || 'Casual',
    moderate: t('general.moderate') || 'Moderate',
    serious: t('general.serious') || 'Serious',
    intense: t('general.intense') || 'Intense',
  };

  const frequencyUnitLabels: Record<string, string> = {
    day: t('profile.perDay') || 'per day',
    week: t('profile.perWeek') || 'per week',
    month: t('profile.perMonth') || 'per month',
  };

  const getFrequencyText = () => {
    if (!profile?.frequency || !profile?.frequencyUnit) return null;
    const times = profile.frequency === 1
      ? `1 ${t('general.time') || 'time'}`
      : `${profile.frequency} ${t('general.times') || 'times'}`;
    return `${times} ${frequencyUnitLabels[profile.frequencyUnit] || profile.frequencyUnit}`;
  };

  const getFrequencyLabel = (value: number): string => {
    if (value === 1) return `1 ${t('general.time') || 'time'}`;
    return `${value} ${t('general.times') || 'times'}`;
  };

  if (loading) {
    return (
      <AnimatedPage className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </AnimatedPage>
    );
  }

  const displayName = profile?.displayName || user?.name || 'User';
  const selectedCategories = profile?.selectedCategories ?? [];
  const resolvedDomainBands = assessmentResults?.domainBands || profile?.domainBands;
  const resolvedSklcLevel = assessmentResults?.sklcLevel || profile?.sklcLevel;
  const resolvedSklcDescription = assessmentResults?.sklcDescription || profile?.sklcDescription;
  const hasAssessment = Boolean(profile?.assessed || assessmentResults);
  const categoryLabelMap: Record<string, string> = {
    grammar: 'Grammar',
    vocabulary: 'Vocabulary',
    cultural: 'Cultural Context',
    pronunciation: 'Pronunciation',
  };
  const formatCategoryLabel = (value: string) =>
    categoryLabelMap[value] ||
    value
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  const focusCount = selectedCategories.length;
  const domainCount = resolvedDomainBands ? Object.keys(resolvedDomainBands).length : 0;
  const focusLabel = focusCount > 0
    ? `${focusCount} focus areas`
    : domainCount > 0
    ? `${domainCount} domains`
    : '';
  const focusSummary = selectedCategories.length
    ? [
        formatCategoryLabel(selectedCategories[0]),
        selectedCategories[1] ? formatCategoryLabel(selectedCategories[1]) : '',
      ].filter(Boolean).join(', ') +
      (selectedCategories.length > 2
        ? ` +${selectedCategories.length - 2} more`
        : '')
    : '';
  const planLabel = profile?.rigor
    ? `${rigorLabels[profile.rigor]} plan`
    : 'Personalized plan';
  const domainEntries = resolvedDomainBands
    ? Object.entries(resolvedDomainBands).sort((a, b) => b[1] - a[1])
    : [];
  const domainStyles: Record<string, { bar: string; chip: string; icon: typeof Globe }> = {
    grammar: { bar: 'bg-purple-500', chip: 'bg-purple-50 text-purple-600', icon: Type },
    vocabulary: { bar: 'bg-blue-500', chip: 'bg-blue-50 text-blue-600', icon: BookOpen },
    pragmatics: { bar: 'bg-amber-500', chip: 'bg-amber-50 text-amber-600', icon: MessageCircle },
    pronunciation: { bar: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-600', icon: Mic },
  };

  const personalInfoItems = [
    { label: 'Full Name', value: displayName, icon: User },
    { label: 'Email Address', value: user?.email || '', icon: Mail },
    { label: 'Age', value: profile?.age ? `${profile.age}` : '', icon: Calendar },
    { label: 'Gender', value: profile?.gender ? genderLabels[profile.gender] : '', icon: Users },
    {
      label: 'Learning Goal',
      value: profile?.levelObjective || '',
      icon: GraduationCap,
      span: 'sm:col-span-2',
    },
  ];

  return (
    <AnimatedPage className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col gap-4 mb-8 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Profile</p>
            <h1 className="text-3xl font-bold text-slate-900">My Profile</h1>
            <p className="text-slate-500">
              Review your learning details and keep your plan aligned.
            </p>
          </div>
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
            <Button
              variant="ghost"
              onClick={() => navigate(-1)}
              className="gap-2 text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('nav.back') || 'Back'}
            </Button>
          </motion.div>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            className="space-y-6 md:col-span-1"
          >
            {/* Profile Header Card */}
            <motion.div variants={staggerItem}>
              <Card className="bg-white border border-slate-200 shadow-sm">
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center text-center">
                    <Avatar className="h-20 w-20 border-4 border-purple-100 mb-4">
                      <AvatarFallback className="bg-purple-600 text-white text-2xl">
                        {getInitials(profile?.displayName, user?.name, user?.email)}
                      </AvatarFallback>
                    </Avatar>
                    <h2 className="text-xl font-semibold text-slate-900">{displayName}</h2>
                    <p className="text-slate-500">Learner • {planLabel}</p>
                    {profile?.age && (
                      <p className="text-sm text-slate-500 mt-1">
                        {profile.age} {t('profile.yearsOld') || 'years old'}
                        {profile.gender && ` · ${genderLabels[profile.gender]}`}
                      </p>
                    )}
                    <div className="mt-3 space-y-2 text-sm text-slate-600">
                      {user?.email && (
                        <div className="flex items-center justify-center gap-2">
                          <Mail className="h-4 w-4 text-slate-400" />
                          <span>{user.email}</span>
                        </div>
                      )}
                      {profile?.levelObjective && (
                        <div className="flex items-center justify-center gap-2">
                          <GraduationCap className="h-4 w-4 text-slate-400" />
                          <span>{profile.levelObjective}</span>
                        </div>
                      )}
                      {focusSummary && (
                        <div className="flex items-center justify-center gap-2">
                          <Globe className="h-4 w-4 text-slate-400" />
                          <span>{focusSummary}</span>
                        </div>
                      )}
                    </div>
                    {(resolvedSklcLevel || hasAssessment || getFrequencyText() || focusLabel) && (
                      <div className="mt-4 flex flex-wrap justify-center gap-2">
                        {resolvedSklcLevel && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-700">
                            <Star className="h-3 w-3" />
                            Level {resolvedSklcLevel}
                          </span>
                        )}
                        {hasAssessment && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" />
                            Assessed
                          </span>
                        )}
                        {getFrequencyText() && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                            <Clock className="h-3 w-3" />
                            {getFrequencyText()}
                          </span>
                        )}
                        {focusLabel && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                            <Target className="h-3 w-3" />
                            {focusLabel}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Learning Preferences Card */}
            {profile?.profileCompleted && (
              <motion.div variants={staggerItem}>
                <Card className="bg-white border border-slate-200 shadow-sm">
                  <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4">
                    <CardTitle className="text-xl text-slate-900">
                      {t('profile.learningPreferences') || 'Learning Preferences'}
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={openEditPreferences}
                      className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {profile.rigor && (
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-50 rounded-lg">
                          <Target className="h-4 w-4 text-purple-600" />
                        </div>
                        <div>
                          <p className="text-sm text-slate-500">
                            {t('profile.intensity') || 'Intensity'}
                          </p>
                          <p className="font-medium text-slate-900">{rigorLabels[profile.rigor]}</p>
                        </div>
                      </div>
                    )}

                    {getFrequencyText() && (
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-50 rounded-lg">
                          <Clock className="h-4 w-4 text-purple-600" />
                        </div>
                        <div>
                          <p className="text-sm text-slate-500">
                            {t('profile.studyFrequency') || 'Study Frequency'}
                          </p>
                          <p className="font-medium text-slate-900">{getFrequencyText()}</p>
                        </div>
                      </div>
                    )}

                    {profile.levelObjective && (
                      <div className="flex items-start gap-3">
                        <div className="p-2 bg-purple-50 rounded-lg">
                          <Calendar className="h-4 w-4 text-purple-600" />
                        </div>
                        <div>
                          <p className="text-sm text-slate-500">
                            {t('profile.goal') || 'Goal'}
                          </p>
                          <p className="font-medium text-slate-900">{profile.levelObjective}</p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {domainEntries.length > 0 && (
              <motion.div variants={staggerItem}>
                <Card className="bg-white border border-slate-200 shadow-sm">
                  <CardHeader className="border-b border-slate-100 pb-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg text-slate-900 flex items-center gap-2">
                        <Globe className="h-4 w-4 text-purple-600" />
                        Languages / Focus Areas
                      </CardTitle>
                      <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                        {domainEntries.length} skills
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                      Snapshot of your strongest domains.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-5">
                    {selectedCategories.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                        <span className="uppercase tracking-wide text-slate-400">Top focus</span>
                        <span className="font-semibold text-slate-700">
                          {formatCategoryLabel(selectedCategories[0])}
                        </span>
                        {selectedCategories.length > 1 && (
                          <span className="text-slate-400">
                            +{selectedCategories.length - 1} more
                          </span>
                        )}
                      </div>
                    )}

                    {domainEntries.map(([domain, score]) => {
                      const style = domainStyles[domain] || {
                        bar: 'bg-slate-400',
                        chip: 'bg-slate-100 text-slate-500',
                        icon: Globe,
                      };
                      const Icon = style.icon;
                      return (
                        <div key={domain} className="space-y-2">
                          <div className="flex items-center justify-between text-xs text-slate-500">
                            <div className="flex items-center gap-2">
                              <span className={`h-7 w-7 rounded-full flex items-center justify-center ${style.chip}`}>
                                <Icon className="h-4 w-4" />
                              </span>
                              <span className="font-medium text-slate-700">
                                {domainLabels[domain] || domain}
                              </span>
                            </div>
                            <span>{score}/10</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className={`h-full ${style.bar}`}
                              style={{ width: `${score * 10}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </motion.div>

          <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            className="space-y-6 md:col-span-2"
          >
            <motion.div variants={staggerItem}>
              <Card className="bg-white border border-slate-200 shadow-sm">
                <CardHeader className="border-b border-slate-100 pb-4">
                  <CardTitle className="text-xl text-slate-900">
                    Personal Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="grid sm:grid-cols-2 gap-4">
                    {personalInfoItems.map((item) => {
                      const hasValue = item.value !== '';
                      const Icon = item.icon;
                      return (
                        <div key={item.label} className={`space-y-1 ${item.span || ''}`}>
                          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                            {item.label}
                          </p>
                          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm flex items-center justify-between gap-2">
                            {hasValue ? (
                              <span className="font-medium text-slate-900">{item.value}</span>
                            ) : (
                              <span className="text-slate-400">Not set</span>
                            )}
                            {Icon && <Icon className="h-4 w-4 text-slate-400" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Learning Progress Card */}
            {hasAssessment && (
              <motion.div variants={staggerItem}>
                <Card className="bg-white border border-slate-200 shadow-sm">
                  <CardHeader className="border-b border-slate-100 pb-4">
                    <CardTitle className="text-xl text-slate-900">
                      {t('profile.learningProgress') || 'Learning Progress'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6 pt-6">
                    {resolvedSklcLevel && (
                      <div className="text-center p-4 bg-purple-50 border border-purple-100 rounded-xl">
                        <p className="text-sm text-slate-500 mb-1">
                          {t('profile.yourLevel') || 'Your Level'}
                        </p>
                        <p className="text-2xl font-bold text-purple-700">{resolvedSklcLevel}</p>
                        {resolvedSklcDescription && (
                          <p className="text-sm text-slate-500 mt-1">
                            {resolvedSklcDescription}
                          </p>
                        )}
                      </div>
                    )}

                    {resolvedDomainBands && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium text-slate-900">
                            {t('profile.domainScores') || 'Domain Scores'}
                          </h4>
                          {domainCount > 0 && (
                            <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
                              {domainCount} domains
                            </span>
                          )}
                        </div>
                        {Object.entries(resolvedDomainBands).map(([domain, score]) => {
                          const style = domainStyles[domain] || {
                            bar: 'bg-slate-400',
                            chip: 'bg-slate-100 text-slate-500',
                            icon: Globe,
                          };
                          return (
                            <div key={domain} className="space-y-2">
                              <div className="flex justify-between text-sm text-slate-600">
                                <span>{domainLabels[domain] || domain}</span>
                                <span className="text-slate-400">{score}/10</span>
                              </div>
                              <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                                <div
                                  className={`h-full ${style.bar}`}
                                  style={{ width: `${score * 10}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )}

            <motion.div variants={staggerItem}>
              <Card className="bg-white border border-slate-200 shadow-sm">
                <CardHeader className="border-b border-slate-100 pb-4 flex flex-row items-center justify-between">
                  <CardTitle className="text-xl text-slate-900">
                    Connected Accounts
                  </CardTitle>
                  <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
                    {user?.email ? '1 of 2 connected' : '0 of 2 connected'}
                  </span>
                </CardHeader>
                <CardContent className="space-y-4 pt-6">
                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-full bg-white border border-slate-200 flex items-center justify-center text-sm font-semibold text-slate-600">
                        G
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">Google Classroom</p>
                        <p className="text-sm text-slate-500">
                          {user?.email ? `Connected as ${user.email}` : 'Connected'}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="text-sm font-semibold text-slate-400 hover:text-red-500 transition-colors"
                    >
                      Disconnect
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-full bg-slate-900 text-white flex items-center justify-center">
                        <Github size={18} />
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">GitHub</p>
                        <p className="text-sm text-slate-500">Not connected</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="text-sm font-semibold text-purple-600 hover:text-purple-700 transition-colors"
                    >
                      Connect
                    </button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Account Card */}
            <motion.div variants={staggerItem}>
              <Card className="bg-white border border-slate-200 shadow-sm">
                <CardHeader className="border-b border-slate-100 pb-4">
                  <CardTitle className="text-xl text-slate-900">
                    {t('profile.account') || 'Account'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-6">
                  <button
                    type="button"
                    onClick={() => navigate('/general?edit=true')}
                    className="w-full flex items-center justify-between gap-4 rounded-xl border border-slate-100 p-4 text-left hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center">
                        <User className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">
                          {t('profile.editProfile') || 'Edit Profile'}
                        </p>
                        <p className="text-sm text-slate-500">
                          Update your personal details
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-purple-600">Manage</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowLogoutDialog(true)}
                    className="w-full flex items-center justify-between gap-4 rounded-xl border border-slate-100 p-4 text-left hover:bg-red-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
                        <LogOut className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">
                          {t('nav.logout') || 'Logout'}
                        </p>
                        <p className="text-sm text-slate-500">
                          Sign out of your account
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-red-600">Sign out</span>
                  </button>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* Edit Preferences Dialog */}
      <Dialog open={showEditPreferences} onOpenChange={setShowEditPreferences}>
        <DialogContent className="sm:max-w-[500px] bg-white border border-slate-200">
          <DialogHeader>
            <DialogTitle>{t('profile.editPreferences') || 'Edit Learning Preferences'}</DialogTitle>
            <DialogDescription>
              {t('profile.editPreferencesDescription') || 'Update your learning intensity and goals'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Rigor Selection */}
            <div className="space-y-2">
              <Label>{t('general.rigorLabel') || 'Learning Intensity'}</Label>
              <div className="flex flex-wrap gap-2">
                {RIGOR_OPTIONS.map(({ id, labelKey, description }) => (
                  <Button
                    key={id}
                    variant="option"
                    selected={editRigor === id}
                    onClick={() => setEditRigor(id)}
                    className="flex-col h-auto py-2 px-3 rounded-xl border-slate-200"
                  >
                    <span>{t(labelKey)}</span>
                    <span className="text-xs text-slate-500">{description}</span>
                  </Button>
                ))}
              </div>
            </div>

            {/* Frequency Selection */}
            <div className="space-y-3">
              <Label>{t('general.frequencyLabel') || 'How often do you want to learn?'}</Label>
              <Slider
                min={1}
                max={14}
                value={[editFrequency]}
                onValueChange={(values) => setEditFrequency(values[0])}
                displayValue={getFrequencyLabel(editFrequency)}
              />
              <div className="flex gap-2">
                {FREQUENCY_UNIT_OPTIONS.map(({ id, labelKey }) => (
                  <Button
                    key={id}
                    variant="option"
                    selected={editFrequencyUnit === id}
                    onClick={() => setEditFrequencyUnit(id)}
                    className="flex-1 rounded-xl border-slate-200"
                  >
                    {t(labelKey)}
                  </Button>
                ))}
              </div>
            </div>

            {/* Level Objective */}
            <div className="space-y-2">
              <Label htmlFor="levelObjective">{t('general.levelObjectiveLabel') || "What's your goal?"}</Label>
              <Input
                id="levelObjective"
                type="text"
                placeholder={t('general.levelObjectivePlaceholder') || 'e.g., Pass TOPIK Level 3'}
                value={editLevelObjective}
                onChange={(e) => setEditLevelObjective(e.target.value)}
                className="bg-slate-50 border-slate-200 focus:border-purple-500 focus:ring-purple-200"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowEditPreferences(false)}
              disabled={saving}
              className="rounded-xl border-slate-200"
            >
              {t('logout.cancel') || 'Cancel'}
            </Button>
            <Button
              onClick={handleSavePreferences}
              loading={saving}
              disabled={!editRigor}
              className="rounded-xl"
            >
              {t('profile.save') || 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Logout Confirmation Dialog */}
      <Dialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <DialogContent className="sm:max-w-[400px] bg-white border border-slate-200">
          <DialogHeader>
            <DialogTitle>{t('logout.title') || 'Logout'}</DialogTitle>
            <DialogDescription>
              {t('logout.confirm') || 'Are you sure you want to log out?'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowLogoutDialog(false)}
              disabled={loggingOut}
              className="rounded-xl border-slate-200"
            >
              {t('logout.cancel') || 'Cancel'}
            </Button>
            <Button
              variant="destructive"
              onClick={handleLogout}
              loading={loggingOut}
              className="rounded-xl"
            >
              {t('logout.confirm_button') || 'Log Out'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}
