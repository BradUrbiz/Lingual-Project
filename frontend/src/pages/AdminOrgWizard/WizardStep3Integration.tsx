import { useState } from 'react';
import type { WizardAction } from './wizardReducer';
import type {
  WizardSubmitPayload,
  CanvasIntegrationType,
  GradeRange,
  CourseFramework,
} from '@/types/schoolRequest';
import { WizardField } from './WizardField';

export interface WizardStep3Props {
  state: Partial<WizardSubmitPayload>;
  dispatch: (action: WizardAction) => void;
}

const CANVAS_TYPES: { value: CanvasIntegrationType; label: string }[] = [
  { value: 'lti13', label: 'LTI 1.3 assignment launch' },
  { value: 'roster_sync', label: 'Roster sync' },
  { value: 'grade_passback', label: 'Grade passback' },
  { value: 'sso', label: 'SSO only' },
];

const GRADE_RANGES: { value: GradeRange; label: string }[] = [
  { value: 'k_2', label: 'K–2' },
  { value: 'g3_5', label: '3–5' },
  { value: 'g6_8', label: '6–8' },
  { value: 'g9_12', label: '9–12' },
  { value: 'undergrad', label: 'Undergrad' },
  { value: 'graduate', label: 'Graduate' },
  { value: 'adult_ed', label: 'Adult Ed' },
];

const FRAMEWORKS: { value: CourseFramework; label: string }[] = [
  { value: 'ap', label: 'AP' },
  { value: 'actfl', label: 'ACTFL' },
  { value: 'cefr', label: 'CEFR' },
  { value: 'ib', label: 'IB' },
  { value: 'school_specific', label: 'School-specific' },
  { value: 'none', label: 'None' },
];

function setField(dispatch: (a: WizardAction) => void, path: string, value: unknown) {
  dispatch({ type: 'SET_FIELD', path, value });
}

function toggleInList<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function WizardStep3Integration({ state, dispatch }: WizardStep3Props) {
  const integration = state.integration;
  const [usesCanvas, setUsesCanvas] = useState<'yes' | 'no' | 'unknown' | null>(
    integration ? 'yes' : null,
  );
  // Every nested array gets its own default. The reducer's SET_FIELD on
  // `curriculum.gradeRanges` creates a partial curriculum object (with the
  // other two arrays undefined), so a top-level `state.curriculum ?? {...}`
  // wasn't enough - `.join()` / `.includes()` would crash on the undefined
  // siblings. Normalize each field defensively here, mirroring the same
  // pattern WizardStep1Organization uses for location.
  const curriculum = {
    gradeRanges: state.curriculum?.gradeRanges ?? [],
    languagesTaught: state.curriculum?.languagesTaught ?? [],
    courseFrameworks: state.curriculum?.courseFrameworks ?? [],
  };

  function chooseUsesCanvas(v: 'yes' | 'no' | 'unknown') {
    setUsesCanvas(v);
    if (v === 'yes' && !integration) {
      setField(dispatch, 'integration', { canvasUrl: '', canvasIntegrationTypes: [] });
    } else if (v !== 'yes' && integration) {
      setField(dispatch, 'integration', undefined);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Tell us how you teach. You can fill this in later from settings.
      </p>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Integration</h3>
        <fieldset>
          <legend className="text-sm font-medium">Does your school use Canvas LMS?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(['yes', 'no', 'unknown'] as const).map((opt) => (
              <label key={opt} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <input
                  type="radio"
                  name="usesCanvas"
                  aria-label={`Uses Canvas: ${opt}`}
                  checked={usesCanvas === opt}
                  onChange={() => chooseUsesCanvas(opt)}
                />
                <span className="capitalize">{opt}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {usesCanvas === 'yes' && (
          <div className="space-y-3 rounded-md border-2 border-foreground/40 bg-muted/30 p-4">
            <WizardField label="Canvas instance URL" htmlFor="canvasUrl"
                         helper="Example: ssfs.instructure.com">
              <input id="canvasUrl" aria-label="Canvas instance URL" type="text"
                     className="w-full rounded-md border px-3 py-2"
                     value={integration?.canvasUrl ?? ''}
                     onChange={(e) => setField(dispatch, 'integration.canvasUrl', e.target.value)} />
            </WizardField>
            <WizardField label="Integration types">
              <div className="space-y-1.5">
                {CANVAS_TYPES.map(({ value, label }) => (
                  <label key={value} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      aria-label={label}
                      checked={integration?.canvasIntegrationTypes?.includes(value) ?? false}
                      onChange={() =>
                        setField(dispatch, 'integration.canvasIntegrationTypes',
                          toggleInList(integration?.canvasIntegrationTypes ?? [], value))
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </WizardField>
          </div>
        )}
        {(usesCanvas === 'no' || usesCanvas === 'unknown') && (
          <p className="text-xs text-muted-foreground">
            Google Classroom and Schoology support coming soon.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Curriculum</h3>

        <WizardField label="Target student grade range">
          <div className="flex flex-wrap gap-2">
            {GRADE_RANGES.map(({ value, label }) => {
              const active = curriculum.gradeRanges.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    setField(dispatch, 'curriculum.gradeRanges',
                      toggleInList(curriculum.gradeRanges, value))
                  }
                  className={
                    'rounded-full border px-3 py-1 text-sm ' +
                    (active ? 'bg-foreground text-background' : '')
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </WizardField>

        <WizardField label="Languages taught" htmlFor="languages"
                     helper="Comma-separated ISO codes (es, fr, ko, etc.)">
          <input
            id="languages"
            aria-label="Languages taught"
            type="text"
            className="w-full rounded-md border px-3 py-2"
            value={curriculum.languagesTaught.join(', ')}
            onChange={(e) =>
              setField(dispatch, 'curriculum.languagesTaught',
                e.target.value.split(',').flatMap((s) => {
                  const value = s.trim().toLowerCase();
                  return value ? [value] : [];
                }))
            }
          />
        </WizardField>

        <WizardField label="Course frameworks">
          <div className="flex flex-wrap gap-2">
            {FRAMEWORKS.map(({ value, label }) => {
              const active = curriculum.courseFrameworks.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    setField(dispatch, 'curriculum.courseFrameworks',
                      toggleInList(curriculum.courseFrameworks, value))
                  }
                  className={
                    'rounded-full border px-3 py-1 text-sm ' +
                    (active ? 'bg-foreground text-background' : '')
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </WizardField>
      </section>
    </div>
  );
}
