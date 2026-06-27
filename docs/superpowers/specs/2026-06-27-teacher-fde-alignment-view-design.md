# Teacher FDE Phase 1 — Task–Target Alignment View (design)

Status: Draft for review
Date: 2026-06-27
Owner: Product + Engineering
Program: Teacher FDE (`docs/school-integration/teacher-fde/`) — Phase 1 (Observability)

## 1. Context & motivation

The pedagogy engine is permissive/fail-open: thin or misaligned teacher input silently degrades it,
and the teacher never finds out (`teacher-fde/CHARTER.md`). The keystone framework
(`teacher-fde/DESIGN_LANGUAGE.md`) names the spine **task–target alignment**: a good assignment
designs the conversation so that *succeeding at the task requires using the targets*. The framework
splits every design variable into an **intended** axis (§D quality model) and a **realized** axis (§E
signals); the gap between them is the product of this phase.

The SLA research (`teacher-fde/RESEARCH_SLA_GROUNDING.md`) confirmed the spine ("task design forces
the form") and *refuted* difficulty as a grammar-forcer — so showing teachers whether their task
actually elicited their targets is the highest-leverage observability we can ship. The same research
flagged three variables (language-mix, recycling, modality) as evidence-thin; this surface is the
first step of turning real sessions into the evidence the literature lacks.

**This phase ships one thing: the task–target alignment gap — intended targets vs. what the
conversation actually elicited, per assignment, across the class.**

## 2. Goals / non-goals

**Goals**
- Show, for each intended target, whether the class's conversations actually elicited it.
- Make the **never-elicited list** the punchline: targets the teacher designed that the scenario never
  surfaced — the actionable task–target alignment gap.
- Reuse existing data (the alignment gap is mostly a JOIN, not new measurement).
- Be honest where we cannot measure (grammar/objectives).

**Non-goals (v1)**
- Modality split of the realized signal (voice vs. text) — **fast-follow**, not v1.
- Language-mix realized aggregation — **deferred** (needs new measurement).
- Per-session alignment — already covered by the session debrief (S4.2); we work at assignment altitude.
- Any change to the engine's runtime behavior. This is a **read-only** teacher view.

## 3. Surface decision (chosen: extend the plan-preview, "B")

The plan-preview (L8, `AssignmentPlanPreview`) already renders the **intended** plan ("How the AI will
run this"). We extend it into an **intended → realized arc** — the same target table, with what
actually happened. One component, two modes:

- **Builder mode** (authoring, no sessions yet): intended-only. *"How the AI **will** run this."*
  Byte-identical to today.
- **Review mode** (sessions exist): intended **+ realized**. *"How the AI **ran** this."* Reachable
  from the assignment analytics page / assignment row.

**Altitude:** realized = **per-assignment aggregate across the class** (the natural match for the base
plan). Per-session diagnostics stay in the session debrief.

## 4. The metric

For each intended target (from `compile_prompt_plan`), attach a realized status:

- **`expression` / `vocabulary`** (measurable — per-target hit data exists):
  - aggregate `hits` across the assignment's sessions,
  - `tier` ∈ `uncovered` (0) / `recycle` (1–2) / `solid` (≥3) — the existing `CoverageState`
    vocabulary, reused from S2 `coverage.py` so thresholds never drift (frontend may relabel `recycle`
    → "Emerging" for teachers),
  - `studentsElicited` = distinct students with ≥1 hit / `studentCount` practiced.
- **`grammar_rule` / `objective`** (not measurable in v1): `measurable: false`, rendered as
  **"designed · not yet measurable."** The engine *routes* grammar (prompt-first/Lyster) but never
  *measures* grammar production. We show the honest blank rather than a turn-relevance proxy — it is
  truthful and flags the exact next thing the engine should measure (evidence-flywheel).

**Headline punchline — the never-elicited list:** intended *measurable* targets with 0 class hits.
This is the task–target alignment gap made concrete: the scenario didn't force the target → fix the
design, or the target doesn't belong → drop it. It teaches §A by showing it.

## 5. Architecture

Mirrors the pedagogy engine's pure/impure split + import boundary.

### 5.1 Pure module — `backend/services/pedagogy/alignment.py`

stdlib-only, no OpenAI/Canvas/resolver imports (extends `test_pedagogy_engine_s1.ImportBoundaryTestCase`).
May import `coverage.py` (same package, pure) to reuse tiering.

```python
def build_alignment(plan_targets: list[dict], realized_input: dict) -> dict:
    """Join intended targets with realized class-aggregate signals.

    plan_targets: serialize_plan_preview(plan)["targets"]
                  → [{"surface","kind","feedbackRoute"}, ...]
    realized_input: {
        "hit_counts":        {surface: int},   # aggregate across sessions (lexical only)
        "students_elicited": {surface: int},   # distinct students with hits>0
        "student_count":     int,
        "session_count":     int,
    }
    Returns the `realized` block (see §6). Total / no-raise: malformed input degrades to
    measurable=false rows, never throws.
    """
```

Lexical tiering: reuse `coverage.compute_coverage_state(lexical_surfaces, hit_counts, {}, session_count)`
to derive `uncovered/emerging(recycle)/solid` per surface; `neverElicited == coverage.uncovered`.

### 5.2 Impure orchestration (in the route handler)

1. `_require_assignment_teacher_access` (as today) → `bootstrap`.
2. `serialize_plan_preview(compile_prompt_plan(bootstrap))` → `preview` (intended; unchanged path).
3. If `realized` requested **and** `alignment_view_enabled()` **and** the assignment has sessions:
   - Fetch the assignment's `practice_sessions` (same source the analytics route uses).
   - `hit_counts` via `practice_analytics.build_assignment_coverage_input(sessions)` (already aggregates
     `target_expression_hits` + `target_vocabulary_hits`).
   - `students_elicited`: one pass over sessions counting distinct `student_uid` with hits>0 per surface.
   - `student_count`, `session_count` from the sessions.
   - `preview["realized"] = build_alignment(preview["targets"], realized_input)`.
4. **Fail-soft:** any exception in the realized branch → `preview["realized"] = None`, logged, never 500.
   Flag off / no sessions / builder call → `realized` absent → frontend renders intended-only.

### 5.3 Route

Extend the existing endpoint, no new route:
`GET /api/teacher/assignments/<assignment_id>/plan-preview?realized=1`
- Without `realized=1` (builder): byte-identical to today.
- With `realized=1`: adds the `realized` block (or `null` on fail-soft / flag-off).

### 5.4 Flag

`PEDAGOGY_ENGINE_ALIGNMENT_VIEW` (default `'0'`, REPLACE-safe cloudbuild substitution + `--set-env-vars`
entry). `alignment_view_enabled()` in `pedagogy/integration.py`. Independent cutover, matching every
prior slice. Off ⇒ `realized` never attached; UI shows intended-only; byte-equivalent.

## 6. Output shape (the `realized` block)

```jsonc
"realized": {
  "studentCount": 18,
  "sessionCount": 23,
  "perTarget": [
    { "surface": "Me siento ___ cuando ___", "kind": "expression",
      "measurable": true,  "hits": 41, "tier": "solid",    "studentsElicited": 15 },
    { "surface": "Conozco a gente que ___",   "kind": "expression",
      "measurable": true,  "hits": 0,  "tier": "uncovered","studentsElicited": 0  },
    { "surface": "subjuntivo en cláusulas adjetivas", "kind": "grammar_rule",
      "measurable": false, "hits": null, "tier": null, "studentsElicited": null }
  ],
  "neverElicited": ["Conozco a gente que ___"],
  "alignmentRate": { "measurableTargetCount": 6, "elicitedCount": 5, "solidCount": 3 }
}
```

## 7. Frontend

- Extend `frontend/src/components/assignments/AssignmentPlanPreview.tsx`:
  - When `realized` present: add a **Realized column** (tier badge · `hits` · `N/M students`) to the
    target table; grammar/objective rows show *"not yet measurable."*
  - Render a **"Never elicited"** callout above/below the table when `neverElicited` is non-empty —
    the punchline ("These targets you designed never came up: … — adjust the scenario or drop them.").
  - Self-hide the realized column + callout when `realized` is absent/null (builder, flag-off, no
    sessions) → intended-only, unchanged.
- Reachable in **review mode** from the assignment analytics page / assignment row (passes
  `realized=1`); the builder keeps the intended-only call.
- Extend the `PlanPreview` type in `frontend/src/api/teacher.ts` with the optional `realized` block.

## 8. Probing the 3 evidence-thin variables

- **Recycling** — the `uncovered/emerging/solid` tier already encodes cross-session recycling →
  visible in v1 (a target moving uncovered→solid across sessions is recycling working).
- **Modality** — split the realized signal by session modality (voice/text). Data exists
  (`practice_sessions` carry modality); **fast-follow**, not v1.
- **Language-mix** — correlate `target_language_intensity` with realized target-language production;
  needs new aggregation → **deferred** past v1.

## 9. Testing

- **Pure `build_alignment` unit tests** (gate `make test-backend`): join correctness; never-elicited
  list; tier thresholds (0 / 1–2 / ≥3); grammar/objective → `measurable:false`; empty sessions →
  graceful; `alignmentRate` math.
- **Route tests:** `realized=1` happy path; fail-soft (`realized:null`, no 500); flag-off byte-equivalence;
  builder call unchanged; teacher-auth enforced.
- **Import boundary:** `alignment.py` imports no OpenAI/Canvas/resolver (extend `ImportBoundaryTestCase`).
- **Frontend:** realized column + never-elicited callout render; empty-state (no realized) hides cleanly;
  grammar/objective "not yet measurable" row.

## 10. File touchpoints

- `backend/services/pedagogy/alignment.py` (new, pure)
- `backend/services/pedagogy/integration.py` (`alignment_view_enabled()`)
- `backend/routes/curriculum_admin.py` (plan-preview route — `realized=1` branch, fail-soft)
- `backend/services/practice_analytics.py` (reuse `build_assignment_coverage_input`; possible small
  helper for distinct-student-elicited counts)
- `cloudbuild.yaml` (`PEDAGOGY_ENGINE_ALIGNMENT_VIEW` substitution + `--set-env-vars` entry)
- `frontend/src/components/assignments/AssignmentPlanPreview.tsx`, `frontend/src/api/teacher.ts`
- Tests: `backend/tests/test_pedagogy_*` (alignment + route + import boundary), `AssignmentPlanPreview.test.tsx`

## 11. Out of scope / future

- Modality split (fast-follow), language-mix aggregation (deferred), grammar/objective realized
  measurement (the honest blank flags this as the next engine investment — evidence-flywheel).
- Cross-assignment / unit-level alignment trends.
