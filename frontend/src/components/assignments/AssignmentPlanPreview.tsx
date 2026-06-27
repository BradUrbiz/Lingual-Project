import { useEffect, useState } from 'react';
import { getAssignmentPlanPreview, type PlanPreview, type PlanPreviewRealizedTarget, type PlanPreviewUptakeTarget } from '@/api/teacher';
import { useLanguage } from '@/contexts/LanguageContext';

export function AssignmentPlanPreview({ assignmentId, withRealized }: { assignmentId: string; withRealized?: boolean }) {
  const { t } = useLanguage();
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    getAssignmentPlanPreview(assignmentId, { realized: withRealized })
      .then((p) => { if (active) { setPreview(p); setLoaded(true); } })
      .catch(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [assignmentId, withRealized]);

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

  const realized = preview.realized ?? null;
  const realizedBySurface = new Map<string, PlanPreviewRealizedTarget>(
    (realized?.perTarget ?? []).map((r) => [`${r.kind}:${r.surface}`, r]),
  );
  const uptake = realized?.uptake ?? null;
  const uptakeBySurface = new Map<string, PlanPreviewUptakeTarget>(
    (uptake?.perTarget ?? []).map((u) => [u.surface, u]),
  );

  const realizedCell = (kind?: string, surface?: string) => {
    const r = realizedBySurface.get(`${kind}:${surface}`);
    if (!r) return null;
    if (!r.measurable) return <span className="text-muted-foreground">{t('teacher.builder.plan.notYetMeasurable')}</span>;
    const u = surface ? uptakeBySurface.get(surface) : undefined;
    return (
      <span>
        {r.hits} · {r.tier} · {r.studentsElicited}/{realized?.studentCount}
        {u ? (
          <span className="ml-2 text-muted-foreground" title={t('teacher.builder.plan.uptakeTooltip')}>
            ✋{u.afterPrompt} · 🔁{u.afterRecast} · ★{u.unprompted}
          </span>
        ) : null}
      </span>
    );
  };

  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm">
      <p className="font-medium">{realized ? t('teacher.builder.plan.titleRealized') : t('teacher.builder.plan.title')}</p>
      <p className="mt-1 text-muted-foreground">{t('teacher.builder.plan.subtitle')}</p>
      {preview.taskType ? <p className="mt-1">{t('teacher.builder.plan.taskType')} <span className="font-mono">{preview.taskType}</span></p> : null}
      {preview.correctionPosture ? (
        <p className="mt-1">
          {t('teacher.builder.plan.correctionPosture')} <span className="font-mono">{preview.correctionPosture.mode}</span>
          {' '}{t('teacher.builder.plan.elicitsAfter').replace('{n}', String(preview.correctionPosture.elicitationRepeatThreshold))}
        </p>
      ) : null}
      {realized && realized.neverElicited.length ? (
        <div data-testid="align-never-elicited" className="mt-2 rounded border border-amber-300 bg-amber-50 p-2">
          <p className="font-medium">{t('teacher.builder.plan.neverElicitedTitle')}</p>
          <ul className="list-disc pl-5">
            {realized.neverElicited.map((s) => <li key={s} className="font-mono">{s}</li>)}
          </ul>
        </div>
      ) : null}
      {uptake && uptake.totals.measured > 0 ? (
        <div data-testid="uptake-headline" className="mt-2 rounded border bg-background p-2">
          <p>
            {t('teacher.builder.plan.uptakeHeadline')
              .replace('{measured}', String(uptake.totals.measured))
              .replace('{afterPrompt}', String(uptake.totals.afterPrompt))
              .replace('{afterRecast}', String(uptake.totals.afterRecast))
              .replace('{unprompted}', String(uptake.totals.unprompted))}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t('teacher.builder.plan.uptakeCaveat')}</p>
        </div>
      ) : null}
      {preview.targets?.length ? (
        <table className="mt-2 w-full text-left">
          <thead><tr>
            <th>{t('teacher.builder.plan.tableTarget')}</th>
            <th>{t('teacher.builder.plan.tableKind')}</th>
            <th>{t('teacher.builder.plan.tableCorrection')}</th>
            {realized ? <th>{t('teacher.builder.plan.tableRealized')}</th> : null}
          </tr></thead>
          <tbody>
            {preview.targets.map((target) => (
              <tr key={`${target.kind}:${target.surface}`}>
                <td className="font-mono">{target.surface}</td><td>{target.kind}</td><td>{target.feedbackRoute}</td>
                {realized ? <td>{realizedCell(target.kind, target.surface)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
