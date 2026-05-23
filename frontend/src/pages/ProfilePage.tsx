import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
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
  Badge,
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
      }, true);

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
      navigate('/', { replace: true });
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
    interpretive_comprehension: 'Interpretive Comprehension',
    interpersonal_communication: 'Interpersonal Communication',
    presentational_communication: 'Presentational Communication',
    language_control: 'Language Control',
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
      <AnimatedPage className="min-h-screen bg-background flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </AnimatedPage>
    );
  }

  const displayName = profile?.displayName || user?.name || 'User';
  const selectedCategories = profile?.selectedCategories ?? [];
  const resolvedDomainBands = assessmentResults?.domainBands || profile?.domainBands;
  const resolvedProficiencyLevel =
    assessmentResults?.proficiencyLevel ||
    assessmentResults?.actflLevel ||
    assessmentResults?.sklcLevel ||
    profile?.proficiencyLevel ||
    profile?.actflLevel ||
    profile?.sklcLevel;
  const resolvedProficiencyDescription =
    assessmentResults?.proficiencyDescription ||
    assessmentResults?.actflDescription ||
    assessmentResults?.sklcDescription ||
    profile?.proficiencyDescription ||
    profile?.actflDescription ||
    profile?.sklcDescription;
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
    grammar: { bar: 'bg-primary', chip: 'bg-primary/10 text-primary', icon: Type },
    vocabulary: { bar: 'bg-accent', chip: 'bg-accent/10 text-accent', icon: BookOpen },
    pragmatics: { bar: 'bg-success', chip: 'bg-success/10 text-success', icon: MessageCircle },
    pronunciation: { bar: 'bg-destructive', chip: 'bg-destructive/10 text-destructive', icon: Mic },
    interpretive_comprehension: { bar: 'bg-primary', chip: 'bg-primary/10 text-primary', icon: BookOpen },
    interpersonal_communication: { bar: 'bg-accent', chip: 'bg-accent/10 text-accent', icon: MessageCircle },
    presentational_communication: { bar: 'bg-success', chip: 'bg-success/10 text-success', icon: Type },
    language_control: { bar: 'bg-destructive', chip: 'bg-destructive/10 text-destructive', icon: Mic },
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
    <AnimatedPage className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col gap-4 mb-8 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Profile
            </p>
            <h1 className="text-3xl font-display font-bold">My Profile</h1>
            <p className="text-muted-foreground">
              Review your learning details and keep your plan aligned.
            </p>
          </div>
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
            <Button
              variant="outline"
              onClick={() => navigate(-1)}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('nav.back') || 'Back'}
            </Button>
          </motion.div>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {/* Left Column */}
          <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            className="space-y-6 md:col-span-1"
          >
            {/* Profile Header Card */}
            <motion.div variants={staggerItem}>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center text-center">
                    <Avatar className="h-20 w-20 border-3 border-foreground mb-4">
                      <AvatarFallback className="bg-primary text-primary-foreground text-2xl font-display font-bold">
                        {getInitials(profile?.displayName, user?.name, user?.email)}
                      </AvatarFallback>
                    </Avatar>
                    <h2 className="text-xl font-display font-bold">{displayName}</h2>
                    <p className="text-muted-foreground">Learner • {planLabel}</p>
                    {profile?.age && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {profile.age} {t('profile.yearsOld') || 'years old'}
                        {profile.gender && ` · ${genderLabels[profile.gender]}`}
                      </p>
                    )}
                    <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                      {user?.email && (
                        <div className="flex items-center justify-center gap-2">
                          <Mail className="h-4 w-4" />
                          <span>{user.email}</span>
                        </div>
                      )}
                      {profile?.levelObjective && (
                        <div className="flex items-center justify-center gap-2">
                          <GraduationCap className="h-4 w-4" />
                          <span>{profile.levelObjective}</span>
                        </div>
                      )}
                      {focusSummary && (
                        <div className="flex items-center justify-center gap-2">
                          <Globe className="h-4 w-4" />
                          <span>{focusSummary}</span>
                        </div>
                      )}
                    </div>
                    {(resolvedProficiencyLevel || hasAssessment || getFrequencyText() || focusLabel) && (
                      <div className="mt-4 flex flex-wrap justify-center gap-2">
                        {resolvedProficiencyLevel && (
                          <Badge variant="default">
                            <Star className="h-3 w-3 mr-1" />
                            Level {resolvedProficiencyLevel}
                          </Badge>
                        )}
                        {hasAssessment && (
                          <Badge variant="success">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Assessed
                          </Badge>
                        )}
                        {getFrequencyText() && (
                          <Badge variant="secondary">
                            <Clock className="h-3 w-3 mr-1" />
                            {getFrequencyText()}
                          </Badge>
                        )}
                        {focusLabel && (
                          <Badge variant="secondary">
                            <Target className="h-3 w-3 mr-1" />
                            {focusLabel}
                          </Badge>
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
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between border-b-2 border-border pb-4">
                    <CardTitle>
                      {t('profile.learningPreferences') || 'Learning Preferences'}
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={openEditPreferences}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-4">
                    {profile.rigor && (
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-primary/10 rounded-lg border-2 border-primary/20">
                          <Target className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">
                            {t('profile.intensity') || 'Intensity'}
                          </p>
                          <p className="font-semibold">{rigorLabels[profile.rigor]}</p>
                        </div>
                      </div>
                    )}

                    {getFrequencyText() && (
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-accent/10 rounded-lg border-2 border-accent/20">
                          <Clock className="h-4 w-4 text-accent" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">
                            {t('profile.studyFrequency') || 'Study Frequency'}
                          </p>
                          <p className="font-semibold">{getFrequencyText()}</p>
                        </div>
                      </div>
                    )}

                    {profile.levelObjective && (
                      <div className="flex items-start gap-3">
                        <div className="p-2 bg-success/10 rounded-lg border-2 border-success/20">
                          <Calendar className="h-4 w-4 text-success" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">
                            {t('profile.goal') || 'Goal'}
                          </p>
                          <p className="font-semibold">{profile.levelObjective}</p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* Domain Scores Sidebar */}
            {domainEntries.length > 0 && (
              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="border-b-2 border-border pb-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <Globe className="h-4 w-4 text-primary" />
                        Focus Areas
                      </CardTitle>
                      <Badge variant="outline" size="sm">
                        {domainEntries.length} skills
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-5">
                    {selectedCategories.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-border bg-secondary px-3 py-2 text-sm">
                        <span className="uppercase tracking-wider text-muted-foreground text-xs font-semibold">
                          Top focus
                        </span>
                        <span className="font-semibold">
                          {formatCategoryLabel(selectedCategories[0])}
                        </span>
                        {selectedCategories.length > 1 && (
                          <span className="text-muted-foreground">
                            +{selectedCategories.length - 1} more
                          </span>
                        )}
                      </div>
                    )}

                    {domainEntries.map(([domain, score]) => {
                      const style = domainStyles[domain] || {
                        bar: 'bg-muted-foreground',
                        chip: 'bg-muted text-muted-foreground',
                        icon: Globe,
                      };
                      const Icon = style.icon;
                      return (
                        <div key={domain} className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span className={`h-8 w-8 rounded-lg flex items-center justify-center ${style.chip} border-2 border-current/20`}>
                                <Icon className="h-4 w-4" />
                              </span>
                              <span className="font-medium">
                                {domainLabels[domain] || domain}
                              </span>
                            </div>
                            <span className="text-muted-foreground font-semibold">{score}/10</span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-secondary border border-border overflow-hidden">
                            <div
                              className={`h-full ${style.bar} rounded-full`}
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

          {/* Right Column */}
          <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            className="space-y-6 md:col-span-2"
          >
            {/* Personal Information */}
            <motion.div variants={staggerItem}>
              <Card>
                <CardHeader className="border-b-2 border-border pb-4">
                  <CardTitle>Personal Information</CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="grid sm:grid-cols-2 gap-4">
                    {personalInfoItems.map((item) => {
                      const hasValue = item.value !== '';
                      const Icon = item.icon;
                      return (
                        <div key={item.label} className={`space-y-2 ${item.span || ''}`}>
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {item.label}
                          </p>
                          <div className="rounded-xl border-2 border-border bg-secondary px-4 py-3 flex items-center justify-between gap-2">
                            {hasValue ? (
                              <span className="font-medium">{item.value}</span>
                            ) : (
                              <span className="text-muted-foreground">Not set</span>
                            )}
                            {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Learning Progress */}
            {hasAssessment && (
              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="border-b-2 border-border pb-4">
                    <CardTitle>
                      {t('profile.learningProgress') || 'Learning Progress'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6 pt-6">
                    {resolvedProficiencyLevel && (
                      <div className="text-center p-6 bg-primary/10 border-2 border-primary rounded-xl">
                        <p className="text-sm text-muted-foreground mb-1 font-semibold">
                          {t('profile.yourLevel') || 'Your Level'}
                        </p>
                        <p className="text-3xl font-display font-bold text-primary">
                          {resolvedProficiencyLevel}
                        </p>
                        {resolvedProficiencyDescription && (
                          <p className="text-sm text-muted-foreground mt-2">
                            {resolvedProficiencyDescription}
                          </p>
                        )}
                      </div>
                    )}

                    {resolvedDomainBands && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h4 className="font-display font-bold">
                            {t('profile.domainScores') || 'Domain Scores'}
                          </h4>
                          {domainCount > 0 && (
                            <Badge variant="outline" size="sm">
                              {domainCount} domains
                            </Badge>
                          )}
                        </div>
                        {Object.entries(resolvedDomainBands).map(([domain, score]) => {
                          const style = domainStyles[domain] || {
                            bar: 'bg-muted-foreground',
                            chip: 'bg-muted text-muted-foreground',
                            icon: Globe,
                          };
                          return (
                            <div key={domain} className="space-y-2">
                              <div className="flex justify-between text-sm">
                                <span className="font-medium">{domainLabels[domain] || domain}</span>
                                <span className="text-muted-foreground font-semibold">{score}/10</span>
                              </div>
                              <div className="h-3 w-full rounded-full bg-secondary border-2 border-border overflow-hidden">
                                <div
                                  className={`h-full ${style.bar} rounded-full`}
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

            {/* Connected Accounts */}
            <motion.div variants={staggerItem}>
              <Card>
                <CardHeader className="border-b-2 border-border pb-4 flex flex-row items-center justify-between">
                  <CardTitle>Connected Accounts</CardTitle>
                  <Badge variant="outline" size="sm">
                    {user?.email ? '1 of 2 connected' : '0 of 2 connected'}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-4 pt-6">
                  <div className="flex items-center justify-between gap-4 rounded-xl border-2 border-border p-4 hover:bg-secondary transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-lg bg-card border-2 border-border flex items-center justify-center text-sm font-bold">
                        G
                      </div>
                      <div>
                        <p className="font-semibold">Google Classroom</p>
                        <p className="text-sm text-muted-foreground">
                          {user?.email ? `Connected as ${user.email}` : 'Connected'}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="text-sm font-semibold text-muted-foreground hover:text-destructive transition-colors"
                    >
                      Disconnect
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-xl border-2 border-border p-4 hover:bg-secondary transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-lg bg-foreground text-background flex items-center justify-center">
                        <Github size={18} />
                      </div>
                      <div>
                        <p className="font-semibold">GitHub</p>
                        <p className="text-sm text-muted-foreground">Not connected</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
                    >
                      Connect
                    </button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Account Actions */}
            <motion.div variants={staggerItem}>
              <Card>
                <CardHeader className="border-b-2 border-border pb-4">
                  <CardTitle>{t('profile.account') || 'Account'}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-6">
                  <button
                    type="button"
                    onClick={() => navigate('/general?edit=true')}
                    className="w-full flex items-center justify-between gap-4 rounded-xl border-2 border-border p-4 text-left hover:bg-secondary transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-secondary text-foreground border-2 border-border flex items-center justify-center">
                        <User className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-semibold">
                          {t('profile.editProfile') || 'Edit Profile'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Update your personal details
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-primary">Manage</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowLogoutDialog(true)}
                    className="w-full flex items-center justify-between gap-4 rounded-xl border-2 border-destructive/30 p-4 text-left hover:bg-destructive/10 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center">
                        <LogOut className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-semibold">
                          {t('nav.logout') || 'Logout'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Sign out of your account
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-destructive">Sign out</span>
                  </button>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* Edit Preferences Dialog */}
      <Dialog open={showEditPreferences} onOpenChange={setShowEditPreferences}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t('profile.editPreferences') || 'Edit Learning Preferences'}</DialogTitle>
            <DialogDescription>
              {t('profile.editPreferencesDescription') || 'Update your learning intensity and goals'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="space-y-3">
              <Label>{t('general.rigorLabel') || 'Learning Intensity'}</Label>
              <div className="flex flex-wrap gap-2">
                {RIGOR_OPTIONS.map(({ id, labelKey, description }) => (
                  <Button
                    key={id}
                    variant="option"
                    selected={editRigor === id}
                    onClick={() => setEditRigor(id)}
                    className="flex-col h-auto py-2 px-3"
                  >
                    <span>{t(labelKey)}</span>
                    <span className="text-xs text-muted-foreground">{description}</span>
                  </Button>
                ))}
              </div>
            </div>

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
                    className="flex-1"
                  >
                    {t(labelKey)}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="levelObjective">
                {t('general.levelObjectiveLabel') || "What's your goal?"}
              </Label>
              <Input
                id="levelObjective"
                type="text"
                placeholder={t('general.levelObjectivePlaceholder') || 'e.g., Pass TOPIK Level 3'}
                value={editLevelObjective}
                onChange={(e) => setEditLevelObjective(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowEditPreferences(false)}
              disabled={saving}
            >
              {t('logout.cancel') || 'Cancel'}
            </Button>
            <Button
              onClick={handleSavePreferences}
              loading={saving}
              disabled={!editRigor}
            >
              {t('profile.save') || 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Logout Confirmation Dialog */}
      <Dialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <DialogContent className="sm:max-w-[400px]">
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
            >
              {t('logout.cancel') || 'Cancel'}
            </Button>
            <Button
              variant="destructive"
              onClick={handleLogout}
              loading={loggingOut}
            >
              {t('logout.confirm_button') || 'Log Out'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}
