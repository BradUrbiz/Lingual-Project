import { useEffect, useState } from 'react';
import { getAssignmentPlanPreview, type PlanPreview } from '@/api/teacher';

export function AssignmentPlanPreview({ assignmentId }: { assignmentId: string }) {
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
        <p className="font-medium">The AI coaching engine is off for this assignment (raw prompt mode).</p>
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
      <p className="font-medium">How the AI will run this assignment</p>
      <p className="mt-1 text-muted-foreground">
        A preview of how the AI is instructed, before any per-student personalization.
      </p>
      {preview.taskType ? <p className="mt-1">Task type: <span className="font-mono">{preview.taskType}</span></p> : null}
      {preview.correctionPosture ? (
        <p className="mt-1">
          Correction posture: <span className="font-mono">{preview.correctionPosture.mode}</span>
          {' '}(elicits after {preview.correctionPosture.elicitationRepeatThreshold} repeats)
        </p>
      ) : null}
      {preview.targets?.length ? (
        <table className="mt-2 w-full text-left">
          <thead><tr><th>Target</th><th>Kind</th><th>How the AI corrects it</th></tr></thead>
          <tbody>
            {preview.targets.map((t) => (
              <tr key={`${t.kind}:${t.surface}`}>
                <td className="font-mono">{t.surface}</td><td>{t.kind}</td><td>{t.feedbackRoute}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
