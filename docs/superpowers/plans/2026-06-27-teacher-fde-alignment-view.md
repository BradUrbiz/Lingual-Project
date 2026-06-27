# Task–Target Alignment View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show teachers the gap between the targets they designed and what the AI conversation actually elicited, as a "realized" overlay on the existing assignment plan-preview.

**Architecture:** A new pure join module (`pedagogy/alignment.py`) joins the plan's *intended* targets with class-aggregate *realized* hit-counts (reusing S2 `coverage.py` tiering). The plan-preview route gains a `?realized=1` branch that aggregates the assignment's sessions and attaches a `realized` block, behind a new flag. The existing `AssignmentPlanPreview` component gains a realized column + a "never-elicited" callout in review mode.

**Tech Stack:** Python 3 / Flask (backend, `unittest`), React 19 + TypeScript + Vite (frontend, Vitest).

**Spec:** `docs/superpowers/specs/2026-06-27-teacher-fde-alignment-view-design.md`

## Global Constraints

- **Import boundary (invariant 7a):** `backend/services/pedagogy/alignment.py` imports stdlib + sibling pure pedagogy modules ONLY — no `openai`, no `canvas`, no `assignment_resolver`, no `*.compliance`. Enforced by `test_pedagogy_engine_s1.ImportBoundaryTestCase`.
- **Flag default OFF, REPLACE-safe:** new flag `PEDAGOGY_ENGINE_ALIGNMENT_VIEW` defaults `'0'`; cloudbuild substitution default `'0'` must match the absent/off live value before any build.
- **Read-only / additive:** no change to runtime tutor behavior. Flag-off and the no-`realized` (builder) call path must be byte-identical to today.
- **Fail-soft:** any error in the realized branch ⇒ `realized: null`, logged, never a 500.
- **Realized tier vocabulary** is the existing `CoverageState` per-target tier: `not_attempted` / `emerging` / `solid` (frontend relabels for teachers).
- **Measurable kinds:** only `expression` and `vocabulary` have realized hit-data. `grammar_rule` and `objective` are `measurable: false` (hits/tier/studentsElicited = null).
- Backend tests run via `make test-backend` (`python3 -m unittest discover -s backend/tests -p "test_*.py"`). Frontend via `cd frontend && npm run test -- --run <file>`.
- New i18n keys go in BOTH `frontend/src/i18n/en.json` and `ko.json` (parity test enforces it).

---

### Task 1: Pure `build_alignment` join module

**Files:**
- Create: `backend/services/pedagogy/alignment.py`
- Test: `backend/tests/test_pedagogy_alignment.py`

**Interfaces:**
- Consumes: `backend.services.pedagogy.coverage.compute_coverage_state`, `CoverageState` (existing).
- Produces: `build_alignment(plan_targets: list[dict], realized_input: dict) -> dict` — the `realized` block. `plan_targets` is `serialize_plan_preview(plan)["targets"]` (`[{"surface","kind","feedbackRoute"}, ...]`). `realized_input` is `{"hit_counts": {surface:int}, "students_elicited": {surface:int}, "student_count": int, "session_count": int}`. Output shape: `{studentCount, sessionCount, perTarget:[{surface,kind,measurable,hits,tier,studentsElicited}], neverElicited:[surface], alignmentRate:{measurableTargetCount,elicitedCount,solidCount}}`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_pedagogy_alignment.py`:

```python
import unittest

from backend.services.pedagogy.alignment import build_alignment


def _targets():
    return [
        {"surface": "Me siento ___ cuando ___", "kind": "expression", "feedbackRoute": "recast_first"},
        {"surface": "Conozco a gente que ___", "kind": "expression", "feedbackRoute": "recast_first"},
        {"surface": "relaciones", "kind": "vocabulary", "feedbackRoute": "recast_first"},
        {"surface": "subjuntivo adjetival", "kind": "grammar_rule", "feedbackRoute": "prompt_first"},
        {"surface": "defend a preference", "kind": "objective", "feedbackRoute": "recast_first"},
    ]


class BuildAlignmentTestCase(unittest.TestCase):
    def _realized(self):
        return {
            "hit_counts": {"Me siento ___ cuando ___": 5, "Conozco a gente que ___": 0, "relaciones": 2},
            "students_elicited": {"Me siento ___ cuando ___": 4, "Conozco a gente que ___": 0, "relaciones": 3},
            "student_count": 6,
            "session_count": 8,
        }

    def test_lexical_targets_join_hits_tier_students(self):
        out = build_alignment(_targets(), self._realized())
        by = {t["surface"]: t for t in out["perTarget"]}
        solid = by["Me siento ___ cuando ___"]
        self.assertEqual(solid["measurable"], True)
        self.assertEqual(solid["hits"], 5)
        self.assertEqual(solid["tier"], "solid")
        self.assertEqual(solid["studentsElicited"], 4)
        self.assertEqual(by["relaciones"]["tier"], "emerging")  # 2 hits -> emerging

    def test_never_elicited_lists_zero_hit_lexical_targets(self):
        out = build_alignment(_targets(), self._realized())
        self.assertEqual(out["neverElicited"], ["Conozco a gente que ___"])
        self.assertEqual(by_surface(out, "Conozco a gente que ___")["tier"], "not_attempted")

    def test_grammar_and_objective_are_not_measurable(self):
        out = build_alignment(_targets(), self._realized())
        gram = by_surface(out, "subjuntivo adjetival")
        self.assertEqual(gram["measurable"], False)
        self.assertIsNone(gram["hits"])
        self.assertIsNone(gram["tier"])
        self.assertIsNone(gram["studentsElicited"])
        self.assertEqual(by_surface(out, "defend a preference")["measurable"], False)

    def test_alignment_rate_counts_measurable_only(self):
        out = build_alignment(_targets(), self._realized())
        self.assertEqual(out["alignmentRate"]["measurableTargetCount"], 3)
        self.assertEqual(out["alignmentRate"]["elicitedCount"], 2)   # 2 of 3 lexical had >=1 hit
        self.assertEqual(out["alignmentRate"]["solidCount"], 1)
        self.assertEqual(out["studentCount"], 6)
        self.assertEqual(out["sessionCount"], 8)

    def test_empty_realized_input_degrades_without_raising(self):
        out = build_alignment(_targets(), {})
        self.assertEqual(out["studentCount"], 0)
        self.assertEqual(out["sessionCount"], 0)
        # all lexical fall to not_attempted -> never elicited; grammar/obj stay not measurable
        self.assertEqual(set(out["neverElicited"]),
                         {"Me siento ___ cuando ___", "Conozco a gente que ___", "relaciones"})


def by_surface(out, surface):
    return next(t for t in out["perTarget"] if t["surface"] == surface)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_pedagogy_alignment -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.services.pedagogy.alignment'`

- [ ] **Step 3: Write minimal implementation**

Create `backend/services/pedagogy/alignment.py`:

```python
"""Task–Target Alignment join (Teacher FDE Phase 1, pure).

Import boundary (invariant 7a): stdlib + sibling pure pedagogy modules only.
Joins the plan's INTENDED targets with class-aggregate REALIZED hit-counts and
emits the teacher-facing ``realized`` block. The DB read + per-session aggregation
happens in the analytics/route layer; this module receives plain counts.
"""

from __future__ import annotations

from typing import Any

from backend.services.pedagogy.coverage import compute_coverage_state

_MEASURABLE_KINDS = {"expression", "vocabulary"}


def build_alignment(plan_targets: list[dict], realized_input: dict) -> dict[str, Any]:
    """Join intended ``plan_targets`` with ``realized_input``. Total / no-raise."""
    plan_targets = plan_targets or []
    realized_input = realized_input or {}
    hit_counts = realized_input.get("hit_counts") or {}
    students_elicited = realized_input.get("students_elicited") or {}
    student_count = int(realized_input.get("student_count") or 0)
    session_count = int(realized_input.get("session_count") or 0)

    lexical_surfaces = [
        t.get("surface") for t in plan_targets if t.get("kind") in _MEASURABLE_KINDS
    ]
    coverage = compute_coverage_state(lexical_surfaces, hit_counts, {}, max(session_count, 1))
    tier_by_surface = {tc.surface: tc.tier for tc in coverage.per_target}
    hits_by_surface = {tc.surface: tc.hits for tc in coverage.per_target}

    per_target: list[dict] = []
    never: list[str] = []
    measurable_count = elicited_count = solid_count = 0
    for t in plan_targets:
        surface = t.get("surface")
        kind = t.get("kind")
        if kind in _MEASURABLE_KINDS:
            measurable_count += 1
            hits = int(hits_by_surface.get(surface, 0))
            tier = tier_by_surface.get(surface, "not_attempted")
            if hits > 0:
                elicited_count += 1
            else:
                never.append(surface)
            if tier == "solid":
                solid_count += 1
            per_target.append({
                "surface": surface, "kind": kind, "measurable": True,
                "hits": hits, "tier": tier,
                "studentsElicited": int((students_elicited or {}).get(surface, 0)),
            })
        else:
            per_target.append({
                "surface": surface, "kind": kind, "measurable": False,
                "hits": None, "tier": None, "studentsElicited": None,
            })

    return {
        "studentCount": student_count,
        "sessionCount": session_count,
        "perTarget": per_target,
        "neverElicited": never,
        "alignmentRate": {
            "measurableTargetCount": measurable_count,
            "elicitedCount": elicited_count,
            "solidCount": solid_count,
        },
    }
```

Note: we pass `max(session_count, 1)` so `compute_coverage_state` does not short-circuit to empty on its `prior_session_count == 0` guard (we want per-target tiers even on the empty-input test).

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_pedagogy_alignment -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/services/pedagogy/alignment.py backend/tests/test_pedagogy_alignment.py
git commit -m "feat(pedagogy): pure build_alignment join (Teacher FDE alignment view)"
```

---

### Task 2: Pure realized-input aggregator + import-boundary guard

**Files:**
- Modify: `backend/services/practice_analytics.py` (add `build_assignment_realized_input` near `build_assignment_coverage_input` ~line 2310)
- Modify: `backend/tests/test_pedagogy_engine_s1.py:198-219` (add `alignment` to the import-boundary probe)
- Test: `backend/tests/test_pedagogy_alignment.py` (add a class)

**Interfaces:**
- Produces: `build_assignment_realized_input(sessions: list[dict] | None, target_surfaces: list[str]) -> dict` returning `{"hit_counts":{surface:int}, "students_elicited":{surface:int}, "student_count":int, "session_count":int}`. Reuses existing module helpers `normalize_session_summary` and `_normalize_string`.

- [ ] **Step 1: Write the failing test** (append to `backend/tests/test_pedagogy_alignment.py`)

```python
from backend.services.practice_analytics import build_assignment_realized_input


class BuildAssignmentRealizedInputTestCase(unittest.TestCase):
    def _sessions(self):
        return [
            {"student_uid": "s1", "session_summary": {
                "target_expression_hits": {"hola": 2}, "target_vocabulary_hits": {"casa": 1}}},
            {"student_uid": "s2", "session_summary": {
                "target_expression_hits": {"hola": 1}, "target_vocabulary_hits": {}}},
            {"student_uid": "s1", "session_summary": {
                "target_expression_hits": {"hola": 0}, "target_vocabulary_hits": {"casa": 3}}},
        ]

    def test_aggregates_hits_distinct_students_and_counts(self):
        out = build_assignment_realized_input(self._sessions(), ["hola", "casa", "adios"])
        self.assertEqual(out["hit_counts"], {"hola": 3, "casa": 4, "adios": 0})
        self.assertEqual(out["students_elicited"], {"hola": 2, "casa": 1, "adios": 0})  # casa only s1
        self.assertEqual(out["student_count"], 2)   # s1, s2 distinct
        self.assertEqual(out["session_count"], 3)

    def test_empty_sessions(self):
        out = build_assignment_realized_input([], ["hola"])
        self.assertEqual(out, {"hit_counts": {"hola": 0}, "students_elicited": {"hola": 0},
                               "student_count": 0, "session_count": 0})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_pedagogy_alignment.BuildAssignmentRealizedInputTestCase -v`
Expected: FAIL — `ImportError: cannot import name 'build_assignment_realized_input'`

- [ ] **Step 3: Write minimal implementation** (add to `backend/services/practice_analytics.py`, just after `build_assignment_coverage_input`)

```python
def build_assignment_realized_input(
    sessions: list[dict[str, Any]] | None,
    target_surfaces: list[str],
) -> dict[str, Any]:
    """Aggregate the class's realized signal for an assignment into plain counts.

    Pure: caller fetches ``sessions`` first. For each lexical target surface:
    total hits across sessions, and the count of DISTINCT students with >=1 hit.
    """
    surfaces = list(target_surfaces or [])
    hit_counts: dict[str, int] = {s: 0 for s in surfaces}
    elicited: dict[str, set] = {s: set() for s in surfaces}
    student_ids: set = set()
    session_count = 0
    for session in sessions or []:
        session_count += 1
        student_uid = _normalize_string(session.get('student_uid'))
        if student_uid:
            student_ids.add(student_uid)
        summary = normalize_session_summary(session.get('session_summary'))
        for source in ('target_expression_hits', 'target_vocabulary_hits'):
            for surface, count in (summary.get(source) or {}).items():
                if surface in hit_counts:
                    c = int(count)
                    hit_counts[surface] += c
                    if c > 0 and student_uid:
                        elicited[surface].add(student_uid)
    return {
        'hit_counts': hit_counts,
        'students_elicited': {s: len(uids) for s, uids in elicited.items()},
        'student_count': len(student_ids),
        'session_count': session_count,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_pedagogy_alignment -v`
Expected: PASS (all classes)

- [ ] **Step 5: Add `alignment` to the import-boundary probe**

In `backend/tests/test_pedagogy_engine_s1.py`, in `test_plan_and_routing_import_no_openai_or_canvas`, add this line to the `probe` string right after the `language_signal` import (around line 210):

```python
            "import backend.services.pedagogy.alignment\n"
```

- [ ] **Step 6: Run the import-boundary test**

Run: `python3 -m unittest backend.tests.test_pedagogy_engine_s1.ImportBoundaryTestCase -v`
Expected: PASS (alignment imports no forbidden modules)

- [ ] **Step 7: Commit**

```bash
git add backend/services/practice_analytics.py backend/tests/test_pedagogy_alignment.py backend/tests/test_pedagogy_engine_s1.py
git commit -m "feat(pedagogy): realized-input aggregator + alignment import-boundary guard"
```

---

### Task 3: Route `?realized=1` + flag + cloudbuild

**Files:**
- Modify: `backend/services/pedagogy/integration.py` (add `alignment_view_enabled()` near the other flag helpers ~line 108)
- Modify: `backend/routes/curriculum_admin.py:1042-1071` (the plan-preview route — add the realized branch + imports)
- Modify: `cloudbuild.yaml:60` (set-env-vars) and `cloudbuild.yaml` substitutions (~line 318)
- Test: `backend/tests/test_pedagogy_alignment.py` (flag helper test)

**Interfaces:**
- Consumes: `build_alignment` (Task 1), `build_assignment_realized_input` (Task 2), `deps.db.list_assignment_practice_sessions` (existing — used by the assignment-debrief route at line 1031).
- Produces: `GET /api/teacher/assignments/<id>/plan-preview?realized=1` → `planPreview.realized` block (or `null` on fail-soft / flag-off).

- [ ] **Step 1: Write the failing test** (flag helper; append to `backend/tests/test_pedagogy_alignment.py`)

```python
import os
from unittest import mock

from backend.services.pedagogy.integration import alignment_view_enabled


class AlignmentFlagTestCase(unittest.TestCase):
    def test_default_off(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(alignment_view_enabled())

    def test_on_when_truthy(self):
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_ALIGNMENT_VIEW": "1"}):
            self.assertTrue(alignment_view_enabled())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_pedagogy_alignment.AlignmentFlagTestCase -v`
Expected: FAIL — `ImportError: cannot import name 'alignment_view_enabled'`

- [ ] **Step 3: Add the flag helper** (in `backend/services/pedagogy/integration.py`, after `teacher_preview_enabled`)

```python
def alignment_view_enabled() -> bool:
    """Teacher FDE Phase 1 — the task–target alignment view (a realized overlay on
    the plan-preview). Default off; read-only/additive (no live-path effect).
    Reads PEDAGOGY_ENGINE_ALIGNMENT_VIEW."""
    return os.environ.get("PEDAGOGY_ENGINE_ALIGNMENT_VIEW", "").strip().lower() in _TRUTHY
```

- [ ] **Step 4: Run flag test to verify it passes**

Run: `python3 -m unittest backend.tests.test_pedagogy_alignment.AlignmentFlagTestCase -v`
Expected: PASS

- [ ] **Step 5: Wire the realized branch into the plan-preview route**

In `backend/routes/curriculum_admin.py`: ensure `request` is imported from flask (it is used elsewhere in this blueprint) and add the new imports near the other pedagogy imports at the top of the file:

```python
from backend.services.pedagogy.integration import alignment_view_enabled
from backend.services.pedagogy.alignment import build_alignment
from backend.services.practice_analytics import build_assignment_realized_input
```

Then, inside `api_get_assignment_plan_preview`, replace the single line `preview = serialize_plan_preview(compile_prompt_plan(bootstrap))` (line 1062) with:

```python
                preview = serialize_plan_preview(compile_prompt_plan(bootstrap))
                realized_requested = (
                    str(request.args.get('realized', '')).strip().lower()
                    in {'1', 'true', 'yes', 'on'}
                )
                if preview and realized_requested and alignment_view_enabled():
                    try:
                        targets = preview.get('targets') or []
                        lexical = [
                            t['surface'] for t in targets
                            if t.get('kind') in ('expression', 'vocabulary') and t.get('surface')
                        ]
                        sessions = deps.db.list_assignment_practice_sessions(assignment_id)
                        realized_input = build_assignment_realized_input(sessions, lexical)
                        preview['realized'] = build_alignment(targets, realized_input)
                    except Exception:
                        logger.exception(
                            'alignment realized join failed; omitting realized '
                            '(assignment_id=%s)', assignment_id)
                        preview['realized'] = None
```

(Builder calls the endpoint without `?realized=1` ⇒ `realized_requested` False ⇒ byte-identical to today. Flag off ⇒ same.)

- [ ] **Step 6: Add the route test** (append to `backend/tests/test_pedagogy_alignment.py`)

This test exercises the realized-join wiring through the same shapes the route uses, without the HTTP/auth harness (the route's auth + flag gate are unchanged plumbing already covered by the existing plan-preview route tests):

```python
class RealizedWiringTestCase(unittest.TestCase):
    """The route composes build_assignment_realized_input -> build_alignment over
    the plan's lexical targets. This pins that composition."""

    def test_route_composition_attaches_realized(self):
        targets = [
            {"surface": "hola", "kind": "expression", "feedbackRoute": "recast_first"},
            {"surface": "subj", "kind": "grammar_rule", "feedbackRoute": "prompt_first"},
        ]
        sessions = [
            {"student_uid": "s1", "session_summary": {"target_expression_hits": {"hola": 4}}},
        ]
        lexical = [t["surface"] for t in targets
                   if t["kind"] in ("expression", "vocabulary")]
        realized = build_alignment(targets, build_assignment_realized_input(sessions, lexical))
        self.assertEqual(realized["studentCount"], 1)
        self.assertEqual(realized["neverElicited"], [])
        hola = next(t for t in realized["perTarget"] if t["surface"] == "hola")
        self.assertEqual(hola["tier"], "solid")
        subj = next(t for t in realized["perTarget"] if t["surface"] == "subj")
        self.assertFalse(subj["measurable"])
```

- [ ] **Step 7: Run the full alignment test module + backend suite**

Run: `python3 -m unittest backend.tests.test_pedagogy_alignment -v`
Expected: PASS (all classes)
Run: `make test-backend`
Expected: PASS (full suite green; existing plan-preview route tests unaffected)

- [ ] **Step 8: Wire the cloudbuild flag (REPLACE-safe)**

In `cloudbuild.yaml` line 60, append to the `--set-env-vars` value, right after `PEDAGOGY_ENGINE_CHIP_FAST_GATE=${_PEDAGOGY_ENGINE_CHIP_FAST_GATE}`:

```
,PEDAGOGY_ENGINE_ALIGNMENT_VIEW=${_PEDAGOGY_ENGINE_ALIGNMENT_VIEW}
```

In the `substitutions:` block (near line 318, after `_PEDAGOGY_ENGINE_CHIP_FAST_GATE: '1'`), add:

```yaml
  # Teacher FDE Phase 1 — task–target alignment view (read-only teacher overlay).
  # Ships inert at '0' (matches absent/off live); flip via --update-env-vars after burn-in.
  _PEDAGOGY_ENGINE_ALIGNMENT_VIEW: '0'
```

- [ ] **Step 9: Commit**

```bash
git add backend/services/pedagogy/integration.py backend/routes/curriculum_admin.py backend/tests/test_pedagogy_alignment.py cloudbuild.yaml
git commit -m "feat(pedagogy): plan-preview ?realized=1 alignment overlay behind PEDAGOGY_ENGINE_ALIGNMENT_VIEW"
```

---

### Task 4: Frontend — realized column, never-elicited callout, analytics mount

**Files:**
- Modify: `frontend/src/api/teacher.ts:360-381` (extend `PlanPreview` type + `getAssignmentPlanPreview`)
- Modify: `frontend/src/components/assignments/AssignmentPlanPreview.tsx` (realized column + callout + `withRealized` prop)
- Modify: `frontend/src/pages/TeacherAssignmentAnalyticsPage.tsx` (mount in review mode)
- Modify: `frontend/src/i18n/en.json` + `frontend/src/i18n/ko.json` (new keys, parity)
- Test: `frontend/src/components/assignments/AssignmentPlanPreview.test.tsx`

**Interfaces:**
- Consumes: the backend `planPreview.realized` block from Task 3.
- Produces: `<AssignmentPlanPreview assignmentId={id} withRealized />` renders the realized column + never-elicited callout.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/assignments/AssignmentPlanPreview.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AssignmentPlanPreview } from './AssignmentPlanPreview';

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: () => '' }) }));

const realizedPreview = {
  engineEnabled: true, rawTutorMode: false, taskType: 'opinion_gap',
  targets: [
    { surface: 'hola', kind: 'expression', feedbackRoute: 'recast_first' },
    { surface: 'subj', kind: 'grammar_rule', feedbackRoute: 'prompt_first' },
  ],
  realized: {
    studentCount: 3, sessionCount: 4,
    perTarget: [
      { surface: 'hola', kind: 'expression', measurable: true, hits: 5, tier: 'solid', studentsElicited: 3 },
      { surface: 'subj', kind: 'grammar_rule', measurable: false, hits: null, tier: null, studentsElicited: null },
    ],
    neverElicited: ['adios'],
    alignmentRate: { measurableTargetCount: 1, elicitedCount: 1, solidCount: 1 },
  },
};

vi.mock('@/api/teacher', () => ({
  getAssignmentPlanPreview: vi.fn(async () => realizedPreview),
}));

describe('AssignmentPlanPreview realized', () => {
  it('renders realized hits and the never-elicited callout', async () => {
    render(<AssignmentPlanPreview assignmentId="a1" withRealized />);
    expect(await screen.findByText('hola')).toBeInTheDocument();
    expect(screen.getByText(/5 · solid · 3\/3/)).toBeInTheDocument();  // realized cell (one node)
    expect(screen.getByText('adios')).toBeInTheDocument();        // never-elicited surface
    expect(screen.getByTestId('align-never-elicited')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- --run src/components/assignments/AssignmentPlanPreview.test.tsx`
Expected: FAIL (no realized column / no `align-never-elicited` testid; `withRealized` prop unknown)

- [ ] **Step 3: Extend the API type + fetch fn** (`frontend/src/api/teacher.ts`)

Replace the `PlanPreview` interface + `getAssignmentPlanPreview` (lines 366-381) with:

```ts
export interface PlanPreviewRealizedTarget {
  surface: string;
  kind: string;
  measurable: boolean;
  hits: number | null;
  tier: string | null;
  studentsElicited: number | null;
}

export interface PlanPreviewRealized {
  studentCount: number;
  sessionCount: number;
  perTarget: PlanPreviewRealizedTarget[];
  neverElicited: string[];
  alignmentRate: { measurableTargetCount: number; elicitedCount: number; solidCount: number };
}

export interface PlanPreview {
  engineEnabled: boolean;
  rawTutorMode: boolean;
  taskType?: string;
  correctionPosture?: { mode: string; recastDefault: boolean; elicitationRepeatThreshold: number };
  targets?: PlanPreviewTarget[];
  recycling?: unknown;
  guaranteesDisabled?: string[];
  realized?: PlanPreviewRealized | null;
}

export const getAssignmentPlanPreview = async (
  assignmentId: string,
  opts?: { realized?: boolean },
): Promise<PlanPreview | null> => {
  const response = await api.get<{ success: boolean; teacherPreviewEnabled: boolean; planPreview?: PlanPreview | null }>(
    `/teacher/assignments/${assignmentId}/plan-preview${opts?.realized ? '?realized=1' : ''}`,
  );
  return response.data.success && response.data.teacherPreviewEnabled ? (response.data.planPreview ?? null) : null;
};
```

- [ ] **Step 4: Extend the component** (`frontend/src/components/assignments/AssignmentPlanPreview.tsx`)

Change the signature + fetch call, add a realized header cell + per-row realized cell, and the never-elicited callout. Replace the whole file with:

```tsx
import { useEffect, useState } from 'react';
import { getAssignmentPlanPreview, type PlanPreview, type PlanPreviewRealizedTarget } from '@/api/teacher';
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

  if (!loaded || !preview) return null;

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

  const realizedCell = (kind?: string, surface?: string) => {
    const r = realizedBySurface.get(`${kind}:${surface}`);
    if (!r) return null;
    if (!r.measurable) return <span className="text-muted-foreground">{t('teacher.builder.plan.notYetMeasurable')}</span>;
    return <span>{r.hits} · {r.tier} · {r.studentsElicited}/{realized?.studentCount}</span>;
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm run test -- --run src/components/assignments/AssignmentPlanPreview.test.tsx`
Expected: PASS

- [ ] **Step 6: Add i18n keys (both files, keep parity)**

In `frontend/src/i18n/en.json`, add under the existing `teacher.builder.plan.*` keys:

```json
"teacher.builder.plan.titleRealized": "How the AI ran this assignment",
"teacher.builder.plan.tableRealized": "Realized (hits · level · students)",
"teacher.builder.plan.notYetMeasurable": "designed · not yet measurable",
"teacher.builder.plan.neverElicitedTitle": "Designed but never came up — adjust the scenario so it requires these, or drop them:"
```

In `frontend/src/i18n/ko.json`, add the same keys (machine-drafted Korean; tone pass pending per the Korea-localization convention):

```json
"teacher.builder.plan.titleRealized": "AI가 이 과제를 실제로 어떻게 운영했는가",
"teacher.builder.plan.tableRealized": "실제 (사용 횟수 · 수준 · 학생 수)",
"teacher.builder.plan.notYetMeasurable": "설계됨 · 아직 측정 불가",
"teacher.builder.plan.neverElicitedTitle": "설계했지만 한 번도 등장하지 않음 — 시나리오가 이를 요구하도록 조정하거나 제거하세요:"
```

- [ ] **Step 7: Run the i18n parity test**

Run: `cd frontend && npm run test -- --run src/i18n/i18n.parity.test.ts`
Expected: PASS (en/ko key sets match)

- [ ] **Step 8: Mount the realized view on the analytics page**

In `frontend/src/pages/TeacherAssignmentAnalyticsPage.tsx`, import the component and render it in review mode near the existing per-target / pedagogy section (it self-hides when the flag is off or `realized` is null):

```tsx
import { AssignmentPlanPreview } from '@/components/assignments/AssignmentPlanPreview';
// ...in the JSX, within the analytics body (assignmentId is the route param already in scope):
<AssignmentPlanPreview assignmentId={assignmentId} withRealized />
```

- [ ] **Step 9: Run the frontend suite + build**

Run: `cd frontend && npm run test -- --run`
Expected: PASS
Run: `cd frontend && npm run build`
Expected: `tsc -b` clean + Vite build succeeds (types line up)

- [ ] **Step 10: Commit**

```bash
git add frontend/src/api/teacher.ts frontend/src/components/assignments/AssignmentPlanPreview.tsx frontend/src/pages/TeacherAssignmentAnalyticsPage.tsx frontend/src/i18n/en.json frontend/src/i18n/ko.json frontend/src/components/assignments/AssignmentPlanPreview.test.tsx
git commit -m "feat(teacher): realized alignment overlay + never-elicited callout on plan-preview"
```

---

## Done criteria

- `make test-backend` green (new `test_pedagogy_alignment.py` + import-boundary updated).
- `cd frontend && npm run test -- --run` green incl. the new component test + i18n parity.
- Flag OFF (default) ⇒ plan-preview byte-identical to today (builder + analytics both render intended-only).
- Flag ON + `?realized=1` on an assignment with sessions ⇒ realized column + never-elicited callout, grammar/objectives show "not yet measurable."
- Deploy inert (`_PEDAGOGY_ENGINE_ALIGNMENT_VIEW: '0'`), then cut over via `--update-env-vars PEDAGOGY_ENGINE_ALIGNMENT_VIEW=1` and runtime-verify with the test teacher on a seeded assignment (mirrors prior slice cutovers).

## Post-merge (not in this plan)

- Doc-sync: mark `teacher-fde/TASKS.md` Phase 1 build item done; add a LIMITATIONS entry (grammar/objective realized = honest blank); update `backend/CLAUDE.md` pedagogy package list with `alignment.py`.
- Fast-follow: modality split of the realized signal (voice vs. text).
