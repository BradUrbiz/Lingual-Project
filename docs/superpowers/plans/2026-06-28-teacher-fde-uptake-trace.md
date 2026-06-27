# Teacher FDE — Uptake Trace (elicitation-vs-recast) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an uptake trace to the alignment view's realized signal — for each lexical target production, classify it as after-prompt (self-repair), after-recast (form supplied), or unprompted (spontaneous), derived read-time from already-persisted `learning_events`.

**Architecture:** Path A — read-time derivation, no live/emission-path change. A new pure function `pedagogy/uptake.py` does a turn-proximity join over the assignment's persisted feedback + hit events; the route enriches `realized.uptake` when a new flag is on; the frontend renders a headline + per-target indicator. Mirrors the Phase 1 Alignment View exactly (additive, fail-soft, flag-gated, lexical-only).

**Tech Stack:** Python 3 / Flask (backend, stdlib-only pure module), React 19 + TypeScript + Vitest (frontend), unittest (backend tests).

**Spec:** `docs/superpowers/specs/2026-06-28-teacher-fde-uptake-trace-design.md`

## Global Constraints

- **Flag:** `PEDAGOGY_ENGINE_UPTAKE_TRACE`, default **off**. The integration helper reads it via the same `_TRUTHY` idiom as the sibling flags. cloudbuild substitution `_PEDAGOGY_ENGINE_UPTAKE_TRACE` defaults `'0'` (REPLACE-safe: matches absent/off live).
- **Import boundary (invariant 7a):** `uptake.py` imports stdlib + sibling pure pedagogy only — no OpenAI/Canvas/resolver/compliance. Enforced by `test_pedagogy_engine_s1.ImportBoundaryTestCase`.
- **Gating:** uptake rides the realized block — it is computed only when `alignment_view_enabled()` AND `?realized=1` AND sessions exist AND `uptake_trace_enabled()`. Off ⇒ no `uptake` key ⇒ byte-identical.
- **Fail-soft:** uptake derivation is wrapped in its OWN nested try/except so a uptake failure degrades `uptake` to `None` WITHOUT nulling the realized block. No path 500s.
- **Lexical-only:** expression + vocabulary surfaces only (the same `lexical` list the realized join already computes). Grammar/objective have no per-target hit event → excluded.
- **Two hit payload key conventions:** `metric.target_expression_hit` carries the surface under `payload['expression']`; `metric.target_vocabulary_hit` carries it under `payload['word']`. The pure function must read the correct key per event type.
- **i18n parity:** every new `t()` key goes in BOTH `frontend/src/i18n/en.json` and `ko.json`; `i18n.parity.test.ts` must stay green.
- **No new DB read method:** reuse `deps.db.list_assignment_learning_events(assignment_id, event_types=[...])` (already on the read router, PG-authoritative).

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `backend/services/pedagogy/uptake.py` | **New.** Pure turn-proximity join: `build_target_uptake(events, target_surfaces, *, window=2) → dict` | 1 |
| `backend/tests/test_pedagogy_uptake.py` | **New.** Unit tests for the pure function (every branch) | 1 |
| `backend/tests/test_pedagogy_engine_s1.py` | Register `uptake` in the import-boundary probe | 1 |
| `backend/services/pedagogy/integration.py` | Add `uptake_trace_enabled()` flag helper | 2 |
| `backend/routes/curriculum_admin.py` | Enrich the realized branch with `realized.uptake` (nested fail-soft) | 2 |
| `backend/tests/test_teacher_plan_preview_route.py` | Route tests: flag-on attaches uptake; flag-off / no-sessions omits; fail-soft | 2 |
| `cloudbuild.yaml` | Add `_PEDAGOGY_ENGINE_UPTAKE_TRACE` substitution (default `'0'`) + env-var wiring | 2 |
| `frontend/src/api/teacher.ts` | `PlanPreviewUptake` + `PlanPreviewUptakeTarget` types; `uptake?` on `PlanPreviewRealized` | 3 |
| `frontend/src/components/assignments/AssignmentPlanPreview.tsx` | Headline + per-target indicator | 3 |
| `frontend/src/components/assignments/AssignmentPlanPreview.test.tsx` | Render uptake when present; self-hide when absent | 3 |
| `frontend/src/i18n/en.json` + `ko.json` | uptake copy (headline / tooltip / caveat) | 3 |
| `backend/CLAUDE.md`, `docs/school-integration/teacher-fde/{TASKS,ROADMAP}.md`, spec status | Doc sync (built-behind-flag, inert) | 4 |

---

## Task 1: Pure uptake join (`pedagogy/uptake.py`)

**Files:**
- Create: `backend/services/pedagogy/uptake.py`
- Test: `backend/tests/test_pedagogy_uptake.py`
- Modify: `backend/tests/test_pedagogy_engine_s1.py` (import-boundary probe)

**Interfaces:**
- Consumes: nothing from earlier tasks. Input `events` is a `list[dict]` shaped like persisted `learning_events` rows: each `{'session_id', 'event_type', 'turn_index': int|None, 'payload': dict, ...}`. `target_surfaces` is `list[str]` (the plan's lexical surfaces).
- Produces (Task 2 route consumes):
  `build_target_uptake(events: list[dict], target_surfaces: list[str], *, window: int = 2) -> dict` returning:
  ```python
  {
    "window": 2,
    "totals": {"afterPrompt": int, "afterRecast": int, "unprompted": int, "measured": int},
    "perTarget": [{"surface": str, "afterPrompt": int, "afterRecast": int, "unprompted": int}],
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_pedagogy_uptake.py`:

```python
import os
import unittest
from unittest import mock

from backend.services.pedagogy.uptake import build_target_uptake


def _ev(session_id, event_type, turn_index, **payload):
    return {
        "session_id": session_id,
        "event_type": event_type,
        "turn_index": turn_index,
        "payload": payload,
    }


class BuildTargetUptakeTestCase(unittest.TestCase):
    def test_hit_after_elicitation_is_after_prompt(self):
        events = [
            _ev("s1", "feedback.elicitation", 1, eventType="feedback.elicitation", count=1),
            _ev("s1", "metric.target_expression_hit", 2, expression="la cuenta", count=1),
        ]
        out = build_target_uptake(events, ["la cuenta"])
        self.assertEqual(out["totals"]["afterPrompt"], 1)
        self.assertEqual(out["totals"]["afterRecast"], 0)
        self.assertEqual(out["totals"]["unprompted"], 0)
        self.assertEqual(out["totals"]["measured"], 1)

    def test_hit_after_recast_is_after_recast(self):
        events = [
            _ev("s1", "feedback.recast", 1, eventType="feedback.recast", count=1),
            _ev("s1", "metric.target_expression_hit", 2, expression="la cuenta", count=1),
        ]
        out = build_target_uptake(events, ["la cuenta"])
        self.assertEqual(out["totals"]["afterRecast"], 1)
        self.assertEqual(out["totals"]["afterPrompt"], 0)

    def test_hit_with_no_preceding_feedback_is_unprompted(self):
        events = [
            _ev("s1", "metric.target_expression_hit", 2, expression="la cuenta", count=1),
        ]
        out = build_target_uptake(events, ["la cuenta"])
        self.assertEqual(out["totals"]["unprompted"], 1)

    def test_feedback_outside_window_is_unprompted(self):
        # Feedback at turn 1, hit at turn 5, window=2 -> 1 not in [3,4] -> unprompted.
        events = [
            _ev("s1", "feedback.elicitation", 1, eventType="feedback.elicitation"),
            _ev("s1", "metric.target_expression_hit", 5, expression="la cuenta", count=1),
        ]
        out = build_target_uptake(events, ["la cuenta"], window=2)
        self.assertEqual(out["totals"]["unprompted"], 1)
        self.assertEqual(out["totals"]["afterPrompt"], 0)

    def test_vocabulary_hit_uses_word_payload_key(self):
        # metric.target_vocabulary_hit carries the surface under payload['word'].
        events = [
            _ev("s1", "feedback.elicitation", 1, eventType="feedback.elicitation"),
            _ev("s1", "metric.target_vocabulary_hit", 2, word="relaciones", count=1),
        ]
        out = build_target_uptake(events, ["relaciones"])
        self.assertEqual(out["totals"]["afterPrompt"], 1)
        self.assertEqual(out["perTarget"][0]["surface"], "relaciones")

    def test_sessions_are_isolated(self):
        # Feedback in s1 must not classify a hit in s2.
        events = [
            _ev("s1", "feedback.elicitation", 1, eventType="feedback.elicitation"),
            _ev("s2", "metric.target_expression_hit", 2, expression="la cuenta", count=1),
        ]
        out = build_target_uptake(events, ["la cuenta"])
        self.assertEqual(out["totals"]["unprompted"], 1)
        self.assertEqual(out["totals"]["afterPrompt"], 0)

    def test_count_weighting(self):
        events = [
            _ev("s1", "feedback.recast", 1, eventType="feedback.recast"),
            _ev("s1", "metric.target_expression_hit", 2, expression="la cuenta", count=3),
        ]
        out = build_target_uptake(events, ["la cuenta"])
        self.assertEqual(out["totals"]["afterRecast"], 3)
        self.assertEqual(out["totals"]["measured"], 3)

    def test_non_target_surface_ignored(self):
        events = [
            _ev("s1", "metric.target_expression_hit", 2, expression="hola", count=1),
        ]
        out = build_target_uptake(events, ["la cuenta"])
        self.assertEqual(out["totals"]["measured"], 0)
        self.assertEqual(out["perTarget"], [])

    def test_malformed_events_skipped(self):
        events = [
            "not a dict",
            {"event_type": "metric.target_expression_hit"},  # no turn_index
            _ev("s1", "metric.target_expression_hit", None, expression="la cuenta"),  # turn_index None
            _ev("s1", "metric.target_expression_hit", 2, expression="la cuenta", count=1),
        ]
        out = build_target_uptake(events, ["la cuenta"])
        # only the well-formed hit counts; no raise
        self.assertEqual(out["totals"]["measured"], 1)
        self.assertEqual(out["totals"]["unprompted"], 1)

    def test_same_turn_recast_and_elicitation_tie_is_after_recast(self):
        # A single assistant turn detected as BOTH -> form was available -> conservative afterRecast.
        events = [
            _ev("s1", "feedback.elicitation", 1, eventType="feedback.elicitation"),
            _ev("s1", "feedback.recast", 1, eventType="feedback.recast"),
            _ev("s1", "metric.target_expression_hit", 2, expression="la cuenta", count=1),
        ]
        out = build_target_uptake(events, ["la cuenta"])
        self.assertEqual(out["totals"]["afterRecast"], 1)
        self.assertEqual(out["totals"]["afterPrompt"], 0)

    def test_nearest_preceding_feedback_wins(self):
        # recast at turn 1, elicitation at turn 3, hit at turn 4, window=3 -> nearest (3) -> afterPrompt.
        events = [
            _ev("s1", "feedback.recast", 1, eventType="feedback.recast"),
            _ev("s1", "feedback.elicitation", 3, eventType="feedback.elicitation"),
            _ev("s1", "metric.target_expression_hit", 4, expression="la cuenta", count=1),
        ]
        out = build_target_uptake(events, ["la cuenta"], window=3)
        self.assertEqual(out["totals"]["afterPrompt"], 1)
        self.assertEqual(out["totals"]["afterRecast"], 0)

    def test_per_target_ordered_by_target_surfaces_and_only_produced(self):
        events = [
            _ev("s1", "metric.target_expression_hit", 2, expression="b", count=1),
            _ev("s1", "metric.target_expression_hit", 4, expression="a", count=1),
        ]
        out = build_target_uptake(events, ["a", "b", "c"])  # c never produced
        self.assertEqual([t["surface"] for t in out["perTarget"]], ["a", "b"])

    def test_empty_events(self):
        out = build_target_uptake([], ["la cuenta"])
        self.assertEqual(out["totals"], {"afterPrompt": 0, "afterRecast": 0, "unprompted": 0, "measured": 0})
        self.assertEqual(out["perTarget"], [])
        self.assertEqual(out["window"], 2)


if __name__ == "__main__":
    unittest.main()
```

> Note: the `os` / `mock` imports above are used by `UptakeFlagTestCase`, which Task 2 appends to this same file. Leave them in.

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m unittest backend.tests.test_pedagogy_uptake.BuildTargetUptakeTestCase -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.services.pedagogy.uptake'`

- [ ] **Step 3: Write the pure module**

Create `backend/services/pedagogy/uptake.py`:

```python
"""Target uptake trace (Teacher FDE, pure).

Import boundary (invariant 7a): stdlib + sibling pure pedagogy modules only.
Classifies each lexical target PRODUCTION as after-prompt (the learner
self-repaired after an elicitation), after-recast (the tutor supplied the form
and the learner echoed it), or unprompted (no feedback in the lookback window —
the strongest signal). Derived from already-persisted ``learning_events`` via a
turn-proximity join; the DB read happens in the route layer.
"""

from __future__ import annotations

from typing import Any

_FEEDBACK_TYPES = {"feedback.recast", "feedback.elicitation"}
# Hit events carry the produced surface under different payload keys:
#   metric.target_expression_hit -> payload['expression']
#   metric.target_vocabulary_hit -> payload['word']
_HIT_SURFACE_KEY = {
    "metric.target_expression_hit": "expression",
    "metric.target_vocabulary_hit": "word",
}
_ZERO = {"afterPrompt": 0, "afterRecast": 0, "unprompted": 0}


def build_target_uptake(
    events: list[dict],
    target_surfaces: list[str],
    *,
    window: int = 2,
) -> dict[str, Any]:
    """Classify each lexical target production by the feedback that preceded it.

    Pure, total, no-raise. ``events`` is the assignment's persisted
    ``learning_events`` (feedback + hit events); ``target_surfaces`` are the
    lexical surfaces to score (expression + vocabulary). Malformed events are
    skipped. Productions are weighted by their payload ``count``.
    """
    surfaces = {s for s in (target_surfaces or []) if s}

    # Group by session: feedback moves vs. target hits.
    feedback_by_session: dict[Any, list[tuple[int, str]]] = {}
    hits_by_session: dict[Any, list[tuple[int, str, int]]] = {}

    for event in events or []:
        if not isinstance(event, dict):
            continue
        turn_index = event.get("turn_index")
        if not isinstance(turn_index, int):
            continue
        event_type = event.get("event_type")
        session_id = event.get("session_id")
        payload = event.get("payload")
        if not isinstance(payload, dict):
            payload = {}

        if event_type in _FEEDBACK_TYPES:
            feedback_by_session.setdefault(session_id, []).append((turn_index, event_type))
        elif event_type in _HIT_SURFACE_KEY:
            surface = payload.get(_HIT_SURFACE_KEY[event_type])
            if surface not in surfaces:
                continue
            count = payload.get("count")
            count = count if isinstance(count, int) and count > 0 else 1
            hits_by_session.setdefault(session_id, []).append((turn_index, surface, count))

    totals = dict(_ZERO)
    per_surface: dict[str, dict[str, int]] = {}

    for session_id, hits in hits_by_session.items():
        feedback = feedback_by_session.get(session_id, [])
        for turn_index, surface, count in hits:
            kind = _classify(turn_index, feedback, window)
            totals[kind] += count
            bucket = per_surface.setdefault(surface, dict(_ZERO))
            bucket[kind] += count

    measured = totals["afterPrompt"] + totals["afterRecast"] + totals["unprompted"]

    # Order perTarget to match the realized table (target_surfaces order),
    # including only surfaces with >=1 production; dedupe defensively.
    seen: set = set()
    per_target: list[dict] = []
    for s in (target_surfaces or []):
        if s in per_surface and s not in seen:
            seen.add(s)
            per_target.append({"surface": s, **per_surface[s]})

    return {
        "window": window,
        "totals": {**totals, "measured": measured},
        "perTarget": per_target,
    }


def _classify(hit_turn: int, feedback: list[tuple[int, str]], window: int) -> str:
    """Nearest preceding feedback in ``[hit_turn - window, hit_turn - 1]`` decides.

    Recast wins a same-turn tie (the form was available -> conservatively NOT a
    self-repair). No feedback in the window -> ``unprompted``.
    """
    best_turn: int | None = None
    best_kind: str | None = None
    for turn_index, event_type in feedback:
        if not (hit_turn - window <= turn_index < hit_turn):
            continue
        if (
            best_turn is None
            or turn_index > best_turn
            or (turn_index == best_turn and event_type == "feedback.recast")
        ):
            best_turn = turn_index
            best_kind = event_type
    if best_kind == "feedback.elicitation":
        return "afterPrompt"
    if best_kind == "feedback.recast":
        return "afterRecast"
    return "unprompted"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m unittest backend.tests.test_pedagogy_uptake.BuildTargetUptakeTestCase -v`
Expected: PASS (13 tests)

- [ ] **Step 5: Register the module in the import-boundary probe**

In `backend/tests/test_pedagogy_engine_s1.py`, the `ImportBoundaryTestCase.test_plan_and_routing_import_no_openai_or_canvas` probe imports each pure module. Add `uptake` right after the `alignment` line.

Find:
```python
            "import backend.services.pedagogy.alignment\n"
            "forbidden = sorted(\n"
```
Replace with:
```python
            "import backend.services.pedagogy.alignment\n"
            "import backend.services.pedagogy.uptake\n"
            "forbidden = sorted(\n"
```

- [ ] **Step 6: Run the import-boundary test to verify it passes**

Run: `python3 -m unittest backend.tests.test_pedagogy_engine_s1.ImportBoundaryTestCase -v`
Expected: PASS (the fresh-interpreter probe imports `uptake` and finds no forbidden modules)

- [ ] **Step 7: Commit**

```bash
git add backend/services/pedagogy/uptake.py backend/tests/test_pedagogy_uptake.py backend/tests/test_pedagogy_engine_s1.py
git commit -m "feat(teacher-fde): pure uptake-trace join (build_target_uptake)"
```

---

## Task 2: Flag + route enrichment + cloudbuild

**Files:**
- Modify: `backend/services/pedagogy/integration.py` (add `uptake_trace_enabled()`)
- Modify: `backend/routes/curriculum_admin.py` (imports + realized-branch enrichment, ~line 29–35 and ~1074–1089)
- Modify: `cloudbuild.yaml` (substitution + env-var wiring)
- Test: `backend/tests/test_teacher_plan_preview_route.py` (new `UptakeTraceRouteTests` class)

**Interfaces:**
- Consumes: `build_target_uptake(events, target_surfaces, *, window=2)` from Task 1.
- Produces: `uptake_trace_enabled() -> bool`; the route attaches `preview['realized']['uptake']` (the Task 1 dict, or `None` on fail-soft) when gated.

- [ ] **Step 1: Write the failing route test**

In `backend/tests/test_teacher_plan_preview_route.py`, append a new test class after `AlignmentViewRouteTests` (reuse its `_app_with_sessions` pattern, but the Db stub also needs `list_assignment_learning_events`):

```python
class UptakeTraceRouteTests(unittest.TestCase):
    """Route-level tests for realized.uptake (flag gate + fail-soft)."""

    _PREVIEW = {
        'engineEnabled': True, 'rawTutorMode': False, 'taskType': 'opinion_gap',
        'correctionPosture': {'mode': 'balanced', 'recastDefault': True, 'elicitationRepeatThreshold': 2},
        'targets': [{'surface': 'la cuenta', 'kind': 'expression', 'feedbackRoute': 'recast_first'}],
    }
    _SESSIONS = [{'student_uid': 's1', 'session_summary': {'target_expression_hits': {'la cuenta': 1}}}]
    _EVENTS = [
        {'session_id': 'sess1', 'event_type': 'feedback.elicitation', 'turn_index': 1, 'payload': {}},
        {'session_id': 'sess1', 'event_type': 'metric.target_expression_hit', 'turn_index': 2,
         'payload': {'expression': 'la cuenta', 'count': 1}},
    ]

    def _app(self, *, events=None, events_raise=False):
        captured = self._EVENTS if events is None else events

        class _Db:
            def list_assignment_practice_sessions(self, _aid):
                return UptakeTraceRouteTests._SESSIONS

            def list_assignment_learning_events(self, _aid, event_types=None):
                if events_raise:
                    raise RuntimeError('events boom')
                return captured

        app = Flask(__name__)
        app.secret_key = 'test'
        app.register_blueprint(create_curriculum_admin_blueprint(RouteDeps(
            db=_Db(), firebase_auth=None,
            get_current_user_uid=lambda: (session.get('user') or {}).get('uid'),
            get_openai_client=lambda: None, get_assessment=lambda: {},
            compute_results=lambda *a, **k: {}, get_proficiency_description=lambda *a, **k: {},
            login_required=_passthrough, get_user_proficiency_context=lambda **_: '',
            build_system_prompt=lambda _c: '', get_school_request_context=lambda: None,
            set_active_school_membership=lambda *a, **k: None,
            allowed_learning_locales={'es-ES'}, allowed_minigame_types=set(),
            supported_ui_languages={'en'}, audit_logger=None,
        )))
        return app

    def _patches(self, env):
        return [
            mock.patch.dict(os.environ, env),
            mock.patch('backend.routes.curriculum_admin._require_assignment_teacher_access'),
            mock.patch('backend.routes.curriculum_admin.resolve_assignment_bootstrap_for_user', return_value={}),
            mock.patch('backend.routes.curriculum_admin.compile_prompt_plan', return_value=object()),
            mock.patch('backend.routes.curriculum_admin.serialize_plan_preview',
                       return_value=dict(self._PREVIEW)),
        ]

    def test_flag_on_attaches_uptake(self):
        with contextlib.ExitStack() as stack:
            for p in self._patches({
                    'PEDAGOGY_ENGINE_TEACHER_PREVIEW': '1',
                    'PEDAGOGY_ENGINE_ALIGNMENT_VIEW': '1',
                    'PEDAGOGY_ENGINE_UPTAKE_TRACE': '1'}):
                stack.enter_context(p)
            client = self._app().test_client()
            _login(client)
            resp = client.get('/api/teacher/assignments/a1/plan-preview?realized=1')
        self.assertEqual(resp.status_code, 200)
        uptake = resp.get_json()['planPreview']['realized']['uptake']
        self.assertEqual(uptake['totals']['afterPrompt'], 1)
        self.assertEqual(uptake['totals']['measured'], 1)

    def test_uptake_flag_off_no_uptake_key(self):
        with contextlib.ExitStack() as stack:
            for p in self._patches({
                    'PEDAGOGY_ENGINE_TEACHER_PREVIEW': '1',
                    'PEDAGOGY_ENGINE_ALIGNMENT_VIEW': '1',
                    'PEDAGOGY_ENGINE_UPTAKE_TRACE': ''}):
                stack.enter_context(p)
            client = self._app().test_client()
            _login(client)
            resp = client.get('/api/teacher/assignments/a1/plan-preview?realized=1')
        self.assertEqual(resp.status_code, 200)
        realized = resp.get_json()['planPreview']['realized']
        self.assertNotIn('uptake', realized)  # flag-off: realized still present, no uptake key

    def test_uptake_fail_soft_does_not_null_realized(self):
        # events read raises -> uptake None, realized block preserved, no 500.
        with contextlib.ExitStack() as stack:
            for p in self._patches({
                    'PEDAGOGY_ENGINE_TEACHER_PREVIEW': '1',
                    'PEDAGOGY_ENGINE_ALIGNMENT_VIEW': '1',
                    'PEDAGOGY_ENGINE_UPTAKE_TRACE': '1'}):
                stack.enter_context(p)
            client = self._app(events_raise=True).test_client()
            _login(client)
            resp = client.get('/api/teacher/assignments/a1/plan-preview?realized=1')
        self.assertEqual(resp.status_code, 200)
        realized = resp.get_json()['planPreview']['realized']
        self.assertIsNotNone(realized)               # realized survives
        self.assertIn('perTarget', realized)         # realized join intact
        self.assertIsNone(realized['uptake'])        # uptake degraded to None
```

Add `import contextlib` to the test file's imports (top of file, after `import os`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m unittest backend.tests.test_teacher_plan_preview_route.UptakeTraceRouteTests -v`
Expected: FAIL — `ImportError: cannot import name 'uptake_trace_enabled'` (route imports it in Step 4) OR the uptake key is absent because the route does not yet attach it.

- [ ] **Step 3: Add the flag helper**

In `backend/services/pedagogy/integration.py`, add after `alignment_view_enabled()` (ends ~line 118):

```python
def uptake_trace_enabled() -> bool:
    """Teacher FDE — uptake trace (elicitation-vs-recast overlay on the realized
    signal). Default off; read-only/additive (no live-path effect). Rides the
    realized block, so it is effective only with the alignment view also on.
    Reads PEDAGOGY_ENGINE_UPTAKE_TRACE."""
    return os.environ.get("PEDAGOGY_ENGINE_UPTAKE_TRACE", "").strip().lower() in _TRUTHY
```

Then append the flag test to `backend/tests/test_pedagogy_uptake.py` (before the `if __name__ == "__main__":` footer):
```python
class UptakeFlagTestCase(unittest.TestCase):
    def test_default_off(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            from backend.services.pedagogy.integration import uptake_trace_enabled
            self.assertFalse(uptake_trace_enabled())

    def test_on_when_truthy(self):
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_UPTAKE_TRACE": "1"}):
            from backend.services.pedagogy.integration import uptake_trace_enabled
            self.assertTrue(uptake_trace_enabled())
```

- [ ] **Step 4: Wire the route imports**

In `backend/routes/curriculum_admin.py`:

(a) After the `build_alignment` import (line 29) add:
```python
from backend.services.pedagogy.uptake import build_target_uptake
```

(b) In the `from backend.services.pedagogy.integration import (` block (lines 30–35), add `uptake_trace_enabled,` keeping alpha-ish order:
```python
from backend.services.pedagogy.integration import (
    alignment_view_enabled,
    debrief_enabled,
    debrief_rollup_enabled,
    teacher_preview_enabled,
    uptake_trace_enabled,
)
```

- [ ] **Step 5: Enrich the realized branch**

In `api_get_assignment_plan_preview` (curriculum_admin.py), inside the `if sessions:` block, after `preview['realized'] = build_alignment(targets, realized_input)` (line 1084), add the nested fail-soft uptake derivation.

Find:
```python
                        sessions = deps.db.list_assignment_practice_sessions(assignment_id)
                        if sessions:
                            realized_input = build_assignment_realized_input(sessions, lexical)
                            preview['realized'] = build_alignment(targets, realized_input)
                    except Exception:
```
Replace with:
```python
                        sessions = deps.db.list_assignment_practice_sessions(assignment_id)
                        if sessions:
                            realized_input = build_assignment_realized_input(sessions, lexical)
                            preview['realized'] = build_alignment(targets, realized_input)
                            if uptake_trace_enabled():
                                # Own nested fail-soft: a uptake failure must NOT
                                # null the realized block (the outer except would).
                                try:
                                    events = deps.db.list_assignment_learning_events(
                                        assignment_id,
                                        event_types=[
                                            'feedback.recast', 'feedback.elicitation',
                                            'metric.target_expression_hit',
                                            'metric.target_vocabulary_hit',
                                        ],
                                    )
                                    preview['realized']['uptake'] = build_target_uptake(events, lexical)
                                except Exception:
                                    logger.exception(
                                        'uptake trace derivation failed; uptake=None '
                                        '(assignment_id=%s)', assignment_id)
                                    preview['realized']['uptake'] = None
                    except Exception:
```

- [ ] **Step 6: Run the route test to verify it passes**

Run: `python3 -m unittest backend.tests.test_teacher_plan_preview_route.UptakeTraceRouteTests -v`
Expected: PASS (3 tests)

- [ ] **Step 7: Run the full uptake + plan-preview + flag suites**

Run: `python3 -m unittest backend.tests.test_pedagogy_uptake backend.tests.test_teacher_plan_preview_route -v`
Expected: PASS (all — including `UptakeFlagTestCase` from Task 1, now that the helper exists)

- [ ] **Step 8: Add the cloudbuild flag (REPLACE-safe, default `'0'`)**

In `cloudbuild.yaml`:

(a) Append the env var to the `--set-env-vars` string (the long line ~60). Find the end `...,PEDAGOGY_ENGINE_ALIGNMENT_VIEW=${_PEDAGOGY_ENGINE_ALIGNMENT_VIEW}'` and replace with `...,PEDAGOGY_ENGINE_ALIGNMENT_VIEW=${_PEDAGOGY_ENGINE_ALIGNMENT_VIEW},PEDAGOGY_ENGINE_UPTAKE_TRACE=${_PEDAGOGY_ENGINE_UPTAKE_TRACE}'`:
```
...,PEDAGOGY_ENGINE_ALIGNMENT_VIEW=${_PEDAGOGY_ENGINE_ALIGNMENT_VIEW},PEDAGOGY_ENGINE_UPTAKE_TRACE=${_PEDAGOGY_ENGINE_UPTAKE_TRACE}'
```

(b) In the `substitutions:` block, after the `_PEDAGOGY_ENGINE_ALIGNMENT_VIEW: '1'` line (~322) add:
```yaml
  # Teacher FDE — uptake trace (elicitation-vs-recast overlay on the realized
  # signal). Default '0' (REPLACE-safe: matches absent/off live). Ship inert,
  # cut over separately (deploy -> flip --update-env-vars PEDAGOGY_ENGINE_UPTAKE_TRACE=1
  # -> runtime-verify), per the Phase 1 alignment-view precedent.
  _PEDAGOGY_ENGINE_UPTAKE_TRACE: '0'
```

- [ ] **Step 9: Commit**

```bash
git add backend/services/pedagogy/integration.py backend/routes/curriculum_admin.py backend/tests/test_teacher_plan_preview_route.py backend/tests/test_pedagogy_uptake.py cloudbuild.yaml
git commit -m "feat(teacher-fde): attach realized.uptake (flag PEDAGOGY_ENGINE_UPTAKE_TRACE, default off)"
```

---

## Task 3: Frontend (types + headline + per-target indicator + i18n)

**Files:**
- Modify: `frontend/src/api/teacher.ts` (types)
- Modify: `frontend/src/components/assignments/AssignmentPlanPreview.tsx`
- Modify: `frontend/src/components/assignments/AssignmentPlanPreview.test.tsx`
- Modify: `frontend/src/i18n/en.json` + `frontend/src/i18n/ko.json`

**Interfaces:**
- Consumes: the route's `realized.uptake` JSON (Task 2): `{ window, totals: { afterPrompt, afterRecast, unprompted, measured }, perTarget: [{ surface, afterPrompt, afterRecast, unprompted }] }`.
- Produces: rendered headline (`data-testid="uptake-headline"`) + per-target indicator appended to each lexical realized cell. Self-hides when `realized.uptake` is null/absent.

- [ ] **Step 1: Write the failing frontend test**

In `frontend/src/components/assignments/AssignmentPlanPreview.test.tsx`, append to the `describe('AssignmentPlanPreview realized', ...)` block (after the existing realized test):

```typescript
  it('renders the uptake headline and per-target indicator when uptake is present', async () => {
    getAssignmentPlanPreviewMock.mockResolvedValue({
      engineEnabled: true, rawTutorMode: false, taskType: 'opinion_gap',
      targets: [{ surface: 'hola', kind: 'expression', feedbackRoute: 'recast_first' }],
      realized: {
        studentCount: 3, sessionCount: 4,
        perTarget: [
          { surface: 'hola', kind: 'expression', measurable: true, hits: 5, tier: 'solid', studentsElicited: 3 },
        ],
        neverElicited: [],
        alignmentRate: { measurableTargetCount: 1, elicitedCount: 1, solidCount: 1 },
        uptake: {
          window: 2,
          totals: { afterPrompt: 2, afterRecast: 1, unprompted: 4, measured: 7 },
          perTarget: [{ surface: 'hola', afterPrompt: 2, afterRecast: 1, unprompted: 4 }],
        },
      },
    });
    render(<AssignmentPlanPreview assignmentId="a1" withRealized />);
    expect(await screen.findByTestId('uptake-headline')).toBeInTheDocument();
    // per-target glyph indicator (one node) shows the three counts
    expect(screen.getByText(/2.*1.*4/)).toBeInTheDocument();
  });

  it('self-hides the uptake headline when uptake is absent', async () => {
    getAssignmentPlanPreviewMock.mockResolvedValue({
      engineEnabled: true, rawTutorMode: false, taskType: 'opinion_gap',
      targets: [{ surface: 'hola', kind: 'expression', feedbackRoute: 'recast_first' }],
      realized: {
        studentCount: 1, sessionCount: 1,
        perTarget: [{ surface: 'hola', kind: 'expression', measurable: true, hits: 1, tier: 'emerging', studentsElicited: 1 }],
        neverElicited: [],
        alignmentRate: { measurableTargetCount: 1, elicitedCount: 1, solidCount: 0 },
      },
    });
    render(<AssignmentPlanPreview assignmentId="a1" withRealized />);
    expect(await screen.findByText('hola')).toBeInTheDocument();
    expect(screen.queryByTestId('uptake-headline')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm run test -- --run src/components/assignments/AssignmentPlanPreview.test.tsx`
Expected: FAIL — `uptake-headline` testid not found (component does not render it yet).

- [ ] **Step 3: Add the API types**

In `frontend/src/api/teacher.ts`, add the two interfaces before `PlanPreviewRealized` (which ends ~line 381), and add the `uptake?` field on `PlanPreviewRealized`:

```typescript
export interface PlanPreviewUptakeTarget {
  surface: string;
  afterPrompt: number;
  afterRecast: number;
  unprompted: number;
}

export interface PlanPreviewUptake {
  window: number;
  totals: { afterPrompt: number; afterRecast: number; unprompted: number; measured: number };
  perTarget: PlanPreviewUptakeTarget[];
}
```

Then in `PlanPreviewRealized`, add the field after `alignmentRate`:
```typescript
export interface PlanPreviewRealized {
  studentCount: number;
  sessionCount: number;
  perTarget: PlanPreviewRealizedTarget[];
  neverElicited: string[];
  alignmentRate: { measurableTargetCount: number; elicitedCount: number; solidCount: number };
  uptake?: PlanPreviewUptake | null;
}
```

- [ ] **Step 4: Render the headline + per-target indicator**

In `frontend/src/components/assignments/AssignmentPlanPreview.tsx`:

(a) Extend the import on line 2 to add the uptake target type:
```typescript
import { getAssignmentPlanPreview, type PlanPreview, type PlanPreviewRealizedTarget, type PlanPreviewUptakeTarget } from '@/api/teacher';
```

(b) After the `realizedBySurface` map (line 36), add an uptake lookup:
```typescript
  const uptake = realized?.uptake ?? null;
  const uptakeBySurface = new Map<string, PlanPreviewUptakeTarget>(
    (uptake?.perTarget ?? []).map((u) => [u.surface, u]),
  );
```

(c) Extend `realizedCell` (lines 38–43) so the measurable cell also appends the uptake indicator:
```typescript
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
```

(d) Render the headline. After the never-elicited callout block (closes line 63) and before the `{preview.targets?.length ? (` table (line 64), add:
```typescript
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
```

- [ ] **Step 5: Add the i18n strings (en + ko, parity)**

In `frontend/src/i18n/en.json`, after `"teacher.builder.plan.neverElicitedTitle": ...` (line 874) add:
```json
  "teacher.builder.plan.uptakeHeadline": "Of {measured} target productions, {afterPrompt} followed a self-repair prompt, {afterRecast} followed a hand-over, and {unprompted} were unprompted.",
  "teacher.builder.plan.uptakeTooltip": "✋ after a self-repair prompt · 🔁 after the tutor supplied the form · ★ unprompted (spontaneous)",
  "teacher.builder.plan.uptakeCaveat": "Heuristic: feedback detection and the link to each production are approximate. Unprompted is the desired outcome, not a gap.",
```

In `frontend/src/i18n/ko.json`, at the matching location add:
```json
  "teacher.builder.plan.uptakeHeadline": "목표 표현 산출 {measured}건 중 {afterPrompt}건은 자기수정 유도 후, {afterRecast}건은 형태 제공 후, {unprompted}건은 유도 없이 자발적으로 나왔습니다.",
  "teacher.builder.plan.uptakeTooltip": "✋ 자기수정 유도 후 · 🔁 튜터가 형태를 제공한 후 · ★ 유도 없이 자발적으로",
  "teacher.builder.plan.uptakeCaveat": "휴리스틱: 피드백 감지와 각 산출의 연결은 근사치입니다. ‘자발적’은 부족이 아니라 바람직한 결과입니다.",
```

- [ ] **Step 6: Run the frontend test + parity to verify they pass**

Run: `cd frontend && npm run test -- --run src/components/assignments/AssignmentPlanPreview.test.tsx src/i18n/i18n.parity.test.ts`
Expected: PASS (component renders the headline + indicator; self-hide test passes; en/ko parity green)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/teacher.ts frontend/src/components/assignments/AssignmentPlanPreview.tsx frontend/src/components/assignments/AssignmentPlanPreview.test.tsx frontend/src/i18n/en.json frontend/src/i18n/ko.json
git commit -m "feat(teacher-fde): render uptake headline + per-target indicator (en/ko)"
```

---

## Task 4: Doc sync (built-behind-flag, inert)

**Files:**
- Modify: `backend/CLAUDE.md` (pedagogy module list + import-boundary list + flag-state paragraph)
- Modify: `docs/school-integration/teacher-fde/TASKS.md` + `ROADMAP.md`
- Modify: `docs/superpowers/specs/2026-06-28-teacher-fde-uptake-trace-design.md` (status line)

**Interfaces:** none (documentation only).

- [ ] **Step 1: Update `backend/CLAUDE.md`**

(a) In the `pedagogy/` services bullet, append `uptake.py` to the pure-module enumeration (after the `alignment.py` clause):
```
`uptake.py` (stdlib-only Teacher FDE pure join: `build_target_uptake(events, target_surfaces, *, window=2) -> dict` — turn-proximity classification of each lexical target production as after-prompt / after-recast / unprompted; reads `metric.target_expression_hit`→`payload['expression']` and `metric.target_vocabulary_hit`→`payload['word']`; no DB/OpenAI imports)
```

(b) In the **Import boundary (enforced + tested)** sentence, add `uptake.py` to the list of modules verified by `test_pedagogy_engine_s1.ImportBoundaryTestCase`.

(c) In the **Flag state** paragraph, after the alignment-view sentence add:
```
The **Teacher FDE uptake trace** is gated by `PEDAGOGY_ENGINE_UPTAKE_TRACE` (**BUILT, cloudbuild default `'0'`, NOT cut over** — read-only overlay on the realized block: when on AND the alignment view on AND `?realized=1` AND sessions exist, the plan-preview route attaches `realized.uptake` classifying each lexical production as after-prompt/after-recast/unprompted via the pure `pedagogy/uptake.py` `build_target_uptake` over persisted `learning_events`; own nested fail-soft so a uptake failure degrades `uptake: null` WITHOUT nulling realized; off ⇒ no `uptake` key, byte-identical; cutover deploy-inert→flip per the alignment-view precedent; rollback `--update-env-vars PEDAGOGY_ENGINE_UPTAKE_TRACE=0`). Spec/plan `docs/superpowers/{specs,plans}/2026-06-28-teacher-fde-uptake-trace*.md`.
```

- [ ] **Step 2: Update the Teacher FDE TASKS + ROADMAP**

In `docs/school-integration/teacher-fde/TASKS.md`, under **Phase 1 — Observability**, add a done item:
```
- [x] **Uptake trace BUILT (inert)** behind `PEDAGOGY_ENGINE_UPTAKE_TRACE` (default OFF) — read-time elicitation-vs-recast→production classification overlaid on the realized signal (after-prompt/after-recast/unprompted); pure `pedagogy/uptake.py` + route `realized.uptake` + headline/per-target indicator (en/ko). Spec/plan `docs/superpowers/{specs,plans}/2026-06-28-teacher-fde-uptake-trace*.md`. Not yet cut over (deploy-inert → flip → runtime-verify). — 2026-06-28
```

In `docs/school-integration/teacher-fde/ROADMAP.md` decision log, add a row:
```
| 2026-06-28 | **Uptake trace BUILT (inert)** behind `PEDAGOGY_ENGINE_UPTAKE_TRACE` — closes the synthetic pre-validation finding #4 (productive-struggle purist's trust condition): classifies each realized production as after-prompt / after-recast / unprompted, resolving the hit-count's parroting-vs-production ambiguity. Path A (read-time derive from persisted events, no live-path change). | The strongest convergent refute after prose-extraction; derivable cheaply from data already persisted; lights up today's real burn-in. |
```

- [ ] **Step 3: Update the spec status line**

In `docs/superpowers/specs/2026-06-28-teacher-fde-uptake-trace-design.md`, change line 3 from `Status: Design — pending user review` to:
```
Status: BUILT (inert, behind PEDAGOGY_ENGINE_UPTAKE_TRACE, default off) — 2026-06-28
```

- [ ] **Step 4: Commit**

```bash
git add backend/CLAUDE.md docs/school-integration/teacher-fde/TASKS.md docs/school-integration/teacher-fde/ROADMAP.md docs/superpowers/specs/2026-06-28-teacher-fde-uptake-trace-design.md
git commit -m "docs(teacher-fde): uptake trace built-behind-flag (inert); sync flag-state + roadmap"
```

---

## Final verification (after all tasks)

Run the touched suites:
```bash
python3 -m unittest backend.tests.test_pedagogy_uptake backend.tests.test_pedagogy_engine_s1 backend.tests.test_teacher_plan_preview_route -v
cd frontend && npm run test -- --run src/components/assignments/AssignmentPlanPreview.test.tsx src/i18n/i18n.parity.test.ts
```
Expected: all green. Then the full backend + frontend suites (`make test`) before deploy.

**Deploy (separate, after merge):** ship inert (cloudbuild default `'0'`), then cut over with `gcloud run services update lingual-app --update-env-vars PEDAGOGY_ENGINE_UPTAKE_TRACE=1` and runtime-verify on the real burn-in assignment (`?realized=1` shows `realized.uptake`), then bump the cloudbuild default `0→1` for durability — per the Phase 1 alignment-view precedent. Not part of this plan's tasks.

## Self-Review

**Spec coverage:** §2 feasibility → Task 1 (pure join over persisted events). §3 components: DB read (reused, Task 2 Step 5) · pure function (Task 1) · route enrichment (Task 2) · flag (Task 2 Step 3) · frontend (Task 3). §4 surface (headline + per-target indicator) → Task 3. §5 flag/deploy → Task 2 Step 8 + Final. §6 fail-soft → Task 2 Step 5 (nested try/except) + tested Task 2 Step 1. §7 honesty caveats → Task 3 Step 5 (`uptakeCaveat`, tooltip). §8 testing (pure unit, route, frontend) → Tasks 1–3. §9 out-of-scope respected (no emission change, no per-student, no grammar, no new DB read). Covered.

**Beyond-spec corrections (grounded in code-read):** (1) vocabulary hits use `payload['word']` not `expression` — encoded in `_HIT_SURFACE_KEY` and tested. (2) The uptake try/except is NESTED so it cannot null realized — the spec said "unaffected if uptake derivation fails"; the plan makes the control-flow explicit and tests it. (3) same-turn recast+elicitation tiebreak → afterRecast (conservative) — added as a deterministic rule + test.

**Type consistency:** `build_target_uptake(events, target_surfaces, *, window=2)` identical in Task 1 (def), Task 2 (call), and the test. Return keys `window`/`totals`/`perTarget` and `totals` sub-keys `afterPrompt`/`afterRecast`/`unprompted`/`measured` identical across pure module, route test, frontend types, and component. `uptake_trace_enabled` identical in Task 2 (def) and Task 1 flag test + route. Frontend `PlanPreviewUptake`/`PlanPreviewUptakeTarget` match the JSON shape.

**Placeholder scan:** none — every code step shows complete code.
