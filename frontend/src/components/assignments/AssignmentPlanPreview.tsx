import { useEffect, useState } from 'react';
import { getAssignmentPlanPreview, type PlanPreview } from '@/api/teacher';
import { useLanguage } from '@/contexts/LanguageContext';

export function AssignmentPlanPreview({ assignmentId }: { assignmentId: string }) {
  const { t } = useLanguage();
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    getAssignmentPlanPreview(assignmentId)
      .then((p) => { if (active) { setPreview(p); setLoaded(true); } })
      .catch(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [assignmentId]);

  if (!loaded || !preview) return null;  // flag off / unavailable → render nothing

  if (preview.rawTutorMode || !preview.engineEnabled) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
        <p className="font-medium">{t('teacher.builder.plan.rawMode')}</p>
        {preview.guaranteesDisabled?.length ? (
          <ul className="mt-1 list-disc pl-5">
            {preview.guaranteesDisabled.map((g) => <li key={g}>{g}</li>)}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm">
      <p className="font-medium">{t('teacher.builder.plan.title')}</p>
      <p className="mt-1 text-muted-foreground">
        {t('teacher.builder.plan.subtitle')}
      </p>
      {preview.taskType ? <p className="mt-1">{t('teacher.builder.plan.taskType')} <span className="font-mono">{preview.taskType}</span></p> : null}
      {preview.correctionPosture ? (
        <p className="mt-1">
          {t('teacher.builder.plan.correctionPosture')} <span className="font-mono">{preview.correctionPosture.mode}</span>
          {' '}{t('teacher.builder.plan.elicitsAfter').replace('{n}', String(preview.correctionPosture.elicitationRepeatThreshold))}
        </p>
      ) : null}
      {preview.targets?.length ? (
        <table className="mt-2 w-full text-left">
          <thead><tr><th>{t('teacher.builder.plan.tableTarget')}</th><th>{t('teacher.builder.plan.tableKind')}</th><th>{t('teacher.builder.plan.tableCorrection')}</th></tr></thead>
          <tbody>
            {preview.targets.map((target) => (
              <tr key={`${target.kind}:${target.surface}`}>
                <td className="font-mono">{target.surface}</td><td>{target.kind}</td><td>{target.feedbackRoute}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
