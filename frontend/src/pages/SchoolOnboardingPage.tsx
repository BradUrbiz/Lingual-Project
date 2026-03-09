import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, School, GraduationCap } from 'lucide-react';
import { motion } from 'motion/react';
import { AnimatedPage } from '@/components/layout';
import { Alert, AlertDescription, Button, Card, Input } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { getCurrentSchool, createSchool } from '@/api/schools';
import type { CreateSchoolPayload, LearningLocale, OrganizationType } from '@/types';

const ORG_TYPE_OPTIONS: Array<{ value: OrganizationType; label: string }> = [
  { value: 'school', label: 'School' },
  { value: 'district', label: 'District' },
  { value: 'program', label: 'Program' },
];

const LOCALE_OPTIONS: Array<{ value: LearningLocale; label: string }> = [
  { value: 'ko-KR', label: 'Korean (Korea)' },
  { value: 'es-ES', label: 'Spanish (Spain)' },
  { value: 'fr-FR', label: 'French (France)' },
];

export function SchoolOnboardingPage() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CreateSchoolPayload>({
    orgName: '',
    orgType: 'school',
    className: '',
    term: '',
    subject: '',
    gradeBand: '',
    learningLocale: 'ko-KR',
  });

  useEffect(() => {
    let active = true;

    const loadSchoolContext = async () => {
      try {
        const school = await getCurrentSchool();
        if (!active) return;

        if (!school.needsSchoolSetup && school.canManageSchool) {
          navigate('/app/teacher', { replace: true });
          return;
        }
      } catch {
        // Keep the setup form available even if the context call fails.
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadSchoolContext();

    return () => {
      active = false;
    };
  }, [navigate]);

  const updateField = <K extends keyof CreateSchoolPayload>(field: K, value: CreateSchoolPayload[K]) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);

    try {
      await createSchool(form);
      await refreshUser();
      navigate('/app/teacher', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create school workspace.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}>
          <Loader2 className="h-10 w-10 text-primary" strokeWidth={3} />
        </motion.div>
      </div>
    );
  }

  return (
    <AnimatedPage className="min-h-screen bg-background p-6">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-3 border-foreground p-8 shadow-stamp">
          <div className="mb-8 flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border-3 border-foreground bg-primary text-primary-foreground">
              <School size={28} strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                School setup
              </p>
              <h1 className="mt-2 text-3xl font-display font-bold text-foreground">
                Create your school workspace
              </h1>
              <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
                This creates the organization, your initial teacher-admin membership, and the first class shell.
                From there, assignments and roster workflows can attach to a real school context instead of the old
                B2C profile model.
              </p>
            </div>
          </div>

          {error && (
            <Alert variant="destructive" className="mb-6">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-5 md:grid-cols-2">
            <Input
              label="Organization Name"
              value={form.orgName}
              onChange={(event) => updateField('orgName', event.target.value)}
              placeholder="West High World Languages"
            />

            <div className="flex flex-col gap-1.5">
              <label htmlFor="school-org-type" className="text-base font-semibold text-foreground">
                Organization Type
              </label>
              <select
                id="school-org-type"
                value={form.orgType}
                onChange={(event) => updateField('orgType', event.target.value as OrganizationType)}
                className="h-12 w-full rounded-xl border-3 border-border bg-card px-4 text-base text-foreground focus:border-primary focus:outline-none"
              >
                {ORG_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <Input
              label="First class name"
              value={form.className}
              onChange={(event) => updateField('className', event.target.value)}
              placeholder="Spanish 2 - Period 3"
            />

            <Input
              label="Term"
              value={form.term}
              onChange={(event) => updateField('term', event.target.value)}
              placeholder="Spring 2026"
            />

            <Input
              label="Subject"
              value={form.subject}
              onChange={(event) => updateField('subject', event.target.value)}
              placeholder="Spanish"
            />

            <Input
              label="Grade band"
              value={form.gradeBand}
              onChange={(event) => updateField('gradeBand', event.target.value)}
              placeholder="9-12"
            />

            <div className="space-y-2 md:col-span-2">
              <label htmlFor="school-learning-locale" className="text-base font-semibold text-foreground">
                Practice language
              </label>
              <select
                id="school-learning-locale"
                value={form.learningLocale}
                onChange={(event) => updateField('learningLocale', event.target.value as LearningLocale)}
                className="h-12 w-full rounded-xl border-3 border-border bg-card px-4 text-base text-foreground focus:border-primary focus:outline-none"
              >
                {LOCALE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button onClick={handleSubmit} loading={saving}>
              Create school workspace
              <ArrowRight size={16} className="ml-2" />
            </Button>
            <Button variant="outline" onClick={() => navigate('/app/learn')}>
              Continue as learner
            </Button>
          </div>
        </Card>

        <Card className="border-3 border-foreground bg-secondary p-8 shadow-stamp">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-foreground bg-accent text-accent-foreground">
              <GraduationCap size={24} strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-xl font-display font-bold text-foreground">What this unlocks</h2>
              <p className="text-sm text-muted-foreground">Phase 1 school foundation</p>
            </div>
          </div>

          <div className="space-y-4">
            {[
              'A real organization boundary above users/{uid}.',
              'Teacher-admin membership context that the backend can authorize per request.',
              'A class record that future curriculum mappings, assignments, compliance, and analytics can attach to.',
            ].map((item) => (
              <div key={item} className="rounded-2xl border-2 border-border bg-card p-4">
                <p className="text-sm font-medium text-foreground">{item}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AnimatedPage>
  );
}
