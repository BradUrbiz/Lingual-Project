# Teacher FDE — Uptake Trace (elicitation-vs-recast) — Design

Status: LIVE — CUT OVER 2026-06-28 (PEDAGOGY_ENGINE_UPTAKE_TRACE=1, rev lingual-app-00095-6rw); prod runtime-verified on the Testing Class burn-in assignment (measured=4)
Date: 2026-06-28
Owner: Product + Engineering
Related: `docs/school-integration/teacher-fde/` (DESIGN_LANGUAGE §E, PHASE0_SYNTHETIC_PREVALIDATION #4),
the Phase 1 Alignment View (`PEDAGOGY_ENGINE_ALIGNMENT_VIEW`).

## 1. Goal

The Phase 1 Alignment View answers *"was the target elicited?"* (hit-counts). It cannot answer the
deeper question the synthetic pre-validation surfaced (finding #4, 2/3 personas, the productive-struggle
purist's trust condition): **was a target produced because the learner was prompted to self-repair
(productive struggle), or because the tutor handed over the form (a recast the learner echoed)?**

This feature adds an **uptake trace** to the realized signal: for each lexical target production,
classify it as **after-prompt** (elicitation → self-repair), **after-recast** (form supplied), or
**unprompted** (spontaneous — no feedback in the window; the *strongest* signal). It closes the
hit-count's parroting-vs-production ambiguity and directly answers the answer-dump fear.

## 2. Feasibility (settled by investigation, 2026-06-28)

**Derivable from already-persisted data — no live/emission-path change.** The turn-ingestion route
(`curriculum_admin.py:685–693`) persists derived `learning_events` to PG: `feedback.recast` /
`feedback.elicitation` (assistant `turn_index`, locale-aware heuristic) and
`metric.target_expression_hit` / `metric.target_vocabulary_hit` (student `turn_index`, payload
`{expression, count}`). Both carry `session_id` + `turn_index`. A **turn-proximity join** reconstructs
the linkage. The existing read `deps.db.list_assignment_learning_events(assignment_id, event_types=…)`
(PG-authoritative via `analytics_reads`) returns exactly the rows needed
(`{session_id, event_type, turn_index, payload, student_uid}`). Historical sessions included → it lights
up on today's real burn-in data.

## 3. Architecture

**Path A — read-time derivation** (chosen over emission-time instrumentation, which would touch the
per-turn analytics path AND only cover new sessions → wouldn't show today's real data). Additive,
fail-soft, flag-gated — mirrors the Phase 1 Alignment View exactly. Lexical-only, like the realized
axis (grammar targets have no per-target hit event → excluded, consistent with "not yet measurable").

### Components & interfaces

1. **DB read (existing, reused):**
   `deps.db.list_assignment_learning_events(assignment_id, event_types=['feedback.recast',
   'feedback.elicitation', 'metric.target_expression_hit', 'metric.target_vocabulary_hit'])`
   → `list[dict]`, each `{session_id, event_type, turn_index, payload, student_uid, …}`.

2. **Pure function (new):** `backend/services/pedagogy/uptake.py`
   `build_target_uptake(events: list[dict], target_surfaces: list[str], *, window: int = 2) -> dict`
   - Pure (stdlib + sibling pedagogy only — import-boundary invariant 7a). No DB/LLM/IO.
   - Groups events by `session_id`; per session, separates feedback events (type ∈ recast/elicitation,
     at their `turn_index`) from hit events (surface = payload `expression`, weight = payload `count` or
     1, at their `turn_index`).
   - For each hit at turn `T` whose surface is in `target_surfaces`: find the **nearest preceding
     feedback** event with `T-window ≤ turn_index < T`; classify by its type
     (elicitation → `afterPrompt`, recast → `afterRecast`); if none → `unprompted`. Weight by the hit's
     `count`.
   - Returns:
     ```
     {
       "window": 2,
       "totals": {"afterPrompt": int, "afterRecast": int, "unprompted": int, "measured": int},
       "perTarget": [ {"surface": str, "afterPrompt": int, "afterRecast": int, "unprompted": int} ]
     }
     ```
     `measured` = afterPrompt + afterRecast + unprompted. `perTarget` only includes surfaces with ≥1
     production, ordered to match the realized table.

3. **Route enrichment:** in `api_get_assignment_plan_preview` (`backend/routes/curriculum_admin.py`),
   inside the existing `realized` branch, when `uptake_trace_enabled()` is true AND sessions exist:
   `preview['realized']['uptake'] = build_target_uptake(events, lexical_surfaces)`. Wrapped in the same
   `try/except → None` fail-soft as the realized join; never 500s. `lexical_surfaces` = the same
   expression+vocabulary surfaces already computed for the realized join.

4. **Integration flag:** `backend/services/pedagogy/integration.py`
   `uptake_trace_enabled() -> bool` reading `PEDAGOGY_ENGINE_UPTAKE_TRACE` (default off), mirroring
   `alignment_view_enabled()`.

5. **Frontend:** `frontend/src/api/teacher.ts` — `PlanPreviewUptake` type + `uptake?` on
   `PlanPreviewRealized`. `frontend/src/components/assignments/AssignmentPlanPreview.tsx` —
   (a) **headline** above the realized table; (b) **per-target mini-indicator** in the realized column.
   Self-hides when `uptake` is null/absent (so byte-identical with the flag off). i18n en/ko parity.

## 4. Surface / UI

- **Headline** (assignment-level, the trust signal): *"Of {measured} target productions, {afterPrompt}
  followed a self-repair prompt, {afterRecast} followed a hand-over, {unprompted} were unprompted."*
  Framed so **unprompted reads as positive** (spontaneous production, no scaffolding) and
  **afterRecast** is the one to watch (form was supplied). Self-hides at `measured = 0`.
- **Per-target indicator:** a compact `✋{afterPrompt} · 🔁{afterRecast} · ★{unprompted}` appended to
  each lexical target's realized cell (glyphs + tooltip; not relying on color alone).

## 5. Flag & deploy

- New flag `PEDAGOGY_ENGINE_UPTAKE_TRACE`, default **off**. Add to `cloudbuild.yaml` `--set-env-vars`
  with substitution `_PEDAGOGY_ENGINE_UPTAKE_TRACE` default `'0'` (REPLACE-safe: matches absent/off
  live). Ship inert; cut over separately (deploy → flip → runtime-verify on real data), per the Phase 1
  precedent.

## 6. Error handling

Fail-soft throughout (compliance/observability posture): the route's `try/except` degrades `uptake` to
absent on any failure; the pure function tolerates malformed events (missing turn_index/payload → skip
that event, never raise). The frontend self-hides on null. No path 500s; the base plan-preview and the
realized join are unaffected if uptake derivation fails.

## 7. Honesty caveats (surfaced in UI copy)

- Feedback detection is a **locale-aware heuristic** (the same `_detect_feedback_event_types` catalogs
  that power the existing feedback counts) — not model-verified.
- The proximity join is **approximate** (a fixed lookback window); it attributes a production to the
  nearest preceding feedback move, which can occasionally mis-link.
- **Unprompted is not "no feedback happened"** globally — it means no recast/elicitation in the window
  before that production. It is the *desired* outcome (spontaneous), not a gap.
- Lexical-only (expression + vocabulary), like the realized axis; grammar remains "not yet measurable."

## 8. Testing

- **Pure unit** (`backend/tests/test_pedagogy_uptake.py`): crafted event lists exercising each branch —
  hit after elicitation → afterPrompt; hit after recast → afterRecast; hit with no preceding feedback →
  unprompted; feedback outside the window → unprompted; multi-session aggregation; count-weighting;
  surface filtering (non-target surfaces ignored); malformed events skipped. Plus an **import-boundary**
  assertion (uptake.py imports stdlib + sibling pedagogy only).
- **Route test** (`backend/tests/test_curriculum_admin_routes.py`): flag-on attaches `realized.uptake`;
  flag-off omits it; no-sessions omits it; fail-soft (read raises) → `uptake` absent, no 500.
- **Frontend test** (`AssignmentPlanPreview.test.tsx`): renders headline + per-target indicator when
  `uptake` present; self-hides when null; i18n keys resolve; en/ko parity gate.

## 9. Out of scope (YAGNI)

- No emission-path change (`metric.target_expression_hit` payload unchanged).
- No per-student uptake (assignment-aggregate only, consistent with the alignment view's grade-backdoor
  guardrail from the synthetic pre-validation).
- No grammar uptake (no per-target grammar hit event exists).
- No new DB read method (the existing `list_assignment_learning_events` suffices).
