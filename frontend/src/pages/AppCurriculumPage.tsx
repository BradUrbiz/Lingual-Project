import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { getSampleCurriculumPackage } from '@/api/curriculum';
import { useLanguage } from '@/contexts/LanguageContext';
import type { CurriculumPackageV1, I18nText, Module, Unit } from '@/types';

const getLocalizedText = (value: I18nText | undefined, lang: 'en' | 'ko', fallback = ''): string => {
  if (!value) return fallback;
  return value[lang] || value.en || Object.values(value)[0] || fallback;
};

const getQuestionText = (value: I18nText, lang: 'en' | 'ko'): string => {
  return value[lang] || value.en || Object.values(value)[0] || '';
};

export function AppCurriculumPage() {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [curriculum, setCurriculum] = useState<CurriculumPackageV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedUnits, setExpandedUnits] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let isActive = true;

    const loadCurriculum = async () => {
      setLoading(true);
      setError(null);
      try {
        const pkg = await getSampleCurriculumPackage();
        if (!isActive) return;
        setCurriculum(pkg);
      } catch (err) {
        if (!isActive) return;
        setError(err instanceof Error ? err.message : 'Failed to load curriculum');
      } finally {
        if (isActive) setLoading(false);
      }
    };

    void loadCurriculum();
    return () => {
      isActive = false;
    };
  }, []);

  const modulesById = useMemo(() => {
    const map = new Map<string, Module>();
    curriculum?.modules.forEach((module) => {
      map.set(module.id, module);
    });
    return map;
  }, [curriculum]);

  const moduleTemplateSummaries = useMemo(() => {
    if (!curriculum) return new Map<string, string>();
    const index = new Map(
      (curriculum.templates.activityTemplates || []).map((t) => [t.id, t]),
    );
    const map = new Map<string, string>();
    for (const mod of curriculum.modules) {
      const objectives = curriculum.objectives.filter((o) => mod.objectiveIds.includes(o.id));
      const refs = Array.from(new Set(objectives.flatMap((o) => o.templateRefs || []).filter(Boolean)));
      const resolved = refs.filter((r) => index.has(r));
      if (resolved.length > 0) {
        const names = resolved.map((r) => getLocalizedText(index.get(r)!.title, lang, r));
        map.set(mod.id, names.join(', '));
      }
    }
    return map;
  }, [curriculum, lang]);

  const orderedUnits: Unit[] = useMemo(() => {
    if (!curriculum) return [];
    return [...curriculum.units].sort((a, b) => a.ap.unitNumber - b.ap.unitNumber);
  }, [curriculum]);

  const toggleUnit = (unitId: string) => {
    setExpandedUnits((prev) => ({
      ...prev,
      [unitId]: !prev[unitId],
    }));
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border-3 border-foreground bg-primary text-primary-foreground shadow-stamp-sm">
          <BookOpen size={24} strokeWidth={2.5} />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
            {t('app.curriculum.title') || 'Curriculum'}
          </p>
          <h1 className="text-3xl font-display font-bold text-foreground">
            {t('app.curriculum.title') || 'Curriculum'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('app.curriculum.subtitle') || 'Sample: AP French Units 1-3 (B1-B2)'}
          </p>
        </div>
      </header>

      {error ? (
        <section className="rounded-2xl border-3 border-destructive bg-destructive/10 p-4 text-sm font-medium text-destructive">
          {error}
        </section>
      ) : null}

      {orderedUnits.map((unit) => {
        const unitModules = unit.moduleIds
          .map((moduleId) => modulesById.get(moduleId))
          .filter((module): module is Module => Boolean(module));
        const isExpanded = Boolean(expandedUnits[unit.id]);
        const unitTitle = getLocalizedText(unit.title, lang, unit.ap.title);

        return (
          <section key={unit.id} className="rounded-2xl border-3 border-foreground bg-card p-5 shadow-stamp">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
                  {(t('app.curriculum.unitLabel') || 'Unit')} {unit.ap.unitNumber}
                </p>
                <h2 className="text-2xl font-display font-bold text-foreground">{unitTitle}</h2>
              </div>
              <button
                type="button"
                onClick={() => toggleUnit(unit.id)}
                className="inline-flex items-center gap-2 rounded-lg border-2 border-border bg-secondary px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:border-foreground"
              >
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                {isExpanded ? 'Hide' : 'Show'} Essential Questions
              </button>
            </div>

            {isExpanded ? (
              <ul className="mt-4 space-y-2 rounded-xl border-2 border-border bg-secondary/60 p-4 text-sm text-foreground">
                {unit.essentialQuestions.map((question, index) => (
                  <li key={`${unit.id}-q-${index}`} className="leading-relaxed">
                    {index + 1}. {getQuestionText(question, lang)}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-4 space-y-3">
              {unitModules.map((module) => (
                <button
                  key={module.id}
                  type="button"
                  onClick={() => navigate(`/app/curriculum/${module.id}`)}
                  className="w-full rounded-xl border-2 border-border bg-card p-4 text-left transition-colors hover:border-primary hover:bg-primary/5"
                >
                  <p className="text-xs font-bold uppercase tracking-wide text-primary">
                    {t('app.curriculum.moduleLabel') || 'Module'} {module.id}
                  </p>
                  <h3 className="mt-1 text-lg font-display font-bold text-foreground">
                    {getLocalizedText(module.title, lang, module.id)}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {getLocalizedText(module.moduleGoal, lang)}
                  </p>
                  {moduleTemplateSummaries.has(module.id) ? (
                    <p className="mt-1 text-xs text-primary/70">
                      Activity template: {moduleTemplateSummaries.get(module.id)}
                    </p>
                  ) : null}
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
