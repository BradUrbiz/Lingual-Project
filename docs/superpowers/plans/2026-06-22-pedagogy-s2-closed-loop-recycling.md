# Pedagogy Engine S2 — Closed-Loop Recycling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a new assignment-practice session, read the student's prior `learning_events`/`session_summary` for that assignment, fold a `CoverageState` into the `PromptPlan`, and have the renderer add a mode-modulated recycling section — so the tutor weaves in uncovered targets, pushes (not re-drills) solid ones, and watches for repeated errors.

**Architecture:** A cross-session, session-start reader. The analytics layer (DB-aware) reads + aggregates prior evidence into plain counts; the import-clean pedagogy layer turns counts into a `CoverageState` and renders a recycling section. Gated behind a new `PEDAGOGY_ENGINE_RECYCLING` flag (default off), independent of the S1 render flag. L3 state snapshots into the existing `practice_sessions.analysis_state` JSONB column — no new store.

**Tech Stack:** Python 3.11, Flask, `unittest` (run via `python3 -m unittest`), Firestore + Cloud SQL Postgres (read via `deps.db` ReadRouter, PG-authoritative for analytics), OpenAI Chat for the behavioral eval.

## Global Constraints

- **Import boundary (invariant 7a):** `backend/services/pedagogy/{plan,routing,coverage}.py` import only stdlib + each other — never OpenAI, Canvas, the resolver, or `deps.db`. Enforced by `test_pedagogy_engine_s1.ImportBoundaryTestCase` (extended in Task 6).
- **No new persistence (invariant 9):** L3 state rides the existing `practice_sessions.analysis_state` JSONB field. No new collection/table/event type.
- **Strangler-fig:** all new behavior behind `PEDAGOGY_ENGINE_RECYCLING` (truthy set `{"1","true","yes","on"}`); flag-off path must be byte-identical to current S1 prod and perform **zero** extra reads.
- **Coverage tiering scope:** expression + vocabulary targets only (these have real `{surface: count}` hit maps in `session_summary`). Grammar rules + objectives stay on S1 routing and are out of S2 coverage tiering.
- **Run backend tests:** `python3 -m unittest backend.tests.<module> -v` (single) or `make test-backend` (full). Test framework is `unittest`, not pytest.
- **Commit messages:** plain, no `Co-Authored-By` trailer.
- **First session / empty coverage → render no-op** (identical to S1).

---

## File Structure

- **Create** `backend/services/pedagogy/coverage.py` — `CoverageState`/`TargetCoverage`/`RepeatedError` dataclasses + pure `compute_coverage_state(...)`. Import-clean.
- **Modify** `backend/services/pedagogy/routing.py` — add pure `recycling_directive_lines(...)`.
- **Modify** `backend/services/pedagogy/plan.py` — `PromptPlan.coverage_state` field; `compile_prompt_plan(bootstrap, coverage_state=None)`; coverage summary in `serialize_plan_preview`.
- **Modify** `backend/services/pedagogy/render/assignment_prompt.py` — emit the recycling section.
- **Modify** `backend/services/pedagogy/integration.py` — `recycling_enabled()`; thread `coverage_state` through `resolve_assignment_system_prompt`.
- **Modify** `backend/services/practice_analytics.py` — `build_assignment_coverage_input(sessions, learning_events, targets)` (pure aggregation over already-fetched records).
- **Modify** `backend/db/read_router.py` (+ `backend/db/repository/analytics_reads.py`, Firestore fallback, `backend/tests/conftest.py` fake) — add `list_student_assignment_sessions(student_uid, assignment_id)` if not already reusable.
- **Modify** `backend/routes/chat.py` (~489 voice, ~858 text) — compute coverage when the flag is on, pass to `resolve_assignment_system_prompt`, snapshot into the new session's `analysis_state`.
- **Create** `backend/tests/test_pedagogy_engine_s2.py` — deterministic unit suites.
- **Create** `backend/tests/eval/test_recycling_behavioral_eval.py` + `backend/tests/eval/_recycling_scenarios.py` — opt-in simulated-student + LLM-judge eval (skipped unless `RUN_PEDAGOGY_EVAL=1`).
- **Modify** `cloudbuild.yaml` — wire `_PEDAGOGY_ENGINE_RECYCLING` (held `'0'`).
- **Modify** docs: `PEDAGOGY_ENGINE.md` §14, `PEDAGOGY_ENGINE_S2.md` §11 note, `TASKS.md`, `LIMITATIONS.md` #53, `backend/CLAUDE.md`.

---

## Task 1: Coverage model + `compute_coverage_state` (pure)

**Files:**
- Create: `backend/services/pedagogy/coverage.py`
- Test: `backend/tests/test_pedagogy_engine_s2.py`

**Interfaces:**
- Consumes: nothing (stdlib only).
- Produces: `TargetCoverage(surface:str, hits:int, tier:str)`; `RepeatedError(label:str, count:int)`; `CoverageState(per_target:list[TargetCoverage], uncovered:list[str], recycle:list[str], solid:list[str], repeated_errors:list[RepeatedError], prior_session_count:int)` with `is_empty()->bool`; `compute_coverage_state(target_surfaces:list[str], hit_counts:dict[str,int], error_counts:dict[str,int], prior_session_count:int)->CoverageState`. Module constants `EMERGING_MAX_HITS=2`, `SOLID_MIN_HITS=3`, `REPEATED_ERROR_MIN=2`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_pedagogy_engine_s2.py
from __future__ import annotations

import unittest

from backend.services.pedagogy.coverage import (
    CoverageState,
    RepeatedError,
    TargetCoverage,
    compute_coverage_state,
)


class ComputeCoverageStateTestCase(unittest.TestCase):
    def test_tiers_targets_by_hit_count(self):
        state = compute_coverage_state(
            target_surfaces=["quisiera", "la cuenta", "gracias"],
            hit_counts={"quisiera": 0, "la cuenta": 2, "gracias": 4},
            error_counts={},
            prior_session_count=2,
        )
        by_surface = {t.surface: t.tier for t in state.per_target}
        self.assertEqual(by_surface["quisiera"], "not_attempted")
        self.assertEqual(by_surface["la cuenta"], "emerging")
        self.assertEqual(by_surface["gracias"], "solid")
        self.assertEqual(state.uncovered, ["quisiera"])
        self.assertEqual(state.recycle, ["la cuenta"])
        self.assertEqual(state.solid, ["gracias"])
        self.assertFalse(state.is_empty())

    def test_repeated_errors_thresholded(self):
        state = compute_coverage_state(
            target_surfaces=["x"],
            hit_counts={"x": 1},
            error_counts={"ser_vs_estar": 3, "gender_agreement": 1},
            prior_session_count=1,
        )
        labels = {e.label: e.count for e in state.repeated_errors}
        self.assertEqual(labels, {"ser_vs_estar": 3})  # count 1 dropped (< REPEATED_ERROR_MIN)

    def test_no_prior_sessions_is_empty(self):
        state = compute_coverage_state(
            target_surfaces=["x"], hit_counts={}, error_counts={}, prior_session_count=0,
        )
        self.assertTrue(state.is_empty())
        self.assertEqual(state.uncovered, [])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_pedagogy_engine_s2.ComputeCoverageStateTestCase -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.services.pedagogy.coverage'`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/services/pedagogy/coverage.py
"""Cross-session coverage state — the S2 closed loop (pedagogical decision only).

Import boundary (invariant 7a): stdlib only. The DB read + aggregation happens
in the analytics layer; this module receives plain counts and decides tiers.
"""

from __future__ import annotations

from dataclasses import dataclass

EMERGING_MAX_HITS = 2
SOLID_MIN_HITS = 3
REPEATED_ERROR_MIN = 2


@dataclass(frozen=True)
class TargetCoverage:
    surface: str
    hits: int
    tier: str  # not_attempted | emerging | solid


@dataclass(frozen=True)
class RepeatedError:
    label: str
    count: int


@dataclass(frozen=True)
class CoverageState:
    per_target: list[TargetCoverage]
    uncovered: list[str]
    recycle: list[str]
    solid: list[str]
    repeated_errors: list[RepeatedError]
    prior_session_count: int

    def is_empty(self) -> bool:
        return self.prior_session_count == 0 or not (
            self.uncovered or self.recycle or self.solid or self.repeated_errors
        )


def _tier(hits: int) -> str:
    if hits <= 0:
        return "not_attempted"
    if hits <= EMERGING_MAX_HITS:
        return "emerging"
    return "solid"


def compute_coverage_state(
    target_surfaces: list[str],
    hit_counts: dict[str, int],
    error_counts: dict[str, int],
    prior_session_count: int,
) -> CoverageState:
    per_target: list[TargetCoverage] = []
    uncovered: list[str] = []
    recycle: list[str] = []
    solid: list[str] = []
    for surface in target_surfaces:
        hits = max(0, int(hit_counts.get(surface, 0)))
        tier = _tier(hits)
        per_target.append(TargetCoverage(surface=surface, hits=hits, tier=tier))
        if tier == "not_attempted":
            uncovered.append(surface)
        elif tier == "emerging":
            recycle.append(surface)
        else:
            solid.append(surface)
    repeated_errors = [
        RepeatedError(label=label, count=int(count))
        for label, count in error_counts.items()
        if int(count) >= REPEATED_ERROR_MIN
    ]
    repeated_errors.sort(key=lambda e: (-e.count, e.label))
    return CoverageState(
        per_target=per_target,
        uncovered=uncovered,
        recycle=recycle,
        solid=solid,
        repeated_errors=repeated_errors,
        prior_session_count=max(0, int(prior_session_count)),
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_pedagogy_engine_s2.ComputeCoverageStateTestCase -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/pedagogy/coverage.py backend/tests/test_pedagogy_engine_s2.py
git commit -m "feat(pedagogy): S2 coverage model + compute_coverage_state (pure)"
```

---

## Task 2: `recycling_directive_lines` (pure, routing.py)

**Files:**
- Modify: `backend/services/pedagogy/routing.py`
- Test: `backend/tests/test_pedagogy_engine_s2.py`

**Interfaces:**
- Consumes: `CoverageState` from Task 1 (passed in; routing must NOT import coverage at module top if it would cycle — it does not: `coverage.py` does not import `routing.py`, so a top-level `from backend.services.pedagogy.coverage import CoverageState` is safe and one-directional).
- Produces: `recycling_directive_lines(coverage_state:CoverageState, *, feedback_mode:str, surface:str)->list[str]`. Empty list when `coverage_state.is_empty()`.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/tests/test_pedagogy_engine_s2.py
from backend.services.pedagogy.routing import recycling_directive_lines


class RecyclingDirectiveLinesTestCase(unittest.TestCase):
    def _state(self):
        return compute_coverage_state(
            target_surfaces=["quisiera", "la cuenta", "gracias"],
            hit_counts={"quisiera": 0, "la cuenta": 2, "gracias": 4},
            error_counts={"ser_vs_estar": 3},
            prior_session_count=2,
        )

    def test_empty_state_yields_no_lines(self):
        empty = compute_coverage_state([], {}, {}, 0)
        self.assertEqual(recycling_directive_lines(empty, feedback_mode="balanced", surface="text"), [])

    def test_accuracy_first_is_directed(self):
        lines = recycling_directive_lines(self._state(), feedback_mode="accuracy_first", surface="text")
        joined = " ".join(lines)
        self.assertIn("quisiera", joined)          # uncovered surfaced
        self.assertIn("Make an opening", joined)     # directed wording
        self.assertIn("gracias", joined)             # solid -> push further
        self.assertIn("ser_vs_estar", joined)        # repeated error flagged

    def test_fluency_first_is_low_pressure(self):
        lines = recycling_directive_lines(self._state(), feedback_mode="fluency_first", surface="text")
        joined = " ".join(lines)
        self.assertIn("if it comes up naturally", joined.lower())
        self.assertNotIn("Make an opening", joined)

    def test_voice_surface_is_terser_than_text(self):
        s = self._state()
        text = recycling_directive_lines(s, feedback_mode="accuracy_first", surface="text")
        voice = recycling_directive_lines(s, feedback_mode="accuracy_first", surface="voice")
        self.assertLessEqual(len(" ".join(voice)), len(" ".join(text)))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_pedagogy_engine_s2.RecyclingDirectiveLinesTestCase -v`
Expected: FAIL — `ImportError: cannot import name 'recycling_directive_lines'`.

- [ ] **Step 3: Write minimal implementation**

Append to `backend/services/pedagogy/routing.py`:

```python
from backend.services.pedagogy.coverage import CoverageState


def _join_surfaces(surfaces: list[str], limit: int) -> str:
    shown = surfaces[:limit]
    return ", ".join(f"“{s}”" for s in shown)


def recycling_directive_lines(
    coverage_state: CoverageState,
    *,
    feedback_mode: str,
    surface: str,
) -> list[str]:
    """Prior-coverage recycling directives, modulated by feedback mode + surface.

    Empty when there is nothing to recycle (first session / no signal). Voice is
    terser than text (adherence is fragile); accuracy_first is directed,
    fluency_first is low-pressure.
    """
    if coverage_state.is_empty():
        return []

    limit = 2 if surface == "voice" else 4
    directed = feedback_mode == "accuracy_first"
    lines: list[str] = []

    if coverage_state.uncovered:
        targets = _join_surfaces(coverage_state.uncovered, limit)
        if directed:
            lines.append(f"Make an opening to practice {targets} — they haven't used these yet.")
        else:
            lines.append(f"If it comes up naturally, give them a chance to use {targets}.")
    if coverage_state.solid and surface != "voice":
        lines.append(
            f"They've handled {_join_surfaces(coverage_state.solid, limit)} well — vary or extend; don't re-drill."
        )
    if coverage_state.repeated_errors:
        label = coverage_state.repeated_errors[0].label
        lines.append(f"Earlier they slipped on {label}; watch for it and prompt self-repair if it recurs.")
    return lines
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_pedagogy_engine_s2.RecyclingDirectiveLinesTestCase -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/pedagogy/routing.py backend/tests/test_pedagogy_engine_s2.py
git commit -m "feat(pedagogy): S2 recycling_directive_lines (mode + surface modulated)"
```

---

## Task 3: Plan field + render section + preview summary

**Files:**
- Modify: `backend/services/pedagogy/plan.py`
- Modify: `backend/services/pedagogy/render/assignment_prompt.py`
- Test: `backend/tests/test_pedagogy_engine_s2.py`

**Interfaces:**
- Consumes: `CoverageState` (Task 1), `recycling_directive_lines` (Task 2), existing `PromptPlan` / `compile_prompt_plan` / `render_assignment_prompt`.
- Produces: `PromptPlan.coverage_state: CoverageState | None = None`; `compile_prompt_plan(bootstrap, coverage_state: CoverageState | None = None)`; render emits a `RECYCLING (prior sessions)` section when coverage is present and non-empty; `serialize_plan_preview` gains a `recycling` summary key.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/tests/test_pedagogy_engine_s2.py
from backend.services.pedagogy.plan import compile_prompt_plan, serialize_plan_preview
from backend.services.pedagogy.render.assignment_prompt import render_assignment_prompt


def _assignment_bootstrap():
    return {
        "systemPromptPreview": "BASE",
        "assignment": {"taskType": "information_gap", "title": "Cafe"},
        "class": {"name": "Spanish I"},
        "mapping": {
            "targetExpressions": ["quisiera", "la cuenta"],
            "feedbackPolicy": {"mode": "accuracy_first"},
        },
        "curriculum": {},
    }


class PlanCoverageTestCase(unittest.TestCase):
    def test_empty_coverage_renders_identically_to_none(self):
        bootstrap = _assignment_bootstrap()
        empty = compute_coverage_state(["quisiera", "la cuenta"], {}, {}, 0)
        without = render_assignment_prompt(compile_prompt_plan(bootstrap), "text")
        with_empty = render_assignment_prompt(
            compile_prompt_plan(bootstrap, coverage_state=empty), "text"
        )
        self.assertEqual(without, with_empty)

    def test_nonempty_coverage_adds_recycling_section(self):
        bootstrap = _assignment_bootstrap()
        cov = compute_coverage_state(
            ["quisiera", "la cuenta"], {"quisiera": 0, "la cuenta": 4}, {}, 2
        )
        prompt = render_assignment_prompt(
            compile_prompt_plan(bootstrap, coverage_state=cov), "text"
        )
        self.assertIn("RECYCLING (prior sessions)", prompt)
        self.assertIn("quisiera", prompt)

    def test_custom_prompt_ignores_coverage(self):
        bootstrap = {"systemPromptPreview": "RAW", "assignment": {"taskType": "custom_prompt"}}
        cov = compute_coverage_state(["x"], {"x": 0}, {}, 3)
        prompt = render_assignment_prompt(
            compile_prompt_plan(bootstrap, coverage_state=cov), "text"
        )
        self.assertEqual(prompt, "RAW")

    def test_preview_includes_recycling_summary(self):
        cov = compute_coverage_state(["quisiera"], {"quisiera": 0}, {}, 1)
        plan = compile_prompt_plan(_assignment_bootstrap(), coverage_state=cov)
        preview = serialize_plan_preview(plan)
        self.assertIn("recycling", preview)
        self.assertEqual(preview["recycling"]["uncovered"], ["quisiera"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_pedagogy_engine_s2.PlanCoverageTestCase -v`
Expected: FAIL — `compile_prompt_plan() got an unexpected keyword argument 'coverage_state'`.

- [ ] **Step 3a: Add the plan field + param**

In `backend/services/pedagogy/plan.py`:
- Add import: `from backend.services.pedagogy.coverage import CoverageState`.
- Add field to `PromptPlan`: `coverage_state: CoverageState | None = None` (place after `render_notes`).
- Change signature: `def compile_prompt_plan(bootstrap: dict[str, Any], coverage_state: CoverageState | None = None) -> PromptPlan:`.
- In the `custom_prompt` early return, leave `coverage_state` unset (raw mode ignores it).
- In the normal return, add `coverage_state=coverage_state` to the `PromptPlan(...)` call.
- In `serialize_plan_preview`, before the final `return`, when `plan.coverage_state` is present add:

```python
    preview: dict[str, Any] = {  # rename the existing returned dict to `preview`
        ...  # existing keys unchanged
    }
    if plan.coverage_state is not None and not plan.coverage_state.is_empty():
        cs = plan.coverage_state
        preview["recycling"] = {
            "uncovered": list(cs.uncovered),
            "recycle": list(cs.recycle),
            "solid": list(cs.solid),
            "repeatedErrors": [{"label": e.label, "count": e.count} for e in cs.repeated_errors],
            "priorSessionCount": cs.prior_session_count,
        }
    return preview
```

- [ ] **Step 3b: Emit the render section**

In `backend/services/pedagogy/render/assignment_prompt.py`:
- Add import: `from backend.services.pedagogy.routing import recycling_directive_lines`.
- After the `stance` is built and before assembling `sections`, build the recycling block:

```python
    recycling_block = ""
    coverage_state = plan.coverage_state
    if coverage_state is not None and not coverage_state.is_empty():
        feedback_mode = (plan.feedback_policy or {}).get("mode", "balanced")
        lines = recycling_directive_lines(coverage_state, feedback_mode=feedback_mode, surface=surface)
        if lines:
            body = "".join(f"- {line}\n" for line in lines)
            recycling_block = f"RECYCLING (prior sessions)\n{body}".strip()
```

- Append `recycling_block` to `post_stance` when non-empty (so it renders after the task directive on both surfaces):

```python
    post_stance: list[str] = [task_directive] if task_directive else []
    if recycling_block:
        post_stance.append(recycling_block)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_pedagogy_engine_s2.PlanCoverageTestCase -v`
Expected: PASS (4 tests). Then `python3 -m unittest backend.tests.test_pedagogy_engine_s1 -v` — still green (coverage defaults None → S1 path unchanged).

- [ ] **Step 5: Commit**

```bash
git add backend/services/pedagogy/plan.py backend/services/pedagogy/render/assignment_prompt.py backend/tests/test_pedagogy_engine_s2.py
git commit -m "feat(pedagogy): S2 plan coverage_state + render recycling section + preview"
```

---

## Task 4: Analytics aggregation — `build_assignment_coverage_input` (pure)

**Files:**
- Modify: `backend/services/practice_analytics.py`
- Test: `backend/tests/test_pedagogy_engine_s2.py`

**Interfaces:**
- Consumes: already-fetched `sessions: list[dict]` (each with a `session_summary`) and `learning_events: list[dict]` for one (student, assignment); `target_surfaces: list[str]` (expression + vocabulary surfaces).
- Produces: `build_assignment_coverage_input(sessions, learning_events, target_surfaces) -> dict` with keys `hit_counts: dict[str,int]`, `error_counts: dict[str,int]`, `prior_session_count: int`. Pure (no I/O) so it's unit-testable; reuses `normalize_session_summary` + `_aggregate_error_event_metadata`.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/tests/test_pedagogy_engine_s2.py
from backend.services.practice_analytics import build_assignment_coverage_input


class BuildCoverageInputTestCase(unittest.TestCase):
    def test_sums_hits_across_sessions_and_counts_errors(self):
        sessions = [
            {"session_summary": {"target_expression_hits": {"quisiera": 1}, "target_vocabulary_hits": {}}},
            {"session_summary": {"target_expression_hits": {"quisiera": 2}, "target_vocabulary_hits": {"cafe": 1}}},
        ]
        events = [
            {"event_type": "metric.repeated_error", "payload": {"errorId": "ser_estar", "label": "ser/estar"}},
            {"event_type": "metric.repeated_error", "payload": {"errorId": "ser_estar", "label": "ser/estar"}},
        ]
        out = build_assignment_coverage_input(sessions, events, ["quisiera", "cafe"])
        self.assertEqual(out["hit_counts"], {"quisiera": 3, "cafe": 1})
        self.assertEqual(out["prior_session_count"], 2)
        self.assertGreaterEqual(out["error_counts"].get("ser/estar", 0), 1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_pedagogy_engine_s2.BuildCoverageInputTestCase -v`
Expected: FAIL — `ImportError: cannot import name 'build_assignment_coverage_input'`.

- [ ] **Step 3: Write minimal implementation**

Add to `backend/services/practice_analytics.py` (near the other aggregation helpers, after `_aggregate_error_event_metadata`):

```python
def build_assignment_coverage_input(
    sessions: list[dict[str, Any]] | None,
    learning_events: list[dict[str, Any]] | None,
    target_surfaces: list[str],
) -> dict[str, Any]:
    """Aggregate one student's prior evidence for an assignment into plain counts.

    Pure: callers fetch ``sessions`` + ``learning_events`` first. Hit counts come
    from each session's normalized summary (already per-surface); error counts
    come from error/repeated-error events grouped by label.
    """
    hit_counts: dict[str, int] = {surface: 0 for surface in target_surfaces}
    prior_session_count = 0
    for session in sessions or []:
        prior_session_count += 1
        summary = normalize_session_summary(session.get('session_summary'))
        for source in ('target_expression_hits', 'target_vocabulary_hits'):
            for surface, count in (summary.get(source) or {}).items():
                if surface in hit_counts:
                    hit_counts[surface] += int(count)

    error_counts: dict[str, int] = {}
    for event in learning_events or []:
        if _normalize_string(event.get('event_type')) not in {'metric.error_detected', 'metric.repeated_error'}:
            continue
        payload = event.get('payload', {}) if isinstance(event.get('payload'), dict) else {}
        label = _normalize_string(payload.get('label')) or _normalize_string(payload.get('errorId'))
        if label:
            error_counts[label] = error_counts.get(label, 0) + (_coerce_int(payload.get('count')) or 1)

    return {
        'hit_counts': hit_counts,
        'error_counts': error_counts,
        'prior_session_count': prior_session_count,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_pedagogy_engine_s2.BuildCoverageInputTestCase -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/practice_analytics.py backend/tests/test_pedagogy_engine_s2.py
git commit -m "feat(analytics): build_assignment_coverage_input for S2 coverage reader"
```

---

## Task 5: Reader wiring + integration seam + flag + L3 snapshot

**Files:**
- Modify: `backend/db/read_router.py`, `backend/db/repository/analytics_reads.py`, the Firestore primitive it wraps, `backend/tests/conftest.py` (fake) — add `list_student_assignment_sessions(student_uid, assignment_id)` only if no existing reader returns a student's prior sessions for an assignment (check `build_student_drill_down_payload`'s fetch first; reuse if present).
- Modify: `backend/services/pedagogy/integration.py`
- Modify: `backend/routes/chat.py` (~489 voice, ~858 text)
- Modify: `backend/services/practice_analytics.py` — extend `default_analysis_state`/`normalize_analysis_state` to carry a `coverage` key.
- Test: `backend/tests/test_pedagogy_engine_s2.py`

**Interfaces:**
- Consumes: `build_assignment_coverage_input` (Task 4), `compute_coverage_state` (Task 1), `compile_prompt_plan(bootstrap, coverage_state)` (Task 3), `deps.db` session/event readers.
- Produces: `recycling_enabled()->bool`; `resolve_assignment_system_prompt(bootstrap, *, surface, coverage_state: CoverageState | None = None)`; route computes `coverage_state` only when `recycling_enabled()`; new session's `analysis_state["coverage"]` carries the serialized state.

- [ ] **Step 1: Write the failing test** (flag-gated seam — pure, no live route)

```python
# append to backend/tests/test_pedagogy_engine_s2.py
import os
from unittest import mock
from backend.services.pedagogy import integration


class IntegrationRecyclingFlagTestCase(unittest.TestCase):
    def test_recycling_enabled_reads_env(self):
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_RECYCLING": "on"}, clear=False):
            self.assertTrue(integration.recycling_enabled())
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_RECYCLING": ""}, clear=False):
            self.assertFalse(integration.recycling_enabled())

    def test_coverage_threads_into_render_when_render_flag_on(self):
        bootstrap = _assignment_bootstrap()
        cov = compute_coverage_state(["quisiera", "la cuenta"], {"quisiera": 0, "la cuenta": 4}, {}, 2)
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_ASSIGNMENT_RENDER": "1"}, clear=False):
            prompt = integration.resolve_assignment_system_prompt(
                bootstrap, surface="text", coverage_state=cov
            )
        self.assertIn("RECYCLING (prior sessions)", prompt)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_pedagogy_engine_s2.IntegrationRecyclingFlagTestCase -v`
Expected: FAIL — `AttributeError: module ... has no attribute 'recycling_enabled'` / unexpected `coverage_state` kwarg.

- [ ] **Step 3a: Extend the integration seam**

In `backend/services/pedagogy/integration.py`:

```python
from backend.services.pedagogy.coverage import CoverageState


def recycling_enabled() -> bool:
    """Whether S2 cross-session recycling is active (default off)."""
    return os.environ.get("PEDAGOGY_ENGINE_RECYCLING", "").strip().lower() in _TRUTHY


def resolve_assignment_system_prompt(
    bootstrap: dict[str, Any], *, surface: str, coverage_state: "CoverageState | None" = None
) -> str:
    if not assignment_render_enabled():
        from backend.services.assignment_resolver import build_assignment_system_prompt

        return build_assignment_system_prompt(bootstrap)
    return render_assignment_prompt(compile_prompt_plan(bootstrap, coverage_state), surface)
```

- [ ] **Step 3b: Extend analysis_state to carry coverage**

In `backend/services/practice_analytics.py`:
- In `default_analysis_state()` add `'coverage': None` to the returned dict.
- In `normalize_analysis_state()` carry it through: `coverage = value.get('coverage'); if isinstance(coverage, dict): normalized['coverage'] = coverage`.

- [ ] **Step 3c: Add the per-student-assignment session reader (only if not reusable)**

Mirror `list_student_class_learning_events` in `read_router.py` + `analytics_reads.py` + the Firestore primitive + `conftest.py` fake:

```python
# read_router.py — alongside list_student_class_learning_events
def list_student_assignment_sessions(self, student_uid, assignment_id):
    if self._analytics_sessions_mode == '1':
        return analytics_reads.list_student_assignment_sessions(student_uid, assignment_id)
    return self._guard(
        lambda: self._fs.list_student_assignment_sessions(student_uid, assignment_id),
        default=[],
    )
```

(Match the exact guard/mode pattern of the neighboring analytics readers — analytics reads are already PG-authoritative, `READ_PG_ANALYTICS_SESSIONS=1` live.)

- [ ] **Step 3d: Wire the route (both call sites)**

In `backend/routes/chat.py`, immediately before each `resolve_assignment_system_prompt(...)` call (~489 voice, ~858 text), with `bootstrap`, `uid`, `assignment_id` in scope:

```python
                from backend.services.pedagogy.integration import recycling_enabled
                coverage_state = None
                if recycling_enabled() and bootstrap and uid and assignment_id:
                    from backend.services.pedagogy.coverage import compute_coverage_state
                    from backend.services.practice_analytics import build_assignment_coverage_input
                    targets = [
                        *(_clean(bootstrap.get('mapping', {}).get('targetExpressions'))),
                        *(_clean(bootstrap.get('mapping', {}).get('targetVocabulary'))),
                    ]
                    prior_sessions = deps.db.list_student_assignment_sessions(uid, assignment_id)
                    prior_events = deps.db.list_student_class_learning_events(
                        bootstrap.get('class', {}).get('id') or '', uid
                    )
                    cov_input = build_assignment_coverage_input(prior_sessions, prior_events, targets)
                    coverage_state = compute_coverage_state(targets, **cov_input)
```

Pass `coverage_state=coverage_state` to the `resolve_assignment_system_prompt(...)` call (keep `surface="voice"`/`surface="text"`). After the new session is created, snapshot `serialize` of the coverage into its `analysis_state["coverage"]` (reuse the preview shape from `serialize_plan_preview(...)['recycling']`, or `None` when empty). Use a small local `_clean(value)` returning `[s for s in value if isinstance(s, str) and s.strip()]` when `value` is a list else `[]`.

- [ ] **Step 4: Run tests**

Run: `python3 -m unittest backend.tests.test_pedagogy_engine_s2.IntegrationRecyclingFlagTestCase -v` → PASS.
Run: `python3 -m unittest backend.tests.test_chat -v` (or the chat route test module) → still green.
Run: `make test-backend` → all green.

- [ ] **Step 5: Commit**

```bash
git add backend/services/pedagogy/integration.py backend/routes/chat.py backend/services/practice_analytics.py backend/db/ backend/tests/
git commit -m "feat(pedagogy): S2 reader wiring, PEDAGOGY_ENGINE_RECYCLING flag, analysis_state coverage snapshot"
```

---

## Task 6: Extend the import-boundary test for `coverage.py`

**Files:**
- Modify: `backend/tests/test_pedagogy_engine_s1.py` (`ImportBoundaryTestCase`)

**Interfaces:**
- Consumes: the existing subprocess-based boundary test.
- Produces: a check that importing `backend.services.pedagogy.coverage` pulls in no `openai`/Canvas/resolver module.

- [ ] **Step 1: Add the assertion**

Locate `ImportBoundaryTestCase` (subprocess that imports a pedagogy module and asserts forbidden modules are absent from `sys.modules`). Add `backend.services.pedagogy.coverage` to the imported-modules list it checks (alongside `plan` and `routing`).

- [ ] **Step 2: Run it**

Run: `python3 -m unittest backend.tests.test_pedagogy_engine_s1.ImportBoundaryTestCase -v`
Expected: PASS — `coverage` imports clean.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_pedagogy_engine_s1.py
git commit -m "test(pedagogy): extend import-boundary check to coverage.py"
```

---

## Task 7: Behavioral eval (simulated-student + LLM-judge, opt-in)

**Files:**
- Create: `backend/tests/eval/__init__.py`, `backend/tests/eval/_recycling_scenarios.py`, `backend/tests/eval/test_recycling_behavioral_eval.py`

**Interfaces:**
- Consumes: `compile_prompt_plan` + `render_assignment_prompt` + `compute_coverage_state`; the OpenAI client factory from `main.py` (lazy import inside the test, NOT at module top — keeps the import-boundary tests clean).
- Produces: a suite skipped unless `RUN_PEDAGOGY_EVAL=1`, asserting the three claims per scenario.

- [ ] **Step 1: Seed scenarios**

```python
# backend/tests/eval/_recycling_scenarios.py
from backend.services.pedagogy.coverage import compute_coverage_state

TARGETS = ["quisiera", "la cuenta", "gracias"]
SCENARIOS = [
    {
        "name": "uncovered_accuracy_first",
        "feedback_mode": "accuracy_first",
        "coverage": compute_coverage_state(TARGETS, {"quisiera": 0, "la cuenta": 4, "gracias": 4}, {}, 2),
        "claims": {"elicits_uncovered": "quisiera", "no_overdrill": "gracias", "flags_error": None},
    },
    {
        "name": "repeated_error_fluency_first",
        "feedback_mode": "fluency_first",
        "coverage": compute_coverage_state(TARGETS, {"quisiera": 2, "la cuenta": 2, "gracias": 2},
                                           {"ser/estar": 3}, 3),
        "claims": {"elicits_uncovered": None, "no_overdrill": None, "flags_error": "ser/estar"},
    },
]
```

- [ ] **Step 2: Write the eval (skipped by default)**

```python
# backend/tests/eval/test_recycling_behavioral_eval.py
import os
import unittest

from backend.services.pedagogy.plan import compile_prompt_plan
from backend.services.pedagogy.render.assignment_prompt import render_assignment_prompt
from backend.tests.eval._recycling_scenarios import SCENARIOS


def _bootstrap(mode):
    return {
        "systemPromptPreview": "You are a Spanish café tutor.",
        "assignment": {"taskType": "information_gap", "title": "Café"},
        "class": {"name": "Spanish I"},
        "mapping": {"targetExpressions": ["quisiera", "la cuenta", "gracias"],
                    "feedbackPolicy": {"mode": mode}},
        "curriculum": {},
    }


@unittest.skipUnless(os.environ.get("RUN_PEDAGOGY_EVAL") == "1", "behavioral eval is opt-in (LLM cost)")
class RecyclingBehavioralEvalTestCase(unittest.TestCase):
    def test_tutor_acts_on_coverage(self):
        from main import build_openai_client  # lazy; real model + cost
        client = build_openai_client()
        for sc in SCENARIOS:
            prompt = render_assignment_prompt(
                compile_prompt_plan(_bootstrap(sc["feedback_mode"]), coverage_state=sc["coverage"]),
                "text",
            )
            # Simulated student: a generic opener that does NOT use the uncovered target.
            transcript = _run_simulated_student(client, prompt, turns=4)
            verdict = _judge(client, sc, transcript)  # LLM judge returns {claim: bool}
            if sc["claims"]["elicits_uncovered"]:
                self.assertTrue(verdict["elicits_uncovered"], f"{sc['name']}: {transcript}")
            if sc["claims"]["flags_error"]:
                self.assertTrue(verdict["flags_error"], f"{sc['name']}: {transcript}")
            if sc["claims"]["no_overdrill"]:
                self.assertTrue(verdict["no_overdrill"], f"{sc['name']}: {transcript}")
```

Implement `_run_simulated_student(client, system_prompt, turns)` (a scripted learner model that produces target-avoiding turns via a second cheap completion) and `_judge(client, scenario, transcript)` (an LLM-judge completion returning a JSON object of the three booleans) as module-level helpers in the same file. Keep prompts terse; log the transcript on failure.

- [ ] **Step 3: Smoke-run it once locally**

Run: `RUN_PEDAGOGY_EVAL=1 python3 -m unittest backend.tests.eval.test_recycling_behavioral_eval -v`
Expected: PASS on both scenarios (or a logged transcript explaining a judge miss). Default `make test-backend` run leaves it **skipped**.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/eval/
git commit -m "test(pedagogy): S2 behavioral eval (simulated-student + LLM-judge, opt-in)"
```

---

## Task 8: Flag wiring + doc-sync

**Files:**
- Modify: `cloudbuild.yaml`
- Modify: `PEDAGOGY_ENGINE.md` §14, `PEDAGOGY_ENGINE_S2.md` §11 note, `docs/school-integration/TASKS.md`, `docs/school-integration/LIMITATIONS.md` #53, `backend/CLAUDE.md`

- [ ] **Step 1: Wire the flag into cloudbuild (held off)**

Mirror the `_PEDAGOGY_ENGINE_ASSIGNMENT_RENDER` wiring: append `,PEDAGOGY_ENGINE_RECYCLING=${_PEDAGOGY_ENGINE_RECYCLING}` to the `--set-env-vars` string and add a `_PEDAGOGY_ENGINE_RECYCLING: '0'` substitution with a comment explaining the inert-first cutover cadence (same as S1).

- [ ] **Step 2: Doc-sync**

- `PEDAGOGY_ENGINE.md` §14: flip the **S2 row** to `BUILT (behind PEDAGOGY_ENGINE_RECYCLING, default off)`.
- `PEDAGOGY_ENGINE_S2.md` §5/§6: add a one-line note that coverage tiering is expression+vocabulary only (grammar/objectives stay on S1 routing); §11: mark thresholds shipped.
- `LIMITATIONS.md` #53: add recycling constraints (heuristic thresholds, expression/vocab-only coverage, same-assignment scope, no affect, behavioral eval is opt-in not CI-gated).
- `TASKS.md`: tick the S2 items.
- `backend/CLAUDE.md`: extend the `pedagogy/` line with `coverage.py` + the `PEDAGOGY_ENGINE_RECYCLING` flag.

- [ ] **Step 3: Full suite + commit**

```bash
make test-backend   # all green; eval stays skipped
git add cloudbuild.yaml docs/ backend/CLAUDE.md "docs/school-integration/Pedagogy Engineering/"
git commit -m "docs(pedagogy): S2 recycling flag wiring + doc-sync"
```

---

## Cutover (after merge + burn-in — operational, not a code task)

Same cadence as S1 (requires `PEDAGOGY_ENGINE_ASSIGNMENT_RENDER=1` already live): deploy with `_PEDAGOGY_ENGINE_RECYCLING='0'` (inert) → verify health → `gcloud run services update lingual-app --project=lingu-480600 --region us-central1 --update-env-vars PEDAGOGY_ENGINE_RECYCLING=1` → burn-in → bump cloudbuild default `0→1`. Rollback instant: `--update-env-vars PEDAGOGY_ENGINE_RECYCLING=0`.

---

## Self-Review

**Spec coverage:** §2 loop → Tasks 1–5; §3 module map → Tasks 1–5 file-for-file; §4 contracts → Tasks 1, 3; §5 reader → Tasks 4, 5; §6 decision → Task 1; §7 render → Tasks 2, 3; §8 flag → Tasks 5, 8; §9 eval → Tasks 1/3 (deterministic) + Task 7 (behavioral); §10 build sequence → task order; §11 defaults → Task 1 constants + Task 8 note; §12 non-goals → not implemented (correct). No gaps.

**Type consistency:** `CoverageState`/`TargetCoverage`/`RepeatedError` defined in Task 1, consumed unchanged in Tasks 2, 3, 5, 7. `compute_coverage_state(target_surfaces, hit_counts, error_counts, prior_session_count)` — same arg names everywhere; `build_assignment_coverage_input` returns exactly those keys (consumed via `**cov_input`). `recycling_directive_lines(coverage_state, *, feedback_mode, surface)` and `resolve_assignment_system_prompt(bootstrap, *, surface, coverage_state)` consistent across tasks.

**Placeholder scan:** pure-function tasks (1–4, 6) carry complete code; wiring tasks (5, 7, 8) give exact edits + the pattern to mirror (`list_student_class_learning_events`, the S1 cloudbuild flag) rather than inventing the surrounding file — appropriate for an existing codebase. The one conditional ("add the reader only if not reusable") is a real reuse check, with the fallback fully specified.
