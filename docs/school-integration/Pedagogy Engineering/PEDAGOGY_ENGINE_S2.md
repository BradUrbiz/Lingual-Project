# Pedagogy Engine — S2 Closed-Loop Recycling (detailed design)

**Status:** BUILT behind flag 2026-06-23 — `PEDAGOGY_ENGINE_RECYCLING` (cloudbuild default `'0'`), **not yet cut over**. Sibling to `PEDAGOGY_ENGINE_S1.md`; realizes the **S2 row** of `PEDAGOGY_ENGINE.md` §14 and the §4.4 / §7 closed loop. **As-built narrowing vs this design:** coverage tiering is **expression + vocabulary targets only** (the surfaces with real per-target hit maps in `session_summary`); grammar rules + objectives stay on S1 routing and are out of S2 coverage scope. The route coverage compute is **fail-open** (any reader/compute failure → `coverage_state=None`, never a live-path 500) and gated on BOTH `PEDAGOGY_ENGINE_RECYCLING=1` and `PEDAGOGY_ENGINE_ASSIGNMENT_RENDER=1` (zero extra reads when off).
**Prereq:** S1 is live in prod (`PEDAGOGY_ENGINE_ASSIGNMENT_RENDER=1`, rev 00067; see `PEDAGOGY_ENGINE_S1.md` §10 and LIMITATIONS #53). Recycling only renders through the engine, so S2 has no effect unless the S1 render flag is on.

---

## 0. TL;DR
S1 made the assignment prompt a *render target of a plan*. S2 makes that plan **remember**. On a new assignment-practice session we read the student's **prior** `learning_events` for that assignment, aggregate which hard targets they've actually produced and which errors recurred, and fold a `CoverageState` into the `PromptPlan`. The renderer then adds a **mode-modulated recycling section**: weave in uncovered targets, push-further (don't re-drill) solid ones, watch for repeated errors. The `CoverageState` snapshots into the session's existing `analysis_state` as the first real L3 learner-model state. No new datastore, no new event types, no per-turn steering — a new *consumer* of an existing stream, fired at session boundaries.

## 1. Scope & decisions
**Chosen (this brainstorm, 2026-06-22):**
1. **Student-facing recycling, full loop** — the reader feeds the *live tutor* (not a teacher-only debrief). The plan gains `coverage_state`; the renderer adds a recycling section; L3 accumulates per-target mastery + repeated-error patterns. **No affect** (WTC/anxiety) — that's S4.
2. **Mode-modulated weaving** — how hard the tutor pushes uncovered targets is governed by `feedbackPolicy.mode` (the existing teacher knob, same one S1 used for grammar escalation): `fluency_first` weaves opportunistically, `accuracy_first` actively creates openings. Not a fixed posture.
3. **Focused behavioral eval built with S2** — a simulated-student + LLM-judge harness validates that the model *acts on* the recycling section, alongside deterministic unit tests that validate the prompt is *correct*.

**Settled architecture (asserted, no objection):**
- **Cross-session, at session-start.** The realtime/text system prompt is composed once per session (`chat.py:489/856`); true mid-session re-steer is `session.update` = S5 (gated). S2's loop fires when a new session starts and reads prior sessions' evidence.
- **No new store; reader-only.** Consume the existing `learning_events` stream; snapshot L3 state into `practice_sessions.analysis_state` (a JSONB column that already exists, is dual-written, and is PG-read — invariant 9 ✓). No new collection, no new event types.
- **Same-assignment scope.** Recycle *this assignment's* targets; cross-assignment carryover is out of scope.
- **First session is a no-op.** No prior evidence → empty `CoverageState` → render is byte-identical to S1.

## 2. The loop
```
new assignment-practice session
  └─(if PEDAGOGY_ENGINE_RECYCLING on)─►
       route: fetch prior learning_events for (student_uid, assignment_id)   [deps.db, PG-authoritative]
       analytics: aggregate per-target hit-counts + error families          [practice_analytics]
       pedagogy.compute_coverage_state(targets, hits, errors, prior_n)  →  CoverageState   [pure]
       resolve_assignment_system_prompt(bootstrap, surface=…, coverage_state=CoverageState)
          └─ compile_prompt_plan(bootstrap, coverage_state) → PromptPlan(coverage_state=…)
          └─ render_assignment_prompt(plan, surface) → prompt + recycling section
       snapshot serialize(CoverageState) → new session.analysis_state.coverage   [L3 state]
```

## 3. Module map (import boundary preserved — invariant 7a)
| Layer | Module | DB/OpenAI imports | Responsibility |
|---|---|---|---|
| Fetch + aggregate | `backend/services/practice_analytics.py` (+ `deps.db`) | allowed | Read prior events for (student, assignment); aggregate per-target hit-counts + error families. **Reuses** `list_student_class_learning_events` (filtered to the assignment) + `_aggregate_error_event_metadata`. New thin helper: `build_assignment_coverage_input(...) → {hit_counts, error_counts, prior_session_count}`. |
| **Pedagogy decision** | `backend/services/pedagogy/coverage.py` **(new, stdlib-only)** | none | `compute_coverage_state(targets, hit_counts, error_counts, prior_session_count) → CoverageState`. Pure: tiering + uncovered/recycle/solid selection + repeated-error thresholding. |
| Directive text | `backend/services/pedagogy/routing.py` (extend) | none | `recycling_directive_lines(coverage_state, feedback_mode, surface) → list[str]`. Pure; mirrors S1's `repair_directive_lines`. |
| Plan | `backend/services/pedagogy/plan.py` (extend) | none | `PromptPlan.coverage_state: CoverageState | None`; `compile_prompt_plan(bootstrap, coverage_state=None)`; `serialize_plan_preview` gains a coverage summary. |
| Render | `backend/services/pedagogy/render/assignment_prompt.py` (extend) | — | Emit the recycling section, surface-aware. |
| Seam | `backend/services/pedagogy/integration.py` (extend) | — | `resolve_assignment_system_prompt(bootstrap, *, surface, coverage_state=None)`; gate behind `PEDAGOGY_ENGINE_RECYCLING`. |

**The discipline:** the analytics layer (which may touch the DB) does the reading + aggregating; the pedagogy layer receives plain counts and makes the *pedagogical* decision. The DB/OpenAI/Canvas never leak into `plan.py`/`routing.py`/`coverage.py` — enforced by extending `test_pedagogy_engine_s1.ImportBoundaryTestCase` to cover `coverage.py`.

## 4. Data contracts
```python
# pedagogy/coverage.py — plain data, JSON-able
@dataclass(frozen=True)
class TargetCoverage:
    surface: str
    hits: int
    tier: str            # not_attempted | emerging | solid

@dataclass(frozen=True)
class RepeatedError:
    label: str
    count: int

@dataclass(frozen=True)
class CoverageState:
    per_target: list[TargetCoverage]
    uncovered: list[str]              # not_attempted hard targets   → "weave in"
    recycle:   list[str]              # emerging targets             → "revisit"
    solid:     list[str]              # solid targets                → "push further, don't re-drill"
    repeated_errors: list[RepeatedError]
    prior_session_count: int

    def is_empty(self) -> bool:       # first session / nothing to recycle → render no-op
        return self.prior_session_count == 0 or (
            not self.uncovered and not self.recycle and not self.solid and not self.repeated_errors
        )
```
- `analysis_state.coverage = serialize(CoverageState)` snapshotted into the **new** session's `analysis_state` (existing JSONB field; extend `default_analysis_state`/`normalize_analysis_state` to carry a `coverage` key).
- `PromptPlan.coverage_state: CoverageState | None = None` (defaults None → S1 behavior).

## 5. The reader (fetch + aggregate — reuse, don't reinvent)
- **Fetch:** `deps.db.list_student_class_learning_events(class_id, student_uid)` (PG-authoritative via ReadRouter), filtered to `assignment_id`; prior-session count from the student's prior `practice_sessions` for the assignment. If a per-(student, assignment) reader proves cleaner than client-side filtering, add `list_student_assignment_learning_events` to the ReadRouter + repository (thin, mirrors the existing student-class reader).
- **Aggregate (in `practice_analytics`):** per-target hits from `metric.target_expression_hit` / `metric.target_vocabulary_hit` / `metric.rubric_dimension_signal` keyed to the compiled target surfaces; error families from `metric.error_detected` / `metric.repeated_error` via the existing `_aggregate_error_event_metadata`. Output a plain `{hit_counts: {surface:int}, error_counts: {label:int}, prior_session_count:int}` for the pedagogy layer.
- **As-built scope note:** coverage tiering covers **expression + vocabulary targets only** — they are the surfaces with real per-target hit maps in `session_summary`. Grammar rules + objectives are NOT tiered for coverage; they stay on S1's feedback routing. **As built**, the route reads via the dedicated `deps.db.list_student_assignment_practice_sessions(...)` + `list_assignment_learning_events(...)` (filtered to the student) rather than client-side filtering `list_student_class_learning_events`.

## 6. Pedagogy decision (`compute_coverage_state`, pure)
- **Tiers:** `not_attempted` (0 hits) / `emerging` (1–2 hits) / `solid` (≥3 hits). Thresholds are module constants (`EMERGING_MAX_HITS=2`, `SOLID_MIN_HITS=3`).
- **Selection:** `uncovered` = not_attempted targets; `recycle` = emerging; `solid` = solid. **As built**, the tiered target set is **expression + vocabulary surfaces only** (the surfaces with real per-target hit maps); grammar rules + objectives are out of S2 coverage scope and stay on S1's feedback routing.
- **Repeated errors:** include `RepeatedError` where `count ≥ REPEATED_ERROR_MIN=2`.
- **Window:** cumulative across all prior sessions for the assignment.
- Grammar targets keep S1's `prompt_first` route; recycling is orthogonal to (and composes with) the S1 feedback routing.

## 7. Render — the recycling section
Emitted by `render_assignment_prompt` only when `plan.coverage_state` is present and `not coverage_state.is_empty()`. Text built from `recycling_directive_lines(coverage_state, feedback_mode, surface)`:
- `fluency_first` → low pressure: *"If it comes up naturally, give them a chance to use {uncovered}."*
- `accuracy_first` → directed: *"Make an opening to practice {uncovered} — they haven't used these yet."*
- solid → *"They've handled {solid} well — vary or extend; don't re-drill."*
- repeated_errors → *"Earlier they slipped on {label}; watch for it and prompt self-repair if it recurs."*
- **Voice** (`surface="voice"`): terse, folded into the critical-rules-last block (voice adherence is fragile). **Text**: fuller phrasing. Capped to a few lines to protect instruction load.

## 8. Integration + flag (strangler-fig)
New flag **`PEDAGOGY_ENGINE_RECYCLING`** (default off), independent of `PEDAGOGY_ENGINE_ASSIGNMENT_RENDER`:
- **Off** → the route never computes/passes `coverage_state` → identical to current S1 prod (zero added reads, zero behavior change).
- **On** → the route computes coverage and threads it into `resolve_assignment_system_prompt(..., coverage_state=…)`. No effect unless the S1 render flag is also on.
- Cut over the same way S1 did: wire into `cloudbuild.yaml` (`--set-env-vars` REPLACE → must be listed), deploy inert (`'0'`), flip live via `--update-env-vars`, burn-in, bump default `0→1`.
- **Rollback** is instant: `--update-env-vars PEDAGOGY_ENGINE_RECYCLING=0`.

## 9. Eval harness
- **Deterministic layer (gates in `make test-backend`):** unit tests on `compute_coverage_state` (counts → tiers/selection), `recycling_directive_lines` (state × mode × surface → lines), plan enrichment (`compile_prompt_plan` attaches coverage; custom_prompt ignores it), render section presence/absence and the `is_empty` no-op, and the extended import-boundary test for `coverage.py`.
- **Behavioral layer (separate opt-in CI job; real LLM cost, NOT in the unit gate):** a **simulated student** scripted to hit/miss seeded targets, run through the live engine-rendered prompt against the configured model; an **LLM judge** scores three claims per scenario — (a) elicited the uncovered target, (b) did *not* over-drill the solid target, (c) flagged the repeated error — across `fluency_first` and `accuracy_first`. Seeded `CoverageState` fixtures: {uncovered-only, solid-only, repeated-error, mixed}. Honest cost accounting; this is the §13.1 dev harness, scoped to recycling.

## 10. Build sequence (TDD, red→green per step) + DoD
1. `compute_coverage_state` (pure) + unit tests.
2. `recycling_directive_lines` (pure) + unit tests.
3. `PromptPlan.coverage_state` + `compile_prompt_plan` param + render section + `is_empty` no-op + tests; `serialize_plan_preview` coverage summary.
4. `build_assignment_coverage_input` in `practice_analytics` (+ per-student-assignment reader if needed) + tests.
5. Integration seam + `PEDAGOGY_ENGINE_RECYCLING` flag + L3 snapshot into `analysis_state` + tests; extend `ImportBoundaryTestCase` for `coverage.py`.
6. Eval harness (simulated-student + LLM-judge) + seeded scenarios.
7. Doc-sync.

**Definition of Done:** all deterministic tests green in `make test-backend`; behavioral eval passes its three claims on the seeded scenarios; flag-off path proven inert (no extra reads, identical prompt); cutover follows the S1 cadence.

## 11. Defaults & open items
- Mastery thresholds (emerging 1–2, solid ≥3) and repeated-error threshold (≥2) are first-cut constants — tune once real session data informs them. **SHIPPED** as module constants in `coverage.py` (`EMERGING_MAX_HITS=2`, `SOLID_MIN_HITS=3`, `REPEATED_ERROR_MIN=2`); window = cumulative across all prior sessions for the assignment.
- Error-family labeling depends on the `learning_events` error payload shape; resolve the exact grouping key in the plan (reuse `_aggregate_error_event_metadata`'s labels).
- If client-side filtering of `list_student_class_learning_events` is hot-path-expensive, add the dedicated per-(student, assignment) reader (step 4).

## 12. Non-goals (deferred by slice)
- **Affect / WTC / anxiety signals** → S4 (this slice is mastery + error patterns only).
- **Cross-assignment carryover** → later (same-assignment only).
- **Live mid-session re-steer** (`session.update`) → S5 (gated on eval).
- **Teacher-facing debrief over coverage** (L7) → S4 (the reader is shared, but S2 surfaces value student-side only).
- **Free-practice recycling** → free chat has no teacher targets; out of scope.

## 13. Relationship to existing docs (doc-sync targets on completion)
- `PEDAGOGY_ENGINE.md` §14 — flip the S2 row to BUILT and note the flag.
- `docs/school-integration/TASKS.md` — S2 items.
- `docs/school-integration/LIMITATIONS.md` — extend #53 (Pedagogy Engine) with the recycling constraints (heuristic thresholds, same-assignment scope, no affect).
- `backend/CLAUDE.md` — `pedagogy/` line: add `coverage.py` + the recycling flag.
