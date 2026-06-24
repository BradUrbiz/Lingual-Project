# L8 Teacher Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the engine's compiled prompt-plan ("the compiler's first inference") to teachers in the assignment builder via a read-only, flag-gated endpoint + panel — closing the §14 L8 gap.

**Architecture:** A teacher endpoint resolves the assignment bootstrap (teacher-auth path), compiles the base plan (no per-student coverage/affect), and returns the existing `serialize_plan_preview` output. The assignment builder renders it in a "How the AI will run this" panel. Behind `PEDAGOGY_ENGINE_TEACHER_PREVIEW` (default off), mirroring the S4.2 debrief. Reuses `compile_prompt_plan` + `serialize_plan_preview` + `resolve_assignment_bootstrap_for_user` + `_require_assignment_teacher_access` — no new engine logic, no persistence.

**Tech Stack:** Python 3 / Flask (`unittest`), React 19 + TypeScript + Vitest, Cloud Run `cloudbuild.yaml`.

## Global Constraints

- **Flag** `PEDAGOGY_ENGINE_TEACHER_PREVIEW`; `teacher_preview_enabled()` reads `os.environ.get("PEDAGOGY_ENGINE_TEACHER_PREVIEW", "").strip().lower() in _TRUTHY` (mirror the other `*_enabled` helpers in `integration.py`). Default off.
- **Flag off ⇒ byte-equivalent:** the endpoint returns `{success: False, teacherPreviewEnabled: False, planPreview: None}` with **no bootstrap resolve / no compile**; the frontend hides the panel. No behavior change when off.
- **Read-only, no persistence, no live-path touch:** new endpoint + new UI only. Do NOT change `serialize_plan_preview`'s shape, the existing internal `_assignment_recycling_snapshot` consumer, or any student/session path.
- **Base plan only:** `compile_prompt_plan(bootstrap)` with NO `coverage_state`/`affect_state` (the student-independent preview). Do not thread per-student coverage/affect into the preview.
- **Fail-soft:** any resolve/compile exception logs and returns `planPreview: None` with `success: True` — never 500. Auth failures surface as 403 (`SchoolContextPermissionError`) / 404 (`ValueError`) via `_require_assignment_teacher_access`.
- **cloudbuild `--set-env-vars` is REPLACE:** new var in BOTH the line-60 string AND the substitutions block, default `'0'`; no other substitution default changes.
- **Commits:** NO `Co-Authored-By` trailer / no attribution. Commit to `main`; do not auto-branch.

---

### Task 1: `teacher_preview_enabled()` flag helper

**Files:**
- Modify: `backend/services/pedagogy/integration.py`
- Test: `backend/tests/test_pedagogy_integration_flags.py` (create if absent; else append) — OR co-locate in an existing integration-flags test. If unsure, create `backend/tests/test_teacher_preview_flag.py`.

**Interfaces:**
- Produces: `teacher_preview_enabled() -> bool` in `backend.services.pedagogy.integration`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_teacher_preview_flag.py`:

```python
import os
import unittest
from unittest import mock

from backend.services.pedagogy.integration import teacher_preview_enabled


class TeacherPreviewFlagTests(unittest.TestCase):
    def test_default_off(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PEDAGOGY_ENGINE_TEACHER_PREVIEW", None)
            self.assertFalse(teacher_preview_enabled())

    def test_truthy_values_on(self):
        for val in ("1", "true", "YES", "on"):
            with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_TEACHER_PREVIEW": val}):
                self.assertTrue(teacher_preview_enabled())


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_teacher_preview_flag -v`
Expected: FAIL — `ImportError: cannot import name 'teacher_preview_enabled'`.

- [ ] **Step 3: Implement**

In `backend/services/pedagogy/integration.py`, after `debrief_enabled()` (or alongside the other `*_enabled` helpers), add:

```python
def teacher_preview_enabled() -> bool:
    """L8 Teacher Preview — read-only teacher view of the compiled prompt plan.
    Default off; read-only/additive (no live-path effect)."""
    return os.environ.get("PEDAGOGY_ENGINE_TEACHER_PREVIEW", "").strip().lower() in _TRUTHY
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_teacher_preview_flag -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/services/pedagogy/integration.py backend/tests/test_teacher_preview_flag.py
git commit -m "feat(pedagogy-l8): teacher_preview_enabled() flag helper"
```

---

### Task 2: Backend endpoint `GET /api/teacher/assignments/<id>/plan-preview`

**Files:**
- Modify: `backend/routes/curriculum_admin.py` (new route; import `teacher_preview_enabled`, `compile_prompt_plan`, `serialize_plan_preview`)
- Test: `backend/tests/test_teacher_plan_preview_route.py` (new)

**Interfaces:**
- Consumes: `teacher_preview_enabled()` (Task 1), `_require_assignment_teacher_access(deps, assignment_id)` (existing), `resolve_assignment_bootstrap_for_user` (existing), `compile_prompt_plan`/`serialize_plan_preview` (existing).
- Produces: `GET /api/teacher/assignments/<assignment_id>/plan-preview` → `{success, teacherPreviewEnabled, planPreview}`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_teacher_plan_preview_route.py` (mirror the coach-chip route test harness — `RouteDeps` + a Flask app with the blueprint; mock the resolver + compile/serialize to isolate the route logic):

```python
import os
import unittest
from unittest import mock

from flask import Flask, session

from backend.route_deps import RouteDeps
from backend.routes.curriculum_admin import create_curriculum_admin_blueprint


def _passthrough(func):
    return func


class _Db:
    pass


def _deps():
    return RouteDeps(
        db=_Db(), firebase_auth=None,
        get_current_user_uid=lambda: (session.get('user') or {}).get('uid'),
        get_openai_client=lambda: None, get_assessment=lambda: {},
        compute_results=lambda *a, **k: {}, get_proficiency_description=lambda *a, **k: {},
        login_required=_passthrough, get_user_proficiency_context=lambda: '',
        build_system_prompt=lambda _c: '', get_school_request_context=lambda: None,
        set_active_school_membership=lambda *a, **k: None,
        allowed_learning_locales={'es-ES'}, allowed_minigame_types=set(),
        supported_ui_languages={'en'}, audit_logger=None,
    )


def _app():
    app = Flask(__name__)
    app.secret_key = 'test'
    app.register_blueprint(create_curriculum_admin_blueprint(_deps()))
    return app


def _login(client, uid='teacher-1'):
    with client.session_transaction() as s:
        s['user'] = {'uid': uid}


_ENGINE_PREVIEW = {
    'engineEnabled': True, 'rawTutorMode': False, 'taskType': 'information_gap',
    'correctionPosture': {'mode': 'balanced', 'recastDefault': True, 'elicitationRepeatThreshold': 2},
    'targets': [{'surface': 'la cuenta', 'kind': 'expression', 'feedbackRoute': 'recast'}],
}


class TeacherPlanPreviewRouteTests(unittest.TestCase):
    def test_flag_off_returns_disabled_without_resolving(self):
        resolver = mock.patch('backend.routes.curriculum_admin.resolve_assignment_bootstrap_for_user')
        m = resolver.start()
        self.addCleanup(resolver.stop)
        client = _app().test_client()
        _login(client)
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop('PEDAGOGY_ENGINE_TEACHER_PREVIEW', None)
            resp = client.get('/api/teacher/assignments/a1/plan-preview')
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertFalse(body['teacherPreviewEnabled'])
        self.assertIsNone(body['planPreview'])
        m.assert_not_called()  # flag-off does NOT resolve a bootstrap

    def test_flag_on_returns_engine_preview(self):
        with mock.patch.dict(os.environ, {'PEDAGOGY_ENGINE_TEACHER_PREVIEW': '1'}), \
             mock.patch('backend.routes.curriculum_admin._require_assignment_teacher_access'), \
             mock.patch('backend.routes.curriculum_admin.resolve_assignment_bootstrap_for_user', return_value={'mapping': {}}), \
             mock.patch('backend.routes.curriculum_admin.compile_prompt_plan', return_value=object()), \
             mock.patch('backend.routes.curriculum_admin.serialize_plan_preview', return_value=_ENGINE_PREVIEW):
            client = _app().test_client()
            _login(client)
            resp = client.get('/api/teacher/assignments/a1/plan-preview')
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertTrue(body['teacherPreviewEnabled'])
        self.assertEqual(body['planPreview'], _ENGINE_PREVIEW)

    def test_fail_soft_on_resolver_error(self):
        with mock.patch.dict(os.environ, {'PEDAGOGY_ENGINE_TEACHER_PREVIEW': '1'}), \
             mock.patch('backend.routes.curriculum_admin._require_assignment_teacher_access'), \
             mock.patch('backend.routes.curriculum_admin.resolve_assignment_bootstrap_for_user', side_effect=RuntimeError('boom')):
            client = _app().test_client()
            _login(client)
            resp = client.get('/api/teacher/assignments/a1/plan-preview')
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertTrue(body['teacherPreviewEnabled'])
        self.assertIsNone(body['planPreview'])  # fail-soft, no 500

    def test_non_teacher_403(self):
        from backend.routes.curriculum_admin import SchoolContextPermissionError
        with mock.patch.dict(os.environ, {'PEDAGOGY_ENGINE_TEACHER_PREVIEW': '1'}), \
             mock.patch('backend.routes.curriculum_admin._require_assignment_teacher_access',
                        side_effect=SchoolContextPermissionError('no')):
            client = _app().test_client()
            _login(client)
            resp = client.get('/api/teacher/assignments/a1/plan-preview')
        self.assertEqual(resp.status_code, 403)
```

> Implementer: confirm `SchoolContextPermissionError` and `ValueError` are the exceptions `_require_assignment_teacher_access` raises (the S4.2 debrief route catches exactly these → 403/404). Import `SchoolContextPermissionError` from wherever the debrief route imports it. If the RouteDeps constructor signature differs, copy the exact kwargs from `backend/tests/test_curriculum_admin_coach_chip_route.py`'s `_deps`.

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_teacher_plan_preview_route -v`
Expected: FAIL — route 404 (not registered yet).

- [ ] **Step 3: Implement**

In `backend/routes/curriculum_admin.py`:
- Ensure imports near the top: `from backend.services.pedagogy.integration import ... teacher_preview_enabled` (add to the existing integration import or import inline), and `from backend.services.pedagogy.plan import compile_prompt_plan, serialize_plan_preview`. (`resolve_assignment_bootstrap_for_user` and `_require_assignment_teacher_access` are already in this module.)
- Add the route (mirror the debrief route's flag-gate → try → auth → inner-try fail-soft → except 403/404 shape), placed near the other teacher routes:

```python
    @bp.route('/api/teacher/assignments/<assignment_id>/plan-preview', methods=['GET'])
    @deps.login_required
    def api_get_assignment_plan_preview(assignment_id):
        # Flag gate first: flag-off does minimal work (no bootstrap resolve / compile).
        if not teacher_preview_enabled():
            return jsonify({'success': False, 'teacherPreviewEnabled': False, 'planPreview': None}), 200
        try:
            # assignment -> class -> teacher access (403/404 as usual).
            _require_assignment_teacher_access(deps, assignment_id)
            try:
                uid = deps.get_current_user_uid()
                bootstrap = resolve_assignment_bootstrap_for_user(
                    deps,
                    uid=uid,
                    context=deps.get_school_request_context(),
                    assignment_id=assignment_id,
                    ui_language='en',
                )
                # Base plan: NO coverage/affect — the student-independent
                # "compiler's first inference" the teacher sees at authoring time.
                preview = serialize_plan_preview(compile_prompt_plan(bootstrap))
            except Exception:
                logger.exception('plan-preview assembly failed; returning null preview '
                                 '(assignment_id=%s)', assignment_id)
                preview = None
            return jsonify({'success': True, 'teacherPreviewEnabled': True, 'planPreview': preview})
        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403
        except ValueError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 404
```

> If `teacher_preview_enabled` is not already imported at module top, either add it to the existing `from backend.services.pedagogy.integration import (...)` group or do a function-local import (mirror how `debrief_enabled` is imported in this file).

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_teacher_plan_preview_route -v`
Expected: PASS (flag-off / engine-preview / fail-soft / 403 cases).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/curriculum_admin.py backend/tests/test_teacher_plan_preview_route.py
git commit -m "feat(pedagogy-l8): teacher plan-preview endpoint (compile-on-read, fail-soft, flag-gated)"
```

---

### Task 3: Frontend — `getAssignmentPlanPreview` + builder preview panel

**Files:**
- Modify: `frontend/src/api/teacher.ts` (add `getAssignmentPlanPreview` + `PlanPreview` type)
- Create: `frontend/src/components/assignments/AssignmentPlanPreview.tsx`
- Modify: `frontend/src/pages/TeacherAssignmentBuilderPage.tsx` (mount the panel in the per-assignment card actions)
- Test: `frontend/src/components/assignments/AssignmentPlanPreview.test.tsx`

**Interfaces:**
- Consumes: `GET /api/teacher/assignments/<id>/plan-preview` (Task 2).
- Produces: `getAssignmentPlanPreview(assignmentId): Promise<PlanPreview | null>`; an `AssignmentPlanPreview` component that fetches + renders the preview, hiding itself when disabled.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/assignments/AssignmentPlanPreview.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssignmentPlanPreview } from './AssignmentPlanPreview';

const getAssignmentPlanPreviewMock = vi.fn();
vi.mock('@/api/teacher', () => ({
  getAssignmentPlanPreview: (...a: unknown[]) => getAssignmentPlanPreviewMock(...a),
}));

describe('AssignmentPlanPreview', () => {
  beforeEach(() => getAssignmentPlanPreviewMock.mockReset());

  it('renders the engine preview (task type + a target route)', async () => {
    getAssignmentPlanPreviewMock.mockResolvedValue({
      engineEnabled: true, rawTutorMode: false, taskType: 'information_gap',
      correctionPosture: { mode: 'balanced', recastDefault: true, elicitationRepeatThreshold: 2 },
      targets: [{ surface: 'la cuenta', kind: 'expression', feedbackRoute: 'recast' }],
    });
    render(<AssignmentPlanPreview assignmentId="a1" />);
    await waitFor(() => expect(screen.getByText(/la cuenta/)).toBeInTheDocument());
    expect(screen.getByText(/information_gap/)).toBeInTheDocument();
  });

  it('renders the raw-mode notice with disabled guarantees', async () => {
    getAssignmentPlanPreviewMock.mockResolvedValue({
      engineEnabled: false, rawTutorMode: true,
      guaranteesDisabled: ['target elicitation', 'feedback routing'],
    });
    render(<AssignmentPlanPreview assignmentId="a1" />);
    await waitFor(() => expect(screen.getByText(/engine is off|raw/i)).toBeInTheDocument());
    expect(screen.getByText(/target elicitation/)).toBeInTheDocument();
  });

  it('renders nothing when the preview is null (flag off / unavailable)', async () => {
    getAssignmentPlanPreviewMock.mockResolvedValue(null);
    const { container } = render(<AssignmentPlanPreview assignmentId="a1" />);
    await waitFor(() => expect(getAssignmentPlanPreviewMock).toHaveBeenCalled());
    expect(container.textContent ?? '').not.toMatch(/information_gap|engine is off/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- --run src/components/assignments/AssignmentPlanPreview.test.tsx`
Expected: FAIL — module `./AssignmentPlanPreview` does not exist.

- [ ] **Step 3: Implement the API client**

In `frontend/src/api/teacher.ts`, add (mirror `getSessionDebrief`'s success→null pattern):

```typescript
export interface PlanPreviewTarget {
  surface: string;
  kind: string;
  feedbackRoute: string;
}

export interface PlanPreview {
  engineEnabled: boolean;
  rawTutorMode: boolean;
  taskType?: string;
  correctionPosture?: { mode: string; recastDefault: boolean; elicitationRepeatThreshold: number };
  targets?: PlanPreviewTarget[];
  recycling?: unknown;
  guaranteesDisabled?: string[];
}

export const getAssignmentPlanPreview = async (assignmentId: string): Promise<PlanPreview | null> => {
  const response = await api.get<{ success: boolean; teacherPreviewEnabled: boolean; planPreview?: PlanPreview | null }>(
    `/teacher/assignments/${assignmentId}/plan-preview`,
  );
  return response.data.success && response.data.teacherPreviewEnabled ? (response.data.planPreview ?? null) : null;
};
```

- [ ] **Step 4: Implement the component**

Create `frontend/src/components/assignments/AssignmentPlanPreview.tsx`:

```tsx
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
```

- [ ] **Step 5: Mount the panel in the assignment builder**

In `frontend/src/pages/TeacherAssignmentBuilderPage.tsx`, import `AssignmentPlanPreview` and render it inside each assignment card (near the existing per-assignment "View analytics" / "Preview" actions, around the card body). Use a collapsible/expandable trigger (the codebase's existing pattern — a toggle button revealing the panel) so it does not auto-fetch for every card on first paint; on first expand, render `<AssignmentPlanPreview assignmentId={assignment.id} />`. Keep it minimal and consistent with the card's existing styling. (The component renders nothing when the flag is off, so mounting it is safe regardless of flag state.)

- [ ] **Step 6: Run tests + build**

Run: `cd frontend && npm run test -- --run src/components/assignments/AssignmentPlanPreview.test.tsx`
Expected: PASS
Run: `cd frontend && npm run build`
Expected: `tsc -b` clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/teacher.ts frontend/src/components/assignments/AssignmentPlanPreview.tsx frontend/src/pages/TeacherAssignmentBuilderPage.tsx frontend/src/components/assignments/AssignmentPlanPreview.test.tsx
git commit -m "feat(pedagogy-l8): assignment plan-preview API + builder panel"
```

---

### Task 4: cloudbuild flag + doc-sync + full-suite verification

**Files:**
- Modify: `cloudbuild.yaml`, `backend/CLAUDE.md`, `docs/school-integration/LIMITATIONS.md`, `docs/school-integration/Pedagogy Engineering/PEDAGOGY_ENGINE.md`
- (verify) backend + frontend suites

**Interfaces:**
- Consumes: the `PEDAGOGY_ENGINE_TEACHER_PREVIEW` flag (Task 1).

- [ ] **Step 1: cloudbuild — add the var to BOTH places**

In `cloudbuild.yaml` line 60 (`--set-env-vars`), append after `PEDAGOGY_ENGINE_DIRECTOR=${_PEDAGOGY_ENGINE_DIRECTOR}`:
```
,PEDAGOGY_ENGINE_TEACHER_PREVIEW=${_PEDAGOGY_ENGINE_TEACHER_PREVIEW}
```
In the `substitutions:` block, after `_PEDAGOGY_ENGINE_DIRECTOR: '0'`, add:
```yaml
  # L8 Teacher Preview — read-only teacher view of the compiled prompt plan
  # (L8_TEACHER_PREVIEW design). '0' = endpoint returns teacherPreviewEnabled:false, panel hidden,
  # builder byte-equivalent to today. Flip via --update-env-vars PEDAGOGY_ENGINE_TEACHER_PREVIEW=1.
  _PEDAGOGY_ENGINE_TEACHER_PREVIEW: '0'
```

- [ ] **Step 2: Verify REPLACE-safety**

Run: `grep -c "PEDAGOGY_ENGINE_TEACHER_PREVIEW" cloudbuild.yaml`
Expected: `3` (set-env-vars string + the comment line + the substitution — matching the `DIRECTOR`/`DEBRIEF` pattern). Confirm by eye no other substitution default changed.

- [ ] **Step 3: Docs**

- `backend/CLAUDE.md`: in the pedagogy section, add `teacher_preview_enabled()` to the flag-helpers list and a short note for the new endpoint (`GET /api/teacher/assignments/<id>/plan-preview` — read-only L8 preview of `serialize_plan_preview(compile_prompt_plan(bootstrap))`, teacher-auth, fail-soft, flag `PEDAGOGY_ENGINE_TEACHER_PREVIEW` default `'0'`). Mirror the S4.2 debrief wording.
- `docs/school-integration/LIMITATIONS.md`: add an entry — "L8 Teacher Preview BUILT behind `PEDAGOGY_ENGINE_TEACHER_PREVIEW` (default off), NOT cut over. Surfaces the BASE plan only (`serialize_plan_preview`: engine on/off, task type, correction posture, target→feedback-route, raw-mode guarantees-disabled); per-student recycling/affect and the language-mix/scenario enrichment are deferred follow-ups. Live compile-on-read, no persistence."
- `docs/school-integration/Pedagogy Engineering/PEDAGOGY_ENGINE.md`: in the §14 governance note that mentions "L8 Teacher Preview rides with S1," append: "L8 Teacher Preview surfaced 2026-06-24 — read-only builder panel of the compiled plan behind `PEDAGOGY_ENGINE_TEACHER_PREVIEW` (default off)."

- [ ] **Step 4: Full suites + commit**

Run: `make test-backend`
Expected: PASS
Run: `cd frontend && npm run test -- --run`
Expected: PASS

```bash
git add cloudbuild.yaml backend/CLAUDE.md docs/school-integration/LIMITATIONS.md "docs/school-integration/Pedagogy Engineering/PEDAGOGY_ENGINE.md"
git commit -m "chore(pedagogy-l8): deploy teacher-preview inert (cloudbuild default 0) + doc-sync"
```

---

## Self-Review

**1. Spec coverage:**
- Flag `teacher_preview_enabled()` → Task 1 ✓
- Backend endpoint (flag-gate → teacher-auth → resolve → base compile → serialize → fail-soft, 403/404) → Task 2 ✓
- Frontend api + panel (engine preview, raw-mode notice, hidden when disabled) → Task 3 ✓
- cloudbuild inert default + docs + §14 note → Task 4 ✓
- Base plan only (no coverage/affect) → Task 2 code + Global Constraints ✓
- Read-only / no persistence / serializer-shape unchanged → Global Constraints ✓
- Non-goals (no serializer enrichment, no persistence, no per-student personalization) → Global Constraints + Task 4 LIMITATIONS ✓

**2. Placeholder scan:** No TBD/TODO. Backend route + tests, frontend api + component + tests are complete code. The only prose-directed step is Task 3 Step 5 (mounting the panel in the large builder file) — the WHERE (per-card actions, collapsible) and the WHAT (`<AssignmentPlanPreview assignmentId={assignment.id} />`, renders nothing when disabled) are explicit; the exact JSX insertion point is left to the implementer reading the file, which is appropriate for a large existing page.

**3. Type consistency:** `getAssignmentPlanPreview(assignmentId): Promise<PlanPreview | null>` consistent across Task 3 api + component + test. `PlanPreview` fields match `serialize_plan_preview`'s output (engineEnabled, rawTutorMode, taskType, correctionPosture{mode,recastDefault,elicitationRepeatThreshold}, targets[{surface,kind,feedbackRoute}], guaranteesDisabled). Endpoint response `{success, teacherPreviewEnabled, planPreview}` consistent between Task 2 (route) and Task 3 (api client reads `success && teacherPreviewEnabled` → `planPreview`). `teacher_preview_enabled()` consistent Task 1 def + Task 2 use.
