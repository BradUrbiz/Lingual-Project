# L8 Teacher Preview — Surface the Compiled Prompt-Plan to Teachers — Design

**Status:** Design / approved by controller (autonomous build per the standing directive). Next: writing-plans.
**Date:** 2026-06-24
**What:** A read-only, flag-gated teacher-facing view of the engine's **compiled prompt plan** for an assignment — "the compiler's first inference" — surfaced in the assignment builder.
**Why now:** §14 names **L8 Teacher Preview** as a requirement that "rides with S1 (the teacher MUST see the compiler's first inference)." The L8 hook (`serialize_plan_preview`, whose own docstring reads *"A teacher-facing summary of what the engine inferred (L8 minimal hook)"*) was built in S1 but is consumed only internally (the recycling snapshot). No teacher-facing surface exists: the assignment builder's "Preview" button merely launches the **student** experience. This is a genuine, architecturally-named, product-core gap — the product is *"teacher-designed practice, AI-executed,"* and the teacher currently has no window into how their design becomes the AI's behavior.

---

## 0. TL;DR

Add a read-only teacher endpoint `GET /api/teacher/assignments/<assignment_id>/plan-preview` that resolves the assignment's bootstrap (teacher-auth, via the resolver's existing `teacher_preview` path), compiles the **base** plan (no per-student coverage/affect), and returns `serialize_plan_preview(plan)`. Render it in the assignment builder as a "How the AI will run this" panel showing: engine on/off, task type, correction posture, the per-target feedback routes the engine inferred, and — critically — for `custom_prompt` (raw) assignments, the pedagogical guarantees the teacher has **disabled**. Behind `PEDAGOGY_ENGINE_TEACHER_PREVIEW` (default off), exactly mirroring the S4.2 teacher-debrief precedent (a read-only teacher surface behind a flag). Reuses `compile_prompt_plan` + `serialize_plan_preview` + `resolve_assignment_bootstrap_for_user` + `_require_assignment_teacher_access` — no new engine logic, no persistence, no live-path touch.

---

## 1. Scope

### In scope
1. **Flag** `PEDAGOGY_ENGINE_TEACHER_PREVIEW` (default off) + `teacher_preview_enabled()` in `integration.py` + cloudbuild substitution `'0'`.
2. **Backend endpoint** `GET /api/teacher/assignments/<assignment_id>/plan-preview` (in `curriculum_admin.py`): flag gate before any work → `_require_assignment_teacher_access(deps, assignment_id)` (403/404) → resolve the bootstrap (teacher path) → `compile_prompt_plan(bootstrap)` (base plan, no coverage/affect) → `serialize_plan_preview(plan)` → `{success, planPreview, teacherPreviewEnabled}`. Fail-soft (never 500).
3. **Frontend** `getAssignmentPlanPreview(assignmentId)` (teacher.ts) + a preview panel in the assignment builder rendering the preview shape; hidden when the flag is off (`teacherPreviewEnabled: false`).
4. **Docs** `backend/CLAUDE.md` (the L8 preview endpoint + flag), `LIMITATIONS.md` (the preview surfaces the base plan only; enrichment deferred), the pedagogy memory; §14 L8 note.

### Non-goals
- **No change to `serialize_plan_preview`'s shape.** v1 surfaces the existing defined L8 hook (engine on/off, task type, correction posture, targets+routes, raw-mode `guaranteesDisabled`). Enriching it (language-mix policy, generated scenario) is a documented follow-up — and would touch the serializer shared by the internal recycling-snapshot consumer, so it's deliberately out of this slice.
- **No persistence.** The preview is compiled live on read (always fresh; the assignment may change between authoring saves). No write path, no new store, no staleness.
- **No per-student personalization in the preview.** The base plan (no `coverage_state`/`affect_state`) is the student-INDEPENDENT "compiler's first inference" — what the engine does for any student before recycling/affect personalize it. (Per-student recycling/affect are session-time, not authoring-time, and would mislead in an authoring preview.)
- **No change to the existing internal consumer** (`_assignment_recycling_snapshot` still reads `serialize_plan_preview(...)['recycling']` from a coverage-bearing plan — untouched).

---

## 2. Approaches considered

1. **Live compile-on-read of the existing `serialize_plan_preview`, teacher endpoint + builder panel, behind a flag (CHOSEN).** Minimal: reuses the L8 hook + resolver's teacher path + the S4.2 auth helper; always-fresh; no new engine logic or store. Cost: a pure compile per preview request (cheap, read-only, teacher-triggered).
2. **Enrich `serialize_plan_preview` (add language-mix, scenario) first, then surface.** A richer preview, but larger scope and it touches the serializer shared with the internal recycling snapshot — more blast radius for marginal v1 value. **Rejected for v1** (enrichment is a clean follow-up once the surface exists).
3. **Persist the compiled preview on the assignment doc at publish time, read it back.** Avoids live compile, but adds a write path and **staleness** (the preview must recompute whenever the assignment's targets/policy change) plus a migration for existing assignments. **Rejected** — live compile-on-read is simpler, always correct, and the compile is pure/cheap.

---

## 3. Architecture

```
GET /api/teacher/assignments/<assignment_id>/plan-preview            (curriculum_admin.py)
  1. teacher_preview_enabled()  → if off: {success: False, teacherPreviewEnabled: False, planPreview: None}   (zero work)
  2. _require_assignment_teacher_access(deps, assignment_id)         (session→assignment→class→teacher; 403/404)  — S4.2 helper
  3. try:
       bootstrap = resolve_assignment_bootstrap_for_user(deps, uid=<teacher uid>, context=deps.get_school_request_context(),
                                                          assignment_id=assignment_id, ui_language=<resolved>)
       plan      = compile_prompt_plan(bootstrap)                    (base plan — NO coverage_state / affect_state)
       preview   = serialize_plan_preview(plan)
       return {success: True, teacherPreviewEnabled: True, planPreview: preview}
     except Exception:
       log; return {success: True, teacherPreviewEnabled: True, planPreview: None}   (fail-soft — never 500)
```

The teacher-side bootstrap resolution is already supported: `user_can_access_assignment` returns `(True, True)` for a teacher via `is_teacher_preview_allowed(context, class_record)`, so `resolve_assignment_bootstrap_for_user` resolves the assignment-owned fields + class context + teacher policies without requiring a student enrollment. (`_require_assignment_teacher_access` is the explicit gate for a clean 403/404; the resolver's own teacher gate is the belt-and-suspenders.)

**`serialize_plan_preview` output (the existing, surfaced shape):**
- Engine path: `{engineEnabled: true, rawTutorMode: false, taskType, correctionPosture: {mode, recastDefault, elicitationRepeatThreshold}, targets: [{surface, kind, feedbackRoute}]}` (+ `recycling` only when a coverage state is present — absent here by design).
- Raw/custom-prompt path: `{engineEnabled: false, rawTutorMode: true, guaranteesDisabled: [...]}`.

---

## 4. Frontend

- `frontend/src/api/teacher.ts`: `getAssignmentPlanPreview(assignmentId): Promise<PlanPreview | null>` (null on `success: false` / flag off — mirrors `getSessionDebrief`).
- A preview panel in the assignment builder (per assignment), e.g. a collapsible "How the AI will run this assignment" section or a modal opened from the existing card actions, fetched on demand. Renders:
  - **Engine on:** task type; correction posture (mode + recast default + elicitation-repeat threshold in plain language); a small table of targets → the feedback route the engine will use for each (the inferred routing the teacher cannot otherwise see).
  - **Raw mode (custom_prompt):** a clear "the engine is OFF for this assignment" notice + the `guaranteesDisabled` list (so a teacher knows a custom-prompt assignment forgoes the pedagogical guarantees).
  - Honest framing: "a preview of how the AI is instructed before any per-student personalization."
- The panel/entry point is hidden when `teacherPreviewEnabled` is false (flag off), so the builder is byte-equivalent to today when the flag is off. The flag state flows from the endpoint (and/or a bootstrap/config field — implementer follows the `debriefEnabled` precedent).

---

## 5. Error handling & flag discipline

- **Flag off:** the endpoint returns immediately (`teacherPreviewEnabled: false`, no resolve/compile); the frontend hides the panel. No behavior change when off.
- **Fail-soft:** any resolve/compile exception logs and returns `planPreview: null` with `success: true` — the builder degrades to "preview unavailable," never an error page; the endpoint never 500s on a malformed assignment.
- **Auth:** non-teacher / wrong-class → 403; missing assignment → 404 (via `_require_assignment_teacher_access`).
- **REPLACE-safety (cloudbuild):** `PEDAGOGY_ENGINE_TEACHER_PREVIEW` is a new var, absent live → add to BOTH the line-60 `--set-env-vars` string AND the substitutions block, default `'0'`; no other substitution default changes.

---

## 6. Success criteria & testing

**Success criteria.**
- A teacher requesting the preview for a scaffolded assignment gets `{engineEnabled: true, taskType, correctionPosture, targets:[{surface,kind,feedbackRoute}]}`.
- A teacher requesting the preview for a `custom_prompt` assignment gets `{engineEnabled: false, rawTutorMode: true, guaranteesDisabled:[...]}`.
- Flag off → `teacherPreviewEnabled: false`, no preview, builder unchanged.
- Non-teacher → 403; missing assignment → 404; malformed assignment → fail-soft `planPreview: null`, no 500.

**Testing.**
- Backend (route): flag-off returns `teacherPreviewEnabled: false` + does NOT resolve a bootstrap; flag-on + scaffolded assignment returns the engine preview shape; flag-on + custom_prompt returns the raw-mode shape; non-teacher → 403; missing → 404; a resolver/compile exception → fail-soft `planPreview: null` (mock the resolver to raise).
- `teacher_preview_enabled()` flag helper (default off + truthy values), mirroring the other `*_enabled` helpers.
- Frontend: panel renders the engine preview (targets table + posture); renders the raw-mode notice + guaranteesDisabled; hidden when `teacherPreviewEnabled` false; `getAssignmentPlanPreview` returns null on `success:false`.

---

## 7. Files

| File | Change |
|---|---|
| `backend/services/pedagogy/integration.py` | add `teacher_preview_enabled()` (reads `PEDAGOGY_ENGINE_TEACHER_PREVIEW`) |
| `backend/routes/curriculum_admin.py` | new `GET /api/teacher/assignments/<id>/plan-preview` (flag gate → teacher auth → resolve → compile → `serialize_plan_preview` → fail-soft) |
| `frontend/src/api/teacher.ts` | `getAssignmentPlanPreview` + a `PlanPreview` type |
| `frontend/src/pages/TeacherAssignmentBuilderPage.tsx` (+ a small preview component) | the "How the AI will run this" panel, flag-gated |
| `cloudbuild.yaml` | `_PEDAGOGY_ENGINE_TEACHER_PREVIEW: '0'` (set-env-vars string + substitutions block) |
| tests | backend route + flag tests; frontend panel tests |
| docs | `backend/CLAUDE.md`, `LIMITATIONS.md`, `PEDAGOGY_ENGINE.md` §14 L8 note, pedagogy memory |

---

## 8. Follow-ups (logged)
- **Enrich the preview** — add the language-mix/intensity policy and (optionally) the generated scenario summary to `serialize_plan_preview` so the teacher sees the full target-vs-native balance and the scenario the engine will run. (Touches the serializer shared with the recycling snapshot — additive key, low risk, but its own slice.)
- **Live re-compile in the builder form** — show the preview update as the teacher edits targets/policy before saving (v1 previews the saved assignment).
- **Cutover** — flip `PEDAGOGY_ENGINE_TEACHER_PREVIEW=1` after review (human-driven, like the other engine flags).
