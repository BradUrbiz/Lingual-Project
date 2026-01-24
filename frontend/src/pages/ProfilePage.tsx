import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, LogOut, User, Calendar, Target, Clock, Pencil } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { getUserProfile, updateProfile } from '@/api/user';
import { AnimatedPage } from '@/components/layout';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Avatar,
  AvatarFallback,
  Progress,
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
import type { UserProfile, Rigor, FrequencyUnit } from '@/types';

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

  return (
    <AnimatedPage className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Back Button */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="mb-6"
        >
          <Button
            variant="ghost"
            onClick={() => navigate(-1)}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('nav.back') || 'Back'}
          </Button>
        </motion.div>

        <motion.div
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          className="space-y-6"
        >
          {/* Profile Header Card */}
          <motion.div variants={staggerItem}>
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col items-center text-center">
                  <Avatar className="h-20 w-20 border-4 border-accent/20 mb-4">
                    <AvatarFallback className="bg-accent text-white text-2xl">
                      {getInitials(profile?.displayName, user?.name, user?.email)}
                    </AvatarFallback>
                  </Avatar>
                  <h2 className="text-xl font-semibold">{displayName}</h2>
                  <p className="text-muted-foreground">{user?.email}</p>
                  {profile?.age && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {profile.age} {t('profile.yearsOld') || 'years old'}
                      {profile.gender && ` · ${genderLabels[profile.gender]}`}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Learning Preferences Card */}
          {profile?.profileCompleted && (
            <motion.div variants={staggerItem}>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>{t('profile.learningPreferences') || 'Learning Preferences'}</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={openEditPreferences}
                    className="h-8 w-8 p-0"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Rigor */}
                  {profile.rigor && (
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-accent/10 rounded-lg">
                        <Target className="h-4 w-4 text-accent" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">
                          {t('profile.intensity') || 'Intensity'}
                        </p>
                        <p className="font-medium">{rigorLabels[profile.rigor]}</p>
                      </div>
                    </div>
                  )}

                  {/* Frequency */}
                  {getFrequencyText() && (
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-accent/10 rounded-lg">
                        <Clock className="h-4 w-4 text-accent" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">
                          {t('profile.studyFrequency') || 'Study Frequency'}
                        </p>
                        <p className="font-medium">{getFrequencyText()}</p>
                      </div>
                    </div>
                  )}

                  {/* Level Objective */}
                  {profile.levelObjective && (
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-accent/10 rounded-lg">
                        <Calendar className="h-4 w-4 text-accent" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">
                          {t('profile.goal') || 'Goal'}
                        </p>
                        <p className="font-medium">{profile.levelObjective}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Learning Progress Card */}
          {profile?.assessed && (
            <motion.div variants={staggerItem}>
              <Card>
                <CardHeader>
                  <CardTitle>{t('profile.learningProgress') || 'Learning Progress'}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* SKLC Level */}
                  {profile.sklcLevel && (
                    <div className="text-center p-4 bg-accent/10 rounded-lg">
                      <p className="text-sm text-muted-foreground mb-1">
                        {t('profile.yourLevel') || 'Your Level'}
                      </p>
                      <p className="text-2xl font-bold text-accent">{profile.sklcLevel}</p>
                      {profile.sklcDescription && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {profile.sklcDescription}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Domain Bands */}
                  {profile.domainBands && (
                    <div className="space-y-4">
                      <h4 className="font-medium">
                        {t('profile.domainScores') || 'Domain Scores'}
                      </h4>
                      {Object.entries(profile.domainBands).map(([domain, score]) => (
                        <div key={domain} className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span>{domainLabels[domain] || domain}</span>
                            <span className="text-muted-foreground">{score}/10</span>
                          </div>
                          <Progress value={score * 10} className="h-2" />
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Account Card */}
          <motion.div variants={staggerItem}>
            <Card>
              <CardHeader>
                <CardTitle>{t('profile.account') || 'Account'}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={() => navigate('/general?edit=true')}
                >
                  <User className="h-4 w-4" />
                  {t('profile.editProfile') || 'Edit Profile'}
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setShowLogoutDialog(true)}
                >
                  <LogOut className="h-4 w-4" />
                  {t('nav.logout') || 'Logout'}
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
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
                    className="flex-col h-auto py-2 px-3"
                  >
                    <span>{t(labelKey)}</span>
                    <span className="text-xs text-muted-foreground">{description}</span>
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
                    className="flex-1"
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
