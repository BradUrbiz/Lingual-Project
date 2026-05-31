import { useCallback, useEffect, useReducer } from 'react';
import type { ElementType, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { m } from 'framer-motion';
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
import { ageToRangeI18nKey } from '@/lib/ageRanges';
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

const CATEGORY_LABEL_MAP: Record<string, string> = {
  grammar: 'Grammar',
  vocabulary: 'Vocabulary',
  cultural: 'Cultural Context',
  pronunciation: 'Pronunciation',
};

const DOMAIN_STYLES: Record<string, { bar: string; chip: string; icon: typeof Globe }> = {
  grammar: { bar: 'bg-primary', chip: 'bg-primary/10 text-primary', icon: Type },
  vocabulary: { bar: 'bg-accent', chip: 'bg-accent/10 text-accent', icon: BookOpen },
  pragmatics: { bar: 'bg-success', chip: 'bg-success/10 text-success', icon: MessageCircle },
  pronunciation: { bar: 'bg-destructive', chip: 'bg-destructive/10 text-destructive', icon: Mic },
  interpretive_comprehension: { bar: 'bg-primary', chip: 'bg-primary/10 text-primary', icon: BookOpen },
  interpersonal_communication: { bar: 'bg-accent', chip: 'bg-accent/10 text-accent', icon: MessageCircle },
  presentational_communication: { bar: 'bg-success', chip: 'bg-success/10 text-success', icon: Type },
  language_control: { bar: 'bg-destructive', chip: 'bg-destructive/10 text-destructive', icon: Mic },
};

type TranslationFn = (key: string) => string;

type ProfilePageState = {
  assessmentResults: AssessmentResults | null;
  editFrequency: number;
  editFrequencyUnit: FrequencyUnit;
  editLevelObjective: string;
  editRigor: Rigor | null;
  loading: boolean;
  loggingOut: boolean;
  profile?: UserProfile;
  saving: boolean;
  showEditPreferences: boolean;
  showLogoutDialog: boolean;
};

type ProfilePageAction =
  | { type: 'load:started' }
  | { type: 'load:succeeded'; profile: UserProfile; assessmentResults: AssessmentResults | null }
  | { type: 'load:failed' }
  | { type: 'edit:opened'; profile?: UserProfile }
  | { type: 'edit:closed' }
  | { type: 'edit:rigorChanged'; editRigor: Rigor }
  | { type: 'edit:frequencyChanged'; editFrequency: number }
  | { type: 'edit:frequencyUnitChanged'; editFrequencyUnit: FrequencyUnit }
  | { type: 'edit:levelObjectiveChanged'; editLevelObjective: string }
  | { type: 'save:started' }
  | { type: 'save:finished' }
  | { type: 'logoutDialog:set'; open: boolean }
  | { type: 'logout:started' }
  | { type: 'logout:finished' };

const INITIAL_PROFILE_PAGE_STATE: ProfilePageState = {
  assessmentResults: null,
  editFrequency: 3,
  editFrequencyUnit: 'week',
  editLevelObjective: '',
  editRigor: null,
  loading: true,
  loggingOut: false,
  profile: undefined,
  saving: false,
  showEditPreferences: false,
  showLogoutDialog: false,
};

function profilePageReducer(
  state: ProfilePageState,
  action: ProfilePageAction,
): ProfilePageState {
  switch (action.type) {
    case 'load:started':
      return { ...state, loading: true };
    case 'load:succeeded':
      return {
        ...state,
        assessmentResults: action.assessmentResults,
        loading: false,
        profile: action.profile,
      };
    case 'load:failed':
      return { ...state, loading: false };
    case 'edit:opened':
      return {
        ...state,
        editFrequency: action.profile?.frequency || 3,
        editFrequencyUnit: action.profile?.frequencyUnit || 'week',
        editLevelObjective: action.profile?.levelObjective || '',
        editRigor: action.profile?.rigor || null,
        showEditPreferences: true,
      };
    case 'edit:closed':
      return { ...state, showEditPreferences: false };
    case 'edit:rigorChanged':
      return { ...state, editRigor: action.editRigor };
    case 'edit:frequencyChanged':
      return { ...state, editFrequency: action.editFrequency };
    case 'edit:frequencyUnitChanged':
      return { ...state, editFrequencyUnit: action.editFrequencyUnit };
    case 'edit:levelObjectiveChanged':
      return { ...state, editLevelObjective: action.editLevelObjective };
    case 'save:started':
      return { ...state, saving: true };
    case 'save:finished':
      return { ...state, saving: false, showEditPreferences: false };
    case 'logoutDialog:set':
      return { ...state, showLogoutDialog: action.open };
    case 'logout:started':
      return { ...state, loggingOut: true };
    case 'logout:finished':
      return { ...state, loggingOut: false, showLogoutDialog: false };
    default:
      return state;
  }
}

const getInitials = (displayName?: string, name?: string, email?: string) => {
  const nameToUse = displayName || name;
  if (nameToUse) {
    return nameToUse
      .split(' ')
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }
  if (email) return email[0].toUpperCase();
  return 'U';
};

const formatCategoryLabel = (value: string) =>
  CATEGORY_LABEL_MAP[value] ||
  value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

function getFrequencyText(
  profile: UserProfile | undefined,
  frequencyUnitLabels: Record<string, string>,
  t: TranslationFn,
) {
  if (!profile?.frequency || !profile?.frequencyUnit) return null;
  const times = profile.frequency === 1
    ? `1 ${t('general.time') || 'time'}`
    : `${profile.frequency} ${t('general.times') || 'times'}`;
  return `${times} ${frequencyUnitLabels[profile.frequencyUnit] || profile.frequencyUnit}`;
}

function getFrequencyLabel(value: number, t: TranslationFn) {
  if (value === 1) return `1 ${t('general.time') || 'time'}`;
  return `${value} ${t('general.times') || 'times'}`;
}

export function ProfilePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const [state, dispatch] = useReducer(profilePageReducer, INITIAL_PROFILE_PAGE_STATE);

  const loadProfile = useCallback(async (showLoading = false) => {
    if (showLoading) dispatch({ type: 'load:started' });
    try {
      const profile = await getUserProfile();
      let assessmentResults: AssessmentResults | null = null;
      if (profile.assessed) {
        try {
          assessmentResults = await getAssessmentResults();
        } catch (error) {
          console.error('Failed to load assessment results:', error);
        }
      }
      dispatch({ type: 'load:succeeded', profile, assessmentResults });
    } catch (error) {
      console.error('Failed to load profile:', error);
      dispatch({ type: 'load:failed' });
    }
  }, []);

  useEffect(() => {
    void loadProfile(true);
  }, [loadProfile]);

  const handleSavePreferences = async () => {
    const { editFrequency, editFrequencyUnit, editLevelObjective, editRigor, profile } = state;
    if (!profile || !editRigor) return;

    dispatch({ type: 'save:started' });
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

      await loadProfile(false);
    } catch (error) {
      console.error('Failed to save preferences:', error);
    } finally {
      dispatch({ type: 'save:finished' });
    }
  };

  const handleLogout = async () => {
    dispatch({ type: 'logout:started' });
    try {
      await logout();
      navigate('/', { replace: true });
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      dispatch({ type: 'logout:finished' });
    }
  };

  const labels = buildProfileLabels(t);
  const view = buildProfileViewModel(state.profile, state.assessmentResults, user, labels, t);

  if (state.loading) {
    return (
      <AnimatedPage className="min-h-screen bg-background flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </AnimatedPage>
    );
  }

  return (
    <AnimatedPage className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-6xl mx-auto">
        <ProfilePageHeader t={t} onBack={() => navigate(-1)} />

        <div className="grid md:grid-cols-3 gap-8">
          <ProfileSidebar
            labels={labels}
            profile={state.profile}
            t={t}
            userEmail={user?.email}
            userName={user?.name}
            view={view}
            onEditPreferences={() => dispatch({ type: 'edit:opened', profile: state.profile })}
          />

          <ProfileMainColumn
            labels={labels}
            t={t}
            userEmail={user?.email}
            view={view}
            onEditProfile={() => navigate('/general?edit=true')}
            onOpenLogout={() => dispatch({ type: 'logoutDialog:set', open: true })}
          />
        </div>
      </div>

      <EditPreferencesDialog
        state={state}
        t={t}
        onFrequencyChange={(editFrequency) => dispatch({ type: 'edit:frequencyChanged', editFrequency })}
        onFrequencyUnitChange={(editFrequencyUnit) =>
          dispatch({ type: 'edit:frequencyUnitChanged', editFrequencyUnit })}
        onLevelObjectiveChange={(editLevelObjective) =>
          dispatch({ type: 'edit:levelObjectiveChanged', editLevelObjective })}
        onOpenChange={(open) => {
          if (!open) dispatch({ type: 'edit:closed' });
        }}
        onRigorChange={(editRigor) => dispatch({ type: 'edit:rigorChanged', editRigor })}
        onSave={handleSavePreferences}
      />

      <LogoutDialog
        loggingOut={state.loggingOut}
        open={state.showLogoutDialog}
        t={t}
        onConfirm={handleLogout}
        onOpenChange={(open) => dispatch({ type: 'logoutDialog:set', open })}
      />
    </AnimatedPage>
  );
}

function buildProfileLabels(t: TranslationFn) {
  const domain: Record<string, string> = {
    grammar: t('profile.grammar') || 'Grammar',
    vocabulary: t('profile.vocabulary') || 'Vocabulary',
    pragmatics: t('profile.pragmatics') || 'Pragmatics',
    pronunciation: t('profile.pronunciation') || 'Pronunciation',
    interpretive_comprehension: 'Interpretive Comprehension',
    interpersonal_communication: 'Interpersonal Communication',
    presentational_communication: 'Presentational Communication',
    language_control: 'Language Control',
  };
  return {
    domain,
    frequencyUnit: {
      day: t('profile.perDay') || 'per day',
      week: t('profile.perWeek') || 'per week',
      month: t('profile.perMonth') || 'per month',
    },
    gender: {
      male: t('general.male') || 'Male',
      female: t('general.female') || 'Female',
      other: t('general.other') || 'Other',
      prefer_not_to_say: t('general.preferNotToSay') || 'Prefer not to say',
    },
    rigor: {
      light: t('general.light') || 'Light',
      casual: t('general.casual') || 'Casual',
      moderate: t('general.moderate') || 'Moderate',
      serious: t('general.serious') || 'Serious',
      intense: t('general.intense') || 'Intense',
    },
  };
}

type ProfileLabels = ReturnType<typeof buildProfileLabels>;

function buildProfileViewModel(
  profile: UserProfile | undefined,
  assessmentResults: AssessmentResults | null,
  user: { email?: string | null; name?: string | null } | null | undefined,
  labels: ProfileLabels,
  t: TranslationFn,
) {
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
      (selectedCategories.length > 2 ? ` +${selectedCategories.length - 2} more` : '')
    : '';
  const planLabel = profile?.rigor ? `${labels.rigor[profile.rigor]} plan` : 'Personalized plan';
  const domainEntries = resolvedDomainBands
    ? Object.entries(resolvedDomainBands).sort((left, right) => right[1] - left[1])
    : [];
  const frequencyText = getFrequencyText(profile, labels.frequencyUnit, t);
  const personalInfoItems = [
    { label: 'Full Name', value: displayName, icon: User },
    { label: 'Email Address', value: user?.email || '', icon: Mail },
    { label: 'Age', value: profile?.age ? t(ageToRangeI18nKey(profile.age)) : '', icon: Calendar },
    { label: 'Gender', value: profile?.gender ? labels.gender[profile.gender] : '', icon: Users },
    {
      label: 'Learning Goal',
      value: profile?.levelObjective || '',
      icon: GraduationCap,
      span: 'sm:col-span-2',
    },
  ];

  return {
    displayName,
    domainCount,
    domainEntries,
    focusLabel,
    focusSummary,
    frequencyText,
    hasAssessment,
    personalInfoItems,
    planLabel,
    resolvedDomainBands,
    resolvedProficiencyDescription,
    resolvedProficiencyLevel,
    selectedCategories,
  };
}

type ProfileViewModel = ReturnType<typeof buildProfileViewModel>;

function ProfilePageHeader({ t, onBack }: { t: TranslationFn; onBack: () => void }) {
  return (
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
      <m.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
        <Button variant="outline" onClick={onBack} className="gap-2">
          <ArrowLeft className="size-4" />
          {t('nav.back') || 'Back'}
        </Button>
      </m.div>
    </div>
  );
}

type ProfileSidebarProps = {
  labels: ProfileLabels;
  profile?: UserProfile;
  t: TranslationFn;
  userEmail?: string | null;
  userName?: string | null;
  view: ProfileViewModel;
  onEditPreferences: () => void;
};

function ProfileSidebar({
  labels,
  profile,
  t,
  userEmail,
  userName,
  view,
  onEditPreferences,
}: ProfileSidebarProps) {
  return (
    <m.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6 md:col-span-1">
      <ProfileHeaderCard
        labels={labels}
        profile={profile}
        t={t}
        userEmail={userEmail}
        userName={userName}
        view={view}
      />
      {profile?.profileCompleted ? (
        <LearningPreferencesCard
          labels={labels}
          profile={profile}
          t={t}
          view={view}
          onEditPreferences={onEditPreferences}
        />
      ) : null}
      {view.domainEntries.length > 0 ? (
        <DomainScoresSidebar labels={labels} selectedCategories={view.selectedCategories} view={view} />
      ) : null}
    </m.div>
  );
}

function ProfileHeaderCard({
  labels,
  profile,
  t,
  userEmail,
  userName,
  view,
}: {
  labels: ProfileLabels;
  profile?: UserProfile;
  t: TranslationFn;
  userEmail?: string | null;
  userName?: string | null;
  view: ProfileViewModel;
}) {
  return (
    <m.div variants={staggerItem}>
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center text-center">
            <Avatar className="size-20 border-3 border-foreground mb-4">
              <AvatarFallback className="bg-primary text-primary-foreground text-2xl font-display font-bold">
                {getInitials(profile?.displayName, userName || undefined, userEmail || undefined)}
              </AvatarFallback>
            </Avatar>
            <h2 className="text-xl font-display font-bold">{view.displayName}</h2>
            <p className="text-muted-foreground">Learner • {view.planLabel}</p>
            {profile?.age ? (
              <p className="text-sm text-muted-foreground mt-1">
                {t(ageToRangeI18nKey(profile.age))}
                {profile.gender ? ` · ${labels.gender[profile.gender]}` : ''}
              </p>
            ) : null}
            <ProfileContactSummary
              focusSummary={view.focusSummary}
              levelObjective={profile?.levelObjective}
              userEmail={userEmail}
            />
            <ProfileBadgeSummary
              focusLabel={view.focusLabel}
              frequencyText={view.frequencyText}
              hasAssessment={view.hasAssessment}
              resolvedProficiencyLevel={view.resolvedProficiencyLevel}
            />
          </div>
        </CardContent>
      </Card>
    </m.div>
  );
}

function ProfileContactSummary({
  focusSummary,
  levelObjective,
  userEmail,
}: {
  focusSummary: string;
  levelObjective?: string;
  userEmail?: string | null;
}) {
  return (
    <div className="mt-3 space-y-2 text-sm text-muted-foreground">
      {userEmail ? (
        <div className="flex items-center justify-center gap-2">
          <Mail className="size-4" />
          <span>{userEmail}</span>
        </div>
      ) : null}
      {levelObjective ? (
        <div className="flex items-center justify-center gap-2">
          <GraduationCap className="size-4" />
          <span>{levelObjective}</span>
        </div>
      ) : null}
      {focusSummary ? (
        <div className="flex items-center justify-center gap-2">
          <Globe className="size-4" />
          <span>{focusSummary}</span>
        </div>
      ) : null}
    </div>
  );
}

function ProfileBadgeSummary({
  focusLabel,
  frequencyText,
  hasAssessment,
  resolvedProficiencyLevel,
}: {
  focusLabel: string;
  frequencyText: string | null;
  hasAssessment: boolean;
  resolvedProficiencyLevel?: string | null;
}) {
  if (!resolvedProficiencyLevel && !hasAssessment && !frequencyText && !focusLabel) return null;

  return (
    <div className="mt-4 flex flex-wrap justify-center gap-2">
      {resolvedProficiencyLevel ? (
        <Badge variant="default">
          <Star className="size-3 mr-1" />
          Level {resolvedProficiencyLevel}
        </Badge>
      ) : null}
      {hasAssessment ? (
        <Badge variant="success">
          <CheckCircle2 className="size-3 mr-1" />
          Assessed
        </Badge>
      ) : null}
      {frequencyText ? (
        <Badge variant="secondary">
          <Clock className="size-3 mr-1" />
          {frequencyText}
        </Badge>
      ) : null}
      {focusLabel ? (
        <Badge variant="secondary">
          <Target className="size-3 mr-1" />
          {focusLabel}
        </Badge>
      ) : null}
    </div>
  );
}

function LearningPreferencesCard({
  labels,
  profile,
  t,
  view,
  onEditPreferences,
}: {
  labels: ProfileLabels;
  profile: UserProfile;
  t: TranslationFn;
  view: ProfileViewModel;
  onEditPreferences: () => void;
}) {
  return (
    <m.div variants={staggerItem}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between border-b-2 border-border pb-4">
          <CardTitle>{t('profile.learningPreferences') || 'Learning Preferences'}</CardTitle>
          <Button variant="ghost" size="icon" onClick={onEditPreferences}>
            <Pencil className="size-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {profile.rigor ? (
            <PreferenceRow
              icon={Target}
              iconClassName="bg-primary/10 border-primary/20 text-primary"
              label={t('profile.intensity') || 'Intensity'}
              value={labels.rigor[profile.rigor]}
            />
          ) : null}
          {view.frequencyText ? (
            <PreferenceRow
              icon={Clock}
              iconClassName="bg-accent/10 border-accent/20 text-accent"
              label={t('profile.studyFrequency') || 'Study Frequency'}
              value={view.frequencyText}
            />
          ) : null}
          {profile.levelObjective ? (
            <PreferenceRow
              icon={Calendar}
              iconClassName="bg-success/10 border-success/20 text-success"
              label={t('profile.goal') || 'Goal'}
              value={profile.levelObjective}
            />
          ) : null}
        </CardContent>
      </Card>
    </m.div>
  );
}

function PreferenceRow({
  icon: Icon,
  iconClassName,
  label,
  value,
}: {
  icon: ElementType;
  iconClassName: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className={`p-2 rounded-lg border-2 ${iconClassName}`}>
        <Icon className="size-4" />
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="font-semibold">{value}</p>
      </div>
    </div>
  );
}

function DomainScoresSidebar({
  labels,
  selectedCategories,
  view,
}: {
  labels: ProfileLabels;
  selectedCategories: string[];
  view: ProfileViewModel;
}) {
  return (
    <m.div variants={staggerItem}>
      <Card>
        <CardHeader className="border-b-2 border-border pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Globe className="size-4 text-primary" />
              Focus Areas
            </CardTitle>
            <Badge variant="outline" size="sm">
              {view.domainEntries.length} skills
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          {selectedCategories.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-border bg-secondary px-3 py-2 text-sm">
              <span className="uppercase tracking-wider text-muted-foreground text-xs font-semibold">
                Top focus
              </span>
              <span className="font-semibold">{formatCategoryLabel(selectedCategories[0])}</span>
              {selectedCategories.length > 1 ? (
                <span className="text-muted-foreground">+{selectedCategories.length - 1} more</span>
              ) : null}
            </div>
          ) : null}

          {view.domainEntries.map(([domain, score]) => (
            <DomainScoreRow
              key={domain}
              domain={domain}
              label={labels.domain[domain] || domain}
              score={score}
            />
          ))}
        </CardContent>
      </Card>
    </m.div>
  );
}

function DomainScoreRow({ domain, label, score }: { domain: string; label: string; score: number }) {
  const style = DOMAIN_STYLES[domain] || {
    bar: 'bg-muted-foreground',
    chip: 'bg-muted text-muted-foreground',
    icon: Globe,
  };
  const Icon = style.icon;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className={`h-8 w-8 rounded-lg flex items-center justify-center ${style.chip} border-2 border-current/20`}>
            <Icon className="size-4" />
          </span>
          <span className="font-medium">{label}</span>
        </div>
        <span className="text-muted-foreground font-semibold">{score}/10</span>
      </div>
      <div className="h-2 w-full rounded-full bg-secondary border border-border overflow-hidden">
        <div className={`h-full ${style.bar} rounded-full`} style={{ width: `${score * 10}%` }} />
      </div>
    </div>
  );
}

type ProfileMainColumnProps = {
  labels: ProfileLabels;
  t: TranslationFn;
  userEmail?: string | null;
  view: ProfileViewModel;
  onEditProfile: () => void;
  onOpenLogout: () => void;
};

function ProfileMainColumn({
  labels,
  t,
  userEmail,
  view,
  onEditProfile,
  onOpenLogout,
}: ProfileMainColumnProps) {
  return (
    <m.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6 md:col-span-2">
      <PersonalInformationCard items={view.personalInfoItems} />
      {view.hasAssessment ? <LearningProgressCard labels={labels} t={t} view={view} /> : null}
      <ConnectedAccountsCard userEmail={userEmail} />
      <AccountActionsCard t={t} onEditProfile={onEditProfile} onOpenLogout={onOpenLogout} />
    </m.div>
  );
}

function PersonalInformationCard({
  items,
}: {
  items: Array<{ label: string; value: string; icon: ElementType; span?: string }>;
}) {
  return (
    <m.div variants={staggerItem}>
      <Card>
        <CardHeader className="border-b-2 border-border pb-4">
          <CardTitle>Personal Information</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid sm:grid-cols-2 gap-4">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className={`space-y-2 ${item.span || ''}`}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {item.label}
                  </p>
                  <div className="rounded-xl border-2 border-border bg-secondary px-4 py-3 flex items-center justify-between gap-2">
                    {item.value ? (
                      <span className="font-medium">{item.value}</span>
                    ) : (
                      <span className="text-muted-foreground">Not set</span>
                    )}
                    <Icon className="size-4 text-muted-foreground" />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </m.div>
  );
}

function LearningProgressCard({
  labels,
  t,
  view,
}: {
  labels: ProfileLabels;
  t: TranslationFn;
  view: ProfileViewModel;
}) {
  return (
    <m.div variants={staggerItem}>
      <Card>
        <CardHeader className="border-b-2 border-border pb-4">
          <CardTitle>{t('profile.learningProgress') || 'Learning Progress'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          {view.resolvedProficiencyLevel ? (
            <div className="text-center p-6 bg-primary/10 border-2 border-primary rounded-xl">
              <p className="text-sm text-muted-foreground mb-1 font-semibold">
                {t('profile.yourLevel') || 'Your Level'}
              </p>
              <p className="text-3xl font-display font-bold text-primary">
                {view.resolvedProficiencyLevel}
              </p>
              {view.resolvedProficiencyDescription ? (
                <p className="text-sm text-muted-foreground mt-2">
                  {view.resolvedProficiencyDescription}
                </p>
              ) : null}
            </div>
          ) : null}

          {view.resolvedDomainBands ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-display font-bold">{t('profile.domainScores') || 'Domain Scores'}</h4>
                {view.domainCount > 0 ? (
                  <Badge variant="outline" size="sm">
                    {view.domainCount} domains
                  </Badge>
                ) : null}
              </div>
              {Object.entries(view.resolvedDomainBands).map(([domain, score]) => (
                <LearningProgressDomainRow
                  key={domain}
                  domain={domain}
                  label={labels.domain[domain] || domain}
                  score={score}
                />
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </m.div>
  );
}

function LearningProgressDomainRow({ domain, label, score }: { domain: string; label: string; score: number }) {
  const style = DOMAIN_STYLES[domain] || {
    bar: 'bg-muted-foreground',
    chip: 'bg-muted text-muted-foreground',
    icon: Globe,
  };
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground font-semibold">{score}/10</span>
      </div>
      <div className="h-3 w-full rounded-full bg-secondary border-2 border-border overflow-hidden">
        <div className={`h-full ${style.bar} rounded-full`} style={{ width: `${score * 10}%` }} />
      </div>
    </div>
  );
}

function ConnectedAccountsCard({ userEmail }: { userEmail?: string | null }) {
  return (
    <m.div variants={staggerItem}>
      <Card>
        <CardHeader className="border-b-2 border-border pb-4 flex flex-row items-center justify-between">
          <CardTitle>Connected Accounts</CardTitle>
          <Badge variant="outline" size="sm">
            {userEmail ? '1 of 2 connected' : '0 of 2 connected'}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          <ConnectedAccountRow
            connectedLabel={userEmail ? `Connected as ${userEmail}` : 'Connected'}
            icon={<span className="text-sm font-bold">G</span>}
            name="Google Classroom"
            actionLabel="Disconnect"
            actionClassName="text-muted-foreground hover:text-destructive"
          />
          <ConnectedAccountRow
            connectedLabel="Not connected"
            icon={<Github size={18} />}
            name="GitHub"
            actionLabel="Connect"
            actionClassName="text-primary hover:text-primary/80"
            darkIcon
          />
        </CardContent>
      </Card>
    </m.div>
  );
}

function ConnectedAccountRow({
  actionClassName,
  actionLabel,
  connectedLabel,
  darkIcon = false,
  icon,
  name,
}: {
  actionClassName: string;
  actionLabel: string;
  connectedLabel: string;
  darkIcon?: boolean;
  icon: ReactNode;
  name: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border-2 border-border p-4 hover:bg-secondary transition-colors">
      <div className="flex items-center gap-4">
        <div className={darkIcon
          ? 'size-10 rounded-lg bg-foreground text-background flex items-center justify-center'
          : 'size-10 rounded-lg bg-card border-2 border-border flex items-center justify-center'}
        >
          {icon}
        </div>
        <div>
          <p className="font-semibold">{name}</p>
          <p className="text-sm text-muted-foreground">{connectedLabel}</p>
        </div>
      </div>
      <button type="button" className={`text-sm font-semibold transition-colors ${actionClassName}`}>
        {actionLabel}
      </button>
    </div>
  );
}

function AccountActionsCard({
  t,
  onEditProfile,
  onOpenLogout,
}: {
  t: TranslationFn;
  onEditProfile: () => void;
  onOpenLogout: () => void;
}) {
  return (
    <m.div variants={staggerItem}>
      <Card>
        <CardHeader className="border-b-2 border-border pb-4">
          <CardTitle>{t('profile.account') || 'Account'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-6">
          <AccountActionButton
            description="Update your personal details"
            icon={User}
            iconClassName="bg-secondary text-foreground border-2 border-border"
            label={t('profile.editProfile') || 'Edit Profile'}
            trailingLabel="Manage"
            trailingClassName="text-primary"
            onClick={onEditProfile}
          />
          <AccountActionButton
            borderClassName="border-destructive/30 hover:bg-destructive/10"
            description="Sign out of your account"
            icon={LogOut}
            iconClassName="bg-destructive/10 text-destructive"
            label={t('nav.logout') || 'Logout'}
            trailingLabel="Sign out"
            trailingClassName="text-destructive"
            onClick={onOpenLogout}
          />
        </CardContent>
      </Card>
    </m.div>
  );
}

function AccountActionButton({
  borderClassName = 'border-border hover:bg-secondary',
  description,
  icon: Icon,
  iconClassName,
  label,
  trailingClassName,
  trailingLabel,
  onClick,
}: {
  borderClassName?: string;
  description: string;
  icon: ElementType;
  iconClassName: string;
  label: string;
  trailingClassName: string;
  trailingLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-4 rounded-xl border-2 p-4 text-left transition-colors ${borderClassName}`}
    >
      <div className="flex items-center gap-3">
        <div className={`size-10 rounded-lg flex items-center justify-center ${iconClassName}`}>
          <Icon className="size-5" />
        </div>
        <div>
          <p className="font-semibold">{label}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <span className={`text-sm font-semibold ${trailingClassName}`}>{trailingLabel}</span>
    </button>
  );
}

type EditPreferencesDialogProps = {
  state: ProfilePageState;
  t: TranslationFn;
  onFrequencyChange: (editFrequency: number) => void;
  onFrequencyUnitChange: (editFrequencyUnit: FrequencyUnit) => void;
  onLevelObjectiveChange: (editLevelObjective: string) => void;
  onOpenChange: (open: boolean) => void;
  onRigorChange: (editRigor: Rigor) => void;
  onSave: () => void;
};

function EditPreferencesDialog({
  state,
  t,
  onFrequencyChange,
  onFrequencyUnitChange,
  onLevelObjectiveChange,
  onOpenChange,
  onRigorChange,
  onSave,
}: EditPreferencesDialogProps) {
  return (
    <Dialog open={state.showEditPreferences} onOpenChange={onOpenChange}>
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
                  selected={state.editRigor === id}
                  onClick={() => onRigorChange(id)}
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
              value={[state.editFrequency]}
              onValueChange={(values) => onFrequencyChange(values[0])}
              displayValue={getFrequencyLabel(state.editFrequency, t)}
            />
            <div className="flex gap-2">
              {FREQUENCY_UNIT_OPTIONS.map(({ id, labelKey }) => (
                <Button
                  key={id}
                  variant="option"
                  selected={state.editFrequencyUnit === id}
                  onClick={() => onFrequencyUnitChange(id)}
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
              value={state.editLevelObjective}
              onChange={(event) => onLevelObjectiveChange(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={state.saving}>
            {t('logout.cancel') || 'Cancel'}
          </Button>
          <Button onClick={onSave} loading={state.saving} disabled={!state.editRigor}>
            {t('profile.save') || 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LogoutDialog({
  loggingOut,
  open,
  t,
  onConfirm,
  onOpenChange,
}: {
  loggingOut: boolean;
  open: boolean;
  t: TranslationFn;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{t('logout.title') || 'Logout'}</DialogTitle>
          <DialogDescription>
            {t('logout.confirm') || 'Are you sure you want to log out?'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loggingOut}>
            {t('logout.cancel') || 'Cancel'}
          </Button>
          <Button variant="destructive" onClick={onConfirm} loading={loggingOut}>
            {t('logout.confirm_button') || 'Log Out'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
